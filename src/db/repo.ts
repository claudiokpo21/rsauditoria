import type Dexie from 'dexie';
import { v5 as uuidv5 } from 'uuid';
import { db, WRITABLE_COLUMNS, type SyncTable, type OutboxOp } from './db';
import { requestSync } from '../sync/scheduler';
import { encryptBlob } from '../lib/localCrypto';

/** Espacio de nombres para los identificadores determinísticos de respuestas. */
const RESPONSE_NS = '6f1c0d5e-2b7a-4f0e-9a61-3c2d8e4b7a10';
export const responseId = (auditId: string, itemId: string) => uuidv5(`${auditId}:${itemId}`, RESPONSE_NS);
/** UUID v4 generado en el dispositivo: el registro tiene identidad antes de llegar al servidor. */
export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

const norm = (v: unknown) => (v === undefined ? null : v);
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/**
 * Calcula la operación: sólo los campos modificados (payload) y el valor que tenían
 * en el dispositivo (base). Así el servidor puede fusionar cambios de distintos
 * usuarios sobre campos diferentes y detectar conflictos sobre el mismo campo.
 */
export function diffForSync(table: string, prev: Record<string, unknown> | undefined, next: Record<string, unknown>) {
  const cols = WRITABLE_COLUMNS[table];
  if (!cols) throw new Error(`La tabla ${table} no se escribe desde el cliente`);
  const payload: Record<string, unknown> = { id: next.id, organization_id: next.organization_id };
  if (!prev) {
    for (const c of cols) if (c in next && next[c] !== undefined) payload[c] = next[c];
    return { payload, base: null as Record<string, unknown> | null, changed: true };
  }
  const base: Record<string, unknown> = {};
  let changed = false;
  for (const c of cols) {
    if (c === 'id' || c === 'organization_id' || c === 'client_updated_at' || !(c in next)) continue;
    if (!same(prev[c], next[c])) { payload[c] = norm(next[c]); base[c] = norm(prev[c]); changed = true; }
  }
  payload.client_updated_at = next.client_updated_at;
  return { payload, base, changed };
}

/**
 * Guarda un registro: escribe en IndexedDB y encola la operación en la MISMA
 * transacción, de modo que nunca queda un cambio local sin su envío pendiente,
 * aunque se cierre el navegador o se corte la energía inmediatamente después.
 */
export async function saveRecord<T extends { id: string; organization_id: string }>(table: SyncTable, record: T, extraTables: Dexie.Table[] = []): Promise<T> {
  const rec = { ...record, client_updated_at: nowIso() } as T & { client_updated_at: string };
  const t = db.table(table);
  await db.transaction('rw', [t, db.outbox, ...extraTables], async () => {
    const prev = await t.get(rec.id) as Record<string, unknown> | undefined;
    const { payload, base, changed } = diffForSync(table, prev, rec as unknown as Record<string, unknown>);
    if (!changed) return;
    await t.put({ ...(prev ?? {}), ...rec });
    const op: OutboxOp = {
      op_id: newId(), organization_id: rec.organization_id, table, kind: 'upsert', record_id: rec.id, base, payload,
      created_at: nowIso(), attempts: 0, next_attempt_at: null, status: 'pendiente', last_error: null, last_code: null,
    };
    await db.outbox.add(op);
  });
  requestSync();
  return rec;
}

/** Actualización parcial a partir del registro local existente. */
export async function patchRecord<T extends { id: string; organization_id: string }>(table: SyncTable, id: string, patch: Partial<T>): Promise<T> {
  const prev = await db.table(table).get(id) as T | undefined;
  if (!prev) throw new Error('Registro inexistente en el dispositivo');
  return saveRecord(table, { ...prev, ...patch });
}

/** Borrado lógico (se propaga a los demás dispositivos por sincronización). */
export async function softDelete(table: SyncTable, id: string) {
  return patchRecord(table, id, { deleted_at: nowIso() } as never);
}

/**
 * Guarda una evidencia capturada sin conexión: archivo cifrado + metadato + operación
 * de subida, todo en una transacción. El archivo se sube primero (ruta determinística,
 * sin sobrescritura: reintentar nunca duplica) y el metadato sólo después.
 */
export async function saveEvidenceWithBlob(meta: Record<string, unknown> & { id: string; organization_id: string; storage_path: string; mime_type: string }, blob: Blob) {
  const rec = { ...meta, client_updated_at: nowIso() };
  const enc = await encryptBlob(blob);                       // fuera de la transacción (WebCrypto es asíncrono)
  const { payload } = diffForSync('hse_evidences', undefined, rec);
  await db.transaction('rw', [db.hse_evidences, db.blobs, db.outbox], async () => {
    await db.blobs.put({ evidence_id: rec.id, organization_id: rec.organization_id, enc, mime_type: rec.mime_type, created_at: nowIso(), source: 'captura' });
    await db.hse_evidences.put(rec as never);
    await db.outbox.add({
      op_id: newId(), organization_id: rec.organization_id, table: 'hse_evidences', kind: 'upload', record_id: rec.id, base: null, payload,
      created_at: nowIso(), attempts: 0, next_attempt_at: null, status: 'pendiente', last_error: null, last_code: null, file_state: 'pendiente',
    });
  });
  requestSync();
}
