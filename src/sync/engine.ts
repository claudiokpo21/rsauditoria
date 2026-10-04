/**
 * Motor de sincronización offline-first.
 *
 * PUSH (por lotes, en orden FIFO):
 *  0. Recuperación: operaciones que quedaron "enviando" (cierre del navegador a mitad de un
 *     envío) se consultan con hse_sync_confirm: si el servidor tiene el recibo se dan por
 *     confirmadas; si no, vuelven a "pendiente" y se reenvían con la MISMA clave.
 *  1. Archivos: se suben antes que su metadato (reanudable > 6 MB, sin duplicar).
 *  2. Lotes de hasta 50 operaciones → hse_sync_push. Cada resultado es un recibo:
 *       aplicado / duplicado  → confirmada: se borra de la cola, se registra en op_log
 *       conflicto             → queda con la fila del servidor para resolución manual
 *       rechazado             → permiso/validación: revisión manual
 *       error                 → transitorio: reintento automático con espera creciente
 *     Una operación bloqueada retiene las posteriores del mismo registro (orden causal).
 *  3. Error de red: se detiene; nada se pierde (la cola es persistente).
 * PULL: incremental por updated_at con solape, sin pisar registros con cambios pendientes,
 *       con ventana de retención para tablas voluminosas (minimización de datos).
 */
import { db, SYNC_TABLES, AUDIT_SCOPED_TABLES, getMeta, setMeta, type OutboxOp, type SyncTable } from '../db/db';
import { supabase, errorMessage, isNetworkError } from '../lib/supabase';
import { env } from '../lib/env';
import { uploadEvidenceFile } from './uploads';
import { HEAVY_TABLES, retentionStartIso } from './retention';

export interface SyncResult { pushed: number; pulled: number; failed: number; conflicts: number; error: string | null; durationMs: number; drained: boolean }
interface PushResult { op_id: string; status: 'aplicado' | 'duplicado' | 'conflicto' | 'rechazado' | 'omitido' | 'error'; code?: string; message?: string; row_version?: number; server_row?: Record<string, unknown>; fields?: string[] }

export const BATCH_SIZE = 50;
const PAGE = 1000;
const OVERLAP_MS = 2 * 60 * 1000;
const cursorKey = (org: string, t: string) => `cursor:${org}:${t}`;
export const backoffMs = (attempts: number) => Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));

export class AuthExpiredError extends Error {}
const isAuthError = (e: unknown) => {
  const x = e as { code?: string; status?: number; message?: string };
  return x?.code === 'PGRST301' || x?.code === '28000' || x?.status === 401 || /JWT expired|invalid JWT/i.test(x?.message ?? '');
};

export async function deviceId(): Promise<string> {
  let id = await getMeta<string>('device_id');
  if (!id) { id = crypto.randomUUID(); await setMeta('device_id', id); }
  return id;
}

async function logOp(op: OutboxOp, result: string, rowVersion: number | null) {
  await db.op_log.add({ op_id: op.op_id, organization_id: op.organization_id, table: op.table, record_id: op.record_id, result, row_version: rowVersion, at: new Date().toISOString() });
  const n = await db.op_log.count();
  if (n > 2000) await db.op_log.orderBy('id').limit(n - 2000).delete();
}

/** Aplica localmente la fila confirmada por el servidor sin pisar cambios locales posteriores. */
async function adoptServerRow(op: OutboxOp, serverRow?: Record<string, unknown>, rowVersion?: number) {
  const t = db.table(op.table);
  const morePending = await db.outbox.where('record_id').equals(op.record_id).filter(o => o.op_id !== op.op_id).count();
  if (serverRow && !morePending) { await t.put(serverRow); return; }
  // hay cambios locales posteriores: sólo se actualizan datos que fija el servidor
  const local = await t.get(op.record_id) as Record<string, unknown> | undefined;
  if (local && serverRow) {
    const serverOwned = ['row_version', 'updated_at', 'created_at', 'created_by', 'code', 'score', 'max_score', 'compliance_pct', 'critical_failures', 'section_results', 'result_band', 'scoring_snapshot', 'closed_at', 'closed_by', 'verified_at', 'verified_by', 'answered_at', 'answered_by'];
    const patch: Record<string, unknown> = {};
    for (const k of serverOwned) if (k in serverRow) patch[k] = serverRow[k];
    await t.put({ ...local, ...patch });
  } else if (local && rowVersion) await t.put({ ...local, row_version: rowVersion });
}

async function recoverInFlight(orgId: string) {
  const inflight = await db.outbox.where('organization_id').equals(orgId).filter(o => o.status === 'enviando').toArray();
  if (!inflight.length) return;
  const { data, error } = await supabase.rpc('hse_sync_confirm', { p_op_ids: inflight.map(o => o.op_id) });
  if (error) throw error;
  const got = new Map(((data ?? []) as { op_id: string; row_version: number }[]).map(r => [r.op_id, r.row_version]));
  for (const op of inflight) {
    if (got.has(op.op_id)) { await db.outbox.delete(op.seq!); await logOp(op, 'confirmado_tras_reinicio', got.get(op.op_id)!); }
    else await db.outbox.update(op.seq!, { status: 'pendiente' });
  }
}

/** Operaciones listas para enviar, respetando el orden causal por registro. */
/**
 * Completar o cerrar una auditoría es una BARRERA: sólo se envía cuando todo lo anterior de la
 * cola (respuestas, evidencias y sus archivos, hallazgos) ya está confirmado o va en el mismo lote
 * antes que ella. Así el servidor valida el cierre con los datos completos.
 */
export const isBarrier = (o: Pick<OutboxOp, 'table' | 'payload'>) =>
  o.table === 'hse_audits' && ['completada', 'cerrada'].includes(String(o.payload.status ?? ''));

async function eligible(orgId: string): Promise<OutboxOp[]> {
  const ops = await db.outbox.where('organization_id').equals(orgId).sortBy('seq');
  const blocked = new Set<string>(); const out: OutboxOp[] = []; const now = new Date().toISOString();
  let earlierHeld = false;
  for (const o of ops) {
    const k = `${o.table}:${o.record_id}`;
    if (blocked.has(k)) { earlierHeld = true; continue; }
    const waiting = o.status === 'error' && o.next_attempt_at && o.next_attempt_at > now;
    if (o.status === 'rechazado' || o.status === 'conflicto' || o.status === 'enviando' || waiting || (isBarrier(o) && earlierHeld)) {
      blocked.add(k); earlierHeld = true; continue;
    }
    out.push(o);
  }
  return out;
}

export async function push(orgId: string, onProgress?: (msg: string) => void): Promise<{ pushed: number; failed: number; conflicts: number }> {
  let pushed = 0, failed = 0, conflicts = 0;
  await recoverInFlight(orgId);
  for (let round = 0; round < 100; round++) {
    const ops = await eligible(orgId);
    if (!ops.length) break;
    // 1) archivos primero (la operación de metadato no puede ir sin su archivo)
    const batch: OutboxOp[] = [];
    let uploadHeld = false;
    for (const op of ops) {
      if (batch.length >= BATCH_SIZE) break;
      if (isBarrier(op) && uploadHeld) break;              // la barrera espera a los archivos anteriores
      if (op.kind === 'upload' && op.file_state !== 'subido') {
        try {
          onProgress?.('Subiendo evidencia…');
          await uploadEvidenceFile(op.record_id, String(op.payload.storage_path), (s, t) => onProgress?.(`Subiendo evidencia ${Math.round((100 * s) / Math.max(1, t))} %`));
          await db.outbox.update(op.seq!, { file_state: 'subido' });
          op.file_state = 'subido';
        } catch (e) {
          if (isAuthError(e)) throw new AuthExpiredError('La sesión venció: inicie sesión para continuar sincronizando.');
          if (isNetworkError(e) || (e as { network?: boolean }).network) throw e;
          const permanent = (e as { permanent?: boolean }).permanent;
          failed++; uploadHeld = true;
          await db.outbox.update(op.seq!, { status: permanent ? 'rechazado' : 'error', attempts: op.attempts + 1, last_error: errorMessage(e), next_attempt_at: new Date(Date.now() + backoffMs(op.attempts + 1)).toISOString() });
          continue;
        }
      }
      batch.push(op);
    }
    if (!batch.length) break;

    // 2) envío del lote (estado "enviando" persistido antes de salir)
    const sentAt = new Date().toISOString();
    await db.outbox.bulkUpdate(batch.map(o => ({ key: o.seq!, changes: { status: 'enviando' as const, sent_at: sentAt } })));
    onProgress?.(`Enviando ${batch.length} cambios…`);
    let results: PushResult[];
    try {
      const { data, error } = await supabase.rpc('hse_sync_push', { p_ops: batch.map(o => ({ op_id: o.op_id, table: o.table, base: o.base, payload: o.payload })) });
      if (error) throw error;
      results = data as PushResult[];
    } catch (e) {
      // sin respuesta: puede haberse aplicado o no. Se deja "pendiente" y la clave de
      // idempotencia evita duplicados en el reenvío.
      await db.outbox.bulkUpdate(batch.map(o => ({ key: o.seq!, changes: { status: 'pendiente' as const, attempts: o.attempts + 1 } })));
      if (isAuthError(e)) throw new AuthExpiredError('La sesión venció: inicie sesión para continuar sincronizando.');
      throw e;
    }

    // 3) recibos
    const byId = new Map(results.map(r => [r.op_id, r]));
    for (const op of batch) {
      const r = byId.get(op.op_id);
      if (!r) { await db.outbox.update(op.seq!, { status: 'pendiente' }); continue; }
      if (r.status === 'aplicado' || r.status === 'duplicado') {
        await adoptServerRow(op, r.server_row, r.row_version);
        await db.outbox.delete(op.seq!);
        await logOp(op, r.status, r.row_version ?? null);
        pushed++;
      } else if (r.status === 'conflicto') {
        conflicts++;
        await db.outbox.update(op.seq!, { status: 'conflicto', last_code: r.code ?? 'HS409', last_error: r.message ?? 'Conflicto', conflict: { fields: r.fields ?? [], server_row: r.server_row ?? {} } });
      } else if (r.status === 'omitido') {
        await db.outbox.update(op.seq!, { status: 'pendiente' });
      } else {
        failed++;
        const transient = r.status === 'error';
        await db.outbox.update(op.seq!, {
          status: transient ? 'error' : 'rechazado', attempts: op.attempts + 1, last_code: r.code ?? null, last_error: r.message ?? r.status,
          next_attempt_at: transient ? new Date(Date.now() + backoffMs(op.attempts + 1)).toISOString() : null,
        });
        if (r.code === 'HS424' && op.kind === 'upload') await db.outbox.update(op.seq!, { file_state: 'pendiente' }); // volver a subir el archivo
      }
    }
  }
  return { pushed, failed, conflicts };
}

/** Tablas agregadas por migraciones que pueden no estar aplicadas aún en el servidor. */
export const OPTIONAL_TABLES: SyncTable[] = ['hse_audit_signatures'];

async function pullTable(orgId: string, table: SyncTable, pending: Set<string>): Promise<number> {
  const since = await getMeta<string>(cursorKey(orgId, table));
  let from = since ? new Date(new Date(since).getTime() - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
  if (HEAVY_TABLES.includes(table) && from < retentionStartIso()) from = retentionStartIso();   // minimización de datos
  let maxSeen = since ?? from, total = 0, offset = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select('*')
      .eq('organization_id', orgId).gt('updated_at', from)
      .order('updated_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      // tabla de una migración opcional todavía no aplicada en el servidor: se omite sin frenar la sincronización
      if (OPTIONAL_TABLES.includes(table) && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message ?? ''))) {
        await setMeta(`missing_table:${table}`, true);
        return 0;
      }
      throw error;
    }
    const rows = (data ?? []) as { id: string; updated_at: string }[];
    const writable = rows.filter(r => !pending.has(`${table}:${r.id}`));
    if (writable.length) await db.table(table).bulkPut(writable);
    for (const r of rows) if (r.updated_at > maxSeen) maxSeen = r.updated_at;
    total += rows.length;
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  await setMeta(cursorKey(orgId, table), maxSeen);
  if (OPTIONAL_TABLES.includes(table)) await setMeta(`missing_table:${table}`, false);
  return total;
}

/** Huella de lo que habilita el acceso del usuario: rol, empresa y asignaciones a auditorías. */
async function accessSignature(orgId: string, userId: string | undefined): Promise<string> {
  if (!userId) return '';
  const m = (await db.hse_memberships.where('organization_id').equals(orgId).toArray()).filter(x => x.user_id === userId)
    .map(x => `${x.role}|${x.company_id}|${x.active}`);
  const p = (await db.hse_audit_participants.where('user_id').equals(userId).toArray()).filter(x => x.organization_id === orgId)
    .map(x => `${x.audit_id}|${x.participant_role}|${x.deleted_at ?? ''}`).sort();
  return JSON.stringify([m, p]);
}

export async function pull(orgId: string): Promise<number> {
  const ops = await db.outbox.where('organization_id').equals(orgId).toArray();
  const pending = new Set(ops.map(o => `${o.table}:${o.record_id}`));
  const userId = (await supabase.auth.getSession()).data.session?.user.id;
  const before = await accessSignature(orgId, userId);
  let n = 0;
  for (const t of SYNC_TABLES) n += await pullTable(orgId, t, pending);
  // Si cambió el rol o la asignación a auditorías, la descarga incremental no alcanza: filas antiguas
  // pueden haberse vuelto visibles (o dejado de serlo). Se re-descarga lo que depende de la asignación.
  // (en la primera descarga no hay membresía local previa: no hace falta repetirla)
  if (before && !before.startsWith('[[]') && before !== await accessSignature(orgId, userId)) {
    await db.transaction('rw', AUDIT_SCOPED_TABLES.map(t => db.table(t)), async () => {
      for (const t of AUDIT_SCOPED_TABLES) {
        const ids = (await db.table(t).where('organization_id').equals(orgId).primaryKeys() as string[]).filter(id => !pending.has(`${t}:${id}`));
        await db.table(t).bulkDelete(ids);
      }
    });
    for (const t of AUDIT_SCOPED_TABLES) { await db.meta.delete(cursorKey(orgId, t)); n += await pullTable(orgId, t, pending); }
  }
  // perfiles: sólo nombre y correo de miembros (minimización)
  const members = await db.hse_memberships.where('organization_id').equals(orgId).toArray();
  const ids = [...new Set(members.map(m => m.user_id))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('hse_profiles').select('id,email,full_name,job_title,updated_at').in('id', ids.slice(i, i + 200));
    if (error) throw error;
    if (data?.length) await db.profiles.bulkPut(data.map(p => ({ ...p, phone: null, default_organization_id: null })));
  }
  return n;
}

/** Descarga completa de una auditoría (y su plantilla) para trabajarla sin conexión. */
export async function downloadAuditForOffline(orgId: string, auditId: string, withPhotos: boolean): Promise<{ rows: number; photos: number }> {
  let rows = 0;
  const get = async (table: SyncTable, col: string, val: string) => {
    const { data, error } = await supabase.from(table).select('*').eq('organization_id', orgId).eq(col, val).limit(5000);
    if (error) throw error;
    const ops = await db.outbox.where('table').equals(table).toArray(); const pend = new Set(ops.map(o => o.record_id));
    const list = (data ?? []).filter((r: { id: string }) => !pend.has(r.id));
    if (list.length) await db.table(table).bulkPut(list);
    rows += list.length; return data ?? [];
  };
  const [a] = await get('hse_audits', 'id', auditId) as { template_version_id: string }[];
  if (!a) throw new Error('La auditoría no existe o no tiene acceso');
  await get('hse_template_versions', 'id', a.template_version_id);
  await get('hse_template_sections', 'version_id', a.template_version_id);
  await get('hse_template_items', 'version_id', a.template_version_id);
  await get('hse_audit_responses', 'audit_id', auditId);
  const findings = await get('hse_findings', 'audit_id', auditId) as { id: string }[];
  for (const f of findings) await get('hse_actions', 'finding_id', f.id);
  const evs = await get('hse_evidences', 'audit_id', auditId) as { id: string; storage_path: string; mime_type: string; deleted_at: string | null }[];
  let photos = 0;
  if (withPhotos) {
    const { encryptBlob } = await import('../lib/localCrypto');
    const { EVIDENCE_BUCKET } = await import('../lib/supabase');
    for (const e of evs.filter(x => !x.deleted_at)) {
      if (await db.blobs.get(e.id)) continue;
      const { data } = await supabase.storage.from(EVIDENCE_BUCKET).download(e.storage_path);
      if (!data) continue;
      await db.blobs.put({ evidence_id: e.id, organization_id: orgId, enc: await encryptBlob(data), mime_type: e.mime_type, created_at: new Date().toISOString(), source: 'descarga' });
      photos++;
    }
  }
  const pinned = new Set((await getMeta<string[]>(`pinned:${orgId}`)) ?? []); pinned.add(auditId);
  await setMeta(`pinned:${orgId}`, [...pinned]);
  await setMeta(`pinned_at:${auditId}`, new Date().toISOString());
  return { rows, photos };
}

export async function syncOnce(orgId: string, onProgress?: (msg: string) => void): Promise<SyncResult> {
  const t0 = performance.now();
  let res = { pushed: 0, failed: 0, conflicts: 0 }, pulled = 0, error: string | null = null;
  try {
    res = await push(orgId, onProgress);
    // vencimientos: el servidor genera los avisos (idempotente) antes de descargarlos
    await supabase.rpc('hse_refresh_notifications', { p_org: orgId }).then(() => undefined, () => undefined);
    onProgress?.('Descargando cambios…');
    pulled = await pull(orgId);
  } catch (e) {
    error = e instanceof AuthExpiredError ? e.message : errorMessage(e);
  }
  const durationMs = Math.round(performance.now() - t0);
  const left = await db.outbox.where('organization_id').equals(orgId).count();
  const drained = !error && left === 0;
  // "sincronización confirmada": el servidor confirmó todo lo pendiente y la descarga terminó
  if (!error) await setMeta(`last_sync_ok:${orgId}`, new Date().toISOString());
  if (drained) await setMeta(`last_sync_confirmed:${orgId}`, new Date().toISOString());
  await db.sync_log.add({ organization_id: orgId, at: new Date().toISOString(), pushed: res.pushed, pulled, failed: res.failed, conflicts: res.conflicts, duration_ms: durationMs, error, confirmed: drained });
  if (!error && (res.pushed || res.failed || res.conflicts)) {
    void supabase.from('hse_sync_events').insert({
      organization_id: orgId, device_id: await deviceId(), pushed: res.pushed, pulled, failed: res.failed,
      conflicts: res.conflicts, duration_ms: durationMs, app_version: env.appVersion,
    }).then(() => undefined);
  }
  return { ...res, pulled, error, durationMs, drained };
}

/** Resolver un conflicto. 'mio' = reenviar sabiendo lo que hay en el servidor; 'servidor' = descartar el cambio local. */
export async function resolveConflict(seq: number, choice: 'mio' | 'servidor') {
  const op = await db.outbox.get(seq);
  if (!op || op.status !== 'conflicto' || !op.conflict) return;
  const server = op.conflict.server_row;
  if (choice === 'mio') {
    // la nueva base es lo que hoy tiene el servidor: el usuario decide sobrescribirlo conscientemente
    const base: Record<string, unknown> = {};
    for (const k of Object.keys(op.payload)) if (!['id', 'organization_id', 'client_updated_at'].includes(k)) base[k] = server[k] ?? null;
    await db.outbox.update(seq, { status: 'pendiente', base, conflict: null, last_error: null, last_code: null, op_id: crypto.randomUUID() });
  } else {
    await db.transaction('rw', [db.outbox, db.table(op.table)], async () => {
      await db.outbox.delete(seq);
      const later = await db.outbox.where('record_id').equals(op.record_id).toArray();
      if (!later.length && Object.keys(server).length) await db.table(op.table).put(server);
    });
  }
}

export async function retryOp(seq: number) {
  await db.outbox.update(seq, { status: 'pendiente', next_attempt_at: null, last_error: null, last_code: null });
}

/** Descartar un cambio local que el servidor rechazó; recupera la versión del servidor si existe. */
export async function discardOp(seq: number) {
  const op = await db.outbox.get(seq);
  if (!op) return;
  await db.outbox.delete(seq);
  const later = await db.outbox.where('record_id').equals(op.record_id).count();
  if (later) return;
  if (navigator.onLine) {
    const { data } = await supabase.from(op.table).select('*').eq('id', op.record_id).maybeSingle();
    if (data) { await db.table(op.table).put(data); return; }
  }
  if (!op.base) { await db.table(op.table).delete(op.record_id); if (op.kind === 'upload') await db.blobs.delete(op.record_id); }
}

export async function resetCursors(orgId: string) {
  const keys = (await db.meta.toArray()).map(m => m.key).filter(k => k.startsWith(`cursor:${orgId}:`));
  await db.meta.bulkDelete(keys);
}

/** Elimina del dispositivo los datos de una organización a la que ya no se pertenece. */
export async function purgeOrganization(orgId: string) {
  await db.transaction('rw', db.tables, async () => {
    for (const t of SYNC_TABLES) await db.table(t).where('organization_id').equals(orgId).delete();
    await db.outbox.where('organization_id').equals(orgId).delete();
    await db.blobs.where('organization_id').equals(orgId).delete();
  });
  await resetCursors(orgId);
}
