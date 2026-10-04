import type { Evidence } from '../../types';

/**
 * Numeración de las fotos de una auditoría ("Foto 1", "Foto 2"…), igual en pantalla, PDF y Excel.
 * Orden estable: fecha de la toma y, a igualdad, identificador; no cambia al sincronizar.
 */
export function photoNumbers(evidences: Evidence[]): Map<string, number> {
  const imgs = evidences.filter(e => !e.deleted_at && e.mime_type.startsWith('image/'))
    .sort((a, b) => (a.taken_at ?? '').localeCompare(b.taken_at ?? '') || a.id.localeCompare(b.id));
  return new Map(imgs.map((e, i) => [e.id, i + 1]));
}

/** "Fotos 3, 4, 7" a partir de una lista de evidencias. */
export function photoList(evs: Evidence[], nums: Map<string, number>): number[] {
  return evs.map(e => nums.get(e.id)).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
}
