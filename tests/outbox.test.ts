import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/sync/scheduler', () => ({ requestSync: () => undefined }));
const { db } = await import('../src/db/db');
const { saveRecord, patchRecord, softDelete, responseId, diffForSync } = await import('../src/db/repo');

describe('cola persistente de operaciones', () => {
  beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); });
  it('alta: registro local y operación en la misma transacción, con clave de idempotencia', async () => {
    await saveRecord('hse_companies', { id: 'c1', organization_id: 'o1', name: 'Contratista X', company_type: 'contratista', active: true } as never);
    const [op] = await db.outbox.toArray();
    expect(op).toMatchObject({ kind: 'upsert', status: 'pendiente', base: null, record_id: 'c1' });
    expect(op.op_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op.payload).toMatchObject({ id: 'c1', name: 'Contratista X' });
  });
  it('modificación: envía sólo los campos cambiados y el valor que se veía (base)', async () => {
    await db.hse_companies.put({ id: 'c1', organization_id: 'o1', name: 'X', tax_id: '30-1', company_type: 'contratista', active: true, row_version: 4 } as never);
    await patchRecord('hse_companies', 'c1', { name: 'X SA' } as never);
    const [op] = await db.outbox.toArray();
    expect(op.base).toEqual({ name: 'X' });
    expect(Object.keys(op.payload).sort()).toEqual(['client_updated_at', 'id', 'name', 'organization_id']);
  });
  it('guardar sin cambios no genera operación', async () => {
    await db.hse_companies.put({ id: 'c1', organization_id: 'o1', name: 'X', company_type: 'contratista', active: true } as never);
    await patchRecord('hse_companies', 'c1', { name: 'X' } as never);
    expect(await db.outbox.count()).toBe(0);
  });
  it('cambios sucesivos sin conexión quedan encadenados en orden', async () => {
    await saveRecord('hse_audits', { id: 'a1', organization_id: 'o1', template_version_id: 'v1', title: 'Aud', status: 'planificada' } as never);
    await patchRecord('hse_audits', 'a1', { status: 'en_curso' } as never);
    await patchRecord('hse_audits', 'a1', { status: 'completada' } as never);
    const ops = await db.outbox.orderBy('seq').toArray();
    expect(ops.map(o => [o.base?.status ?? null, o.payload.status])).toEqual([[null, 'planificada'], ['planificada', 'en_curso'], ['en_curso', 'completada']]);
  });
  it('columnas que fija el servidor nunca viajan (score, created_by, updated_at, code)', () => {
    const d = diffForSync('hse_audits', undefined, { id: 'a', organization_id: 'o', title: 'T', score: 99, created_by: 'x', updated_at: 'y', code: 'AUD-1' });
    expect(d.payload).not.toHaveProperty('score'); expect(d.payload).not.toHaveProperty('created_by');
    expect(d.payload).not.toHaveProperty('updated_at'); expect(d.payload).not.toHaveProperty('code');
  });
  it('el borrado es lógico y se propaga como operación', async () => {
    await saveRecord('hse_locations', { id: 'l1', organization_id: 'o1', name: 'Base Neuquén', location_type: 'base', active: true } as never);
    await softDelete('hse_locations', 'l1');
    expect((await db.hse_locations.get('l1'))?.deleted_at).toBeTruthy();
    expect((await db.outbox.toArray()).at(-1)?.payload.deleted_at).toBeTruthy();
  });
  it('el id de respuesta es determinístico (dos dispositivos responden el mismo ítem sin duplicar)', () => {
    expect(responseId('a', 'i')).toBe(responseId('a', 'i'));
    expect(responseId('a', 'i')).not.toBe(responseId('a', 'j'));
  });
});
