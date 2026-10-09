import { describe, expect, it } from 'vitest';
import { boldSegments, planGroups, planHash, resolveReport, textBlocks, planAccepted, DEFAULT_TITLE } from '../src/modules/reports/finalReport';
import type { Audit } from '../src/types';

const audit = (report_data: unknown = null) => ({ id: 'a', audit_team: 'Roberto Seguin', scheduled_date: '2026-05-28', scope: 'Alcance', summary: null, report_data } as unknown as Audit);
const ctx = { company: 'H&P', location: 'CP5489', leadAuditor: 'Auditor A', sections: ['Liderazgo', 'Planificación'] };

describe('informe final', () => {
  it('párrafos, viñetas y negritas', () => {
    expect(textBlocks('Uno\ndos\n\n- a\n- b\nTres')).toEqual([{ kind: 'p', text: 'Uno dos' }, { kind: 'li', text: 'a' }, { kind: 'li', text: 'b' }, { kind: 'p', text: 'Tres' }]);
    expect(textBlocks('**CSMS:** texto')).toEqual([{ kind: 'p', text: '**CSMS:** texto' }]);
    expect(boldSegments('a **b** c')).toEqual([{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }]);
  });
  it('valores sugeridos y lo guardado', () => {
    const r = resolveReport(audit(), ctx);
    expect(r.title).toBe(DEFAULT_TITLE);
    expect(r.contractor).toBe('H&P');
    expect(r.lead_auditor).toBe('Roberto Seguin');
    expect(r.dates_text).toBe('28-05-2026');
    expect(r.development).toBe('Alcance');
    expect(r.conformities.map(c => c.section)).toEqual(['Liderazgo', 'Planificación']);
    const s = resolveReport(audit({ contractor: 'TSB', title: '', conformities: [{ section: 'liderazgo', text: 'Políticas' }] }), ctx);
    expect(s.contractor).toBe('TSB');
    expect(s.title).toBe(DEFAULT_TITLE);
    expect(s.conformities[0]).toEqual({ section: 'Liderazgo', text: 'Políticas' });
  });
  it('cronograma: la fecha se combina en filas consecutivas', () => {
    const g = planGroups([{ date: '28-05', time: '9', process: 'a', auditees: '', topics: '' }, { date: '', time: '10', process: 'b', auditees: '', topics: '' },
      { date: '28-05', time: '11', process: 'c', auditees: '', topics: '' }, { date: '29-05', time: '8', process: 'd', auditees: '', topics: '' }]);
    expect(g.map(x => [x.date, x.rows.length])).toEqual([['28-05', 3], ['29-05', 1]]);
  });
  it('aceptación del plan y huella', () => {
    expect(planAccepted(audit())).toBe(false);
    expect(planAccepted(audit({ plan_approval: { status: 'aprobado' } }))).toBe(true);
    const base = { contract: 'C1', plan: [] };
    expect(planHash(base)).toBe(planHash({ ...base, development: 'cambia el informe, no el plan' }));
    expect(planHash(base)).not.toBe(planHash({ ...base, contract: 'C2' }));
  });
});
