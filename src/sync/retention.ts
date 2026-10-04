/**
 * Políticas de seguridad del almacenamiento local.
 *
 *  OFFLINE_GRACE_DAYS     sin revalidar la sesión y los permisos contra el servidor durante
 *                         más de 7 días, la app se bloquea hasta reconectar (los cambios
 *                         pendientes se conservan). La autorización offline nunca es definitiva:
 *                         cada operación se vuelve a autorizar en el servidor al sincronizar.
 *  EXPIRE_DAYS            a los 30 días sin revalidar se eliminan del dispositivo los datos ya
 *                         sincronizados (borrado seguro); se conservan sólo los pendientes.
 *  LOCAL_RETENTION_DAYS   auditorías cerradas/canceladas sin cambios hace más de 90 días se
 *                         quitan del dispositivo (salvo las marcadas "disponible sin conexión").
 *  HEAVY_TABLES           respuestas y evidencias sólo se descargan dentro de la ventana de
 *                         retención; el resto se baja por auditoría bajo demanda.
 */
import { db, getMeta, setMeta, SYNC_TABLES } from '../db/db';

export const OFFLINE_GRACE_DAYS = 7;
export const EXPIRE_DAYS = 30;
export const LOCAL_RETENTION_DAYS = 90;
export const HEAVY_TABLES: string[] = ['hse_audit_responses', 'hse_evidences'];
const DAY = 864e5;

export const retentionStartIso = () => new Date(Date.now() - LOCAL_RETENTION_DAYS * DAY).toISOString();

export async function markServerValidation() { await setMeta('last_server_validation', new Date().toISOString()); }

export async function accessState(): Promise<{ state: 'ok' | 'bloqueado' | 'vencido'; lastValidation: string | null; daysOffline: number }> {
  const last = (await getMeta<string>('last_server_validation')) ?? null;
  if (!last) return { state: 'ok', lastValidation: null, daysOffline: 0 };
  const days = (Date.now() - new Date(last).getTime()) / DAY;
  return { state: days > EXPIRE_DAYS ? 'vencido' : days > OFFLINE_GRACE_DAYS ? 'bloqueado' : 'ok', lastValidation: last, daysOffline: Math.floor(days) };
}

/** Borra los datos sincronizados (no los pendientes) y sus archivos. */
export async function expireSyncedData() {
  const pendingRecords = new Set((await db.outbox.toArray()).map(o => o.record_id));
  await db.transaction('rw', db.tables, async () => {
    for (const t of SYNC_TABLES) await db.table(t).filter((r: { id: string }) => !pendingRecords.has(r.id)).delete();
    await db.blobs.filter(b => !pendingRecords.has(b.evidence_id)).delete();
    await db.profiles.clear();
    const keys = (await db.meta.toArray()).map(m => m.key).filter(k => k.startsWith('cursor:'));
    await db.meta.bulkDelete(keys);
  });
}

/** Quita auditorías viejas cerradas y todo lo que cuelga de ellas. Devuelve cuántas quitó. */
export async function pruneLocal(orgId: string): Promise<number> {
  const cutoff = retentionStartIso();
  const pinned = new Set((await getMeta<string[]>(`pinned:${orgId}`)) ?? []);
  const pendingRecords = new Set((await db.outbox.where('organization_id').equals(orgId).toArray()).map(o => o.record_id));
  const old = await db.hse_audits.where('organization_id').equals(orgId)
    .filter(a => ['cerrada', 'cancelada'].includes(a.status) && (a.updated_at ?? '') < cutoff && !pinned.has(a.id) && !pendingRecords.has(a.id)).toArray();
  let n = 0;
  for (const a of old) {
    const responses = await db.hse_audit_responses.where('audit_id').equals(a.id).toArray();
    const evidences = await db.hse_evidences.where('audit_id').equals(a.id).toArray();
    const findings = await db.hse_findings.where('audit_id').equals(a.id).toArray();
    const ids = [a.id, ...responses.map(r => r.id), ...evidences.map(e => e.id), ...findings.map(f => f.id)];
    if (ids.some(id => pendingRecords.has(id))) continue;
    const openFindings = findings.filter(f => ['abierto', 'en_tratamiento'].includes(f.status));
    if (openFindings.length) continue;                         // se conserva mientras haya tratamiento abierto
    await db.transaction('rw', [db.hse_audits, db.hse_audit_responses, db.hse_evidences, db.blobs, db.hse_findings, db.hse_actions], async () => {
      await db.hse_audit_responses.bulkDelete(responses.map(r => r.id));
      await db.blobs.bulkDelete(evidences.map(e => e.id));
      await db.hse_evidences.bulkDelete(evidences.map(e => e.id));
      for (const f of findings) await db.hse_actions.where('finding_id').equals(f.id).delete();
      await db.hse_findings.bulkDelete(findings.map(f => f.id));
      await db.hse_audits.delete(a.id);
    });
    n++;
  }
  // archivos descargados (no capturados) de evidencias que ya no están: limpieza
  const evIds = new Set((await db.hse_evidences.toArray()).map(e => e.id));
  await db.blobs.filter(b => b.source === 'descarga' && !evIds.has(b.evidence_id)).delete();
  return n;
}

/** Marca o desmarca una auditoría como disponible sin conexión. */
export async function setPinned(orgId: string, auditId: string, on: boolean) {
  const s = new Set((await getMeta<string[]>(`pinned:${orgId}`)) ?? []);
  if (on) s.add(auditId); else s.delete(auditId);
  await setMeta(`pinned:${orgId}`, [...s]);
}
