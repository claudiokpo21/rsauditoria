/**
 * Colores de las bandas de evaluación, tomados de la planilla H&P (formato condicional
 * de la celda de resultado). Se usan iguales en pantalla, PDF y Excel.
 * La banda (texto) la decide la metodología de la plantilla; aquí sólo se le da color.
 */
export interface BandStyle { bg: string; fg: string; border: string }

export const BAND_STYLES: Record<string, BandStyle> = {
  'muy bueno': { bg: '#C5D9F1', fg: '#16365C', border: '#8DB4E2' },
  bueno:       { bg: '#92D050', fg: '#1F3B0B', border: '#76B531' },
  regular:     { bg: '#FFFF00', fg: '#3F3A00', border: '#E6D800' },
  'crítico':   { bg: '#E26B0A', fg: '#FFFFFF', border: '#C55A07' },
};

/** Colores de la planilla para encabezados y fila de resultado. */
export const SHEET = {
  header: '#FAC090',      // encabezado "Requisitos del sistema de gestión"
  headerInk: '#3B2412',
  total: '#D8E4BC',       // fila "Resultado final"
  totalInk: '#2B3A12',
};

const norm = (s: string) => s.trim().toLowerCase().replace('critico', 'crítico');

export function bandStyle(label?: string | null): BandStyle | null {
  if (!label) return null;
  return BAND_STYLES[norm(label)] ?? null;
}

/** Banda por valor según las bandas de la metodología (mismo criterio que classifyBand). */
export function bandFor(value: number | null | undefined, bands: { label: string; min: number | null; max: number | null }[] | undefined): string | null {
  if (value === null || value === undefined || !bands?.length) return null;
  return bands.find(b => (b.min === null || value >= b.min) && (b.max === null || value <= b.max))?.label ?? null;
}

/** Texto del rango de una banda, como en la planilla: "8,01 - 10", "0 - 4". */
export function bandRange(b: { min: number | null; max: number | null }): string {
  const f = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  return `${b.min === null ? '0' : f(b.min)} - ${b.max === null ? '…' : f(b.max)}`;
}
