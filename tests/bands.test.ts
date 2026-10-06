import { describe, expect, it } from 'vitest';
import { bandStyle, uiBandStyle } from '../src/scoring/bands';

describe('colores de calificación', () => {
  it('los informes (PDF/Excel) conservan los colores exactos de la planilla', () => {
    expect(bandStyle('Muy Bueno')?.bg).toBe('#C5D9F1');
    expect(bandStyle('Bueno')?.bg).toBe('#92D050');
    expect(bandStyle('Regular')?.bg).toBe('#FFFF00');
    expect(bandStyle('Critico')?.bg).toBe('#E26B0A');
  });
  it('la pantalla usa tonos semánticos con color pleno para anillos y barras', () => {
    expect(uiBandStyle('Bueno')).toMatchObject({ bg: '#DCFAE6', solid: '#079455' });
    expect(uiBandStyle('Crítico')).toMatchObject({ bg: '#FEE4E2', solid: '#D92D20' });
    expect(uiBandStyle('crítico')).toEqual(uiBandStyle('Critico'));
    expect(uiBandStyle(null)).toBeNull();
    expect(uiBandStyle('Otra')).toBeNull();
  });
});
