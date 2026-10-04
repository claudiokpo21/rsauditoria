import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SyncTable } from './db';
import { useAuth } from '../modules/auth/AuthProvider';

/** Filas vivas (no eliminadas) de la organización actual, reactivas a IndexedDB. */
export function useOrgRows<T extends { deleted_at?: string | null }>(table: SyncTable, deps: unknown[] = []): T[] | undefined {
  const { orgId } = useAuth();
  return useLiveQuery(async () => {
    if (!orgId) return [];
    const rows = await db.table(table).where('organization_id').equals(orgId).toArray() as T[];
    return rows.filter(r => !r.deleted_at);
  }, [orgId, table, ...deps]);
}

export function useRecord<T>(table: SyncTable, id: string | undefined): T | undefined | null {
  return useLiveQuery(async () => (id ? ((await db.table(table).get(id)) as T) ?? null : null), [table, id]);
}

/** Mapa id → nombre para listas desplegables y etiquetas. */
export function useNameMap(table: 'hse_companies' | 'hse_locations' | 'hse_processes'): Map<string, string> {
  const rows = useOrgRows<{ id: string; name: string; deleted_at?: string | null }>(table) ?? [];
  return new Map(rows.map(r => [r.id, r.name]));
}

export function useProfiles() {
  const rows = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  return new Map(rows.map(p => [p.id, p.full_name || p.email]));
}

/** Operaciones de la cola asociadas a un registro (para marcar "pendiente de envío"). */
export function usePendingSet(table: SyncTable) {
  return useLiveQuery(async () => new Set((await db.outbox.where('table').equals(table).toArray()).map(o => o.record_id)), [table]) ?? new Set<string>();
}
