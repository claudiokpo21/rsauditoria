import { useState } from 'react';
import { useOrgRows } from '../../db/hooks';
import { patchRecord } from '../../db/repo';
import { useAuth, can } from '../auth/AuthProvider';
import { evaluate } from '../../scoring/engine';
import { Badge, Button, Card, Field, Modal, Select, TextArea, fmtDateTime, fmtNum, useToast } from '../../components/ui';
import { LABELS, type ImportIssue, type TemplateItem, type TemplateSection, type TemplateVersion, type ValidationCaseRow } from '../../types';

const sevTone = { bloqueante: 'bad', advertencia: 'warn', info: 'info' } as const;

export function ValidationPanel({ version, sections, items, onRpc, busy }: {
  version: TemplateVersion; sections: TemplateSection[]; items: TemplateItem[]; busy: boolean;
  onRpc: (fn: string, args: Record<string, unknown>, ok: string) => Promise<unknown>;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const issues = (useOrgRows<ImportIssue>('hse_template_import_issues', [version.id]) ?? []).filter(i => i.version_id === version.id);
  const cases = (useOrgRows<ValidationCaseRow>('hse_template_validation_cases', [version.id]) ?? []).filter(c => c.version_id === version.id);
  const [filter, setFilter] = useState<'abiertas' | 'todas'>('abiertas');
  const [resolving, setResolving] = useState<{ issue: ImportIssue; status: ImportIssue['status']; note: string } | null>(null);
  const [notes, setNotes] = useState('');
  const editable = can(role, 'templates') && version.status === 'borrador';
  const order = { bloqueante: 0, advertencia: 1, info: 2 };
  const shown = issues.filter(i => filter === 'todas' || i.status === 'pendiente').sort((a, b) => order[a.severity] - order[b.severity]);
  const pendingReview = issues.filter(i => i.status === 'pendiente' && i.severity !== 'info').length;
  const itemLabel = new Map(items.map(i => [i.id, i.original_number ?? i.code ?? i.source_ref ?? '']));
  const secTitle = new Map(sections.map(s => [s.id, s.title.trim()]));

  const resolve = async () => {
    if (!resolving) return;
    if (resolving.status !== 'pendiente' && !resolving.note.trim()) { toast('Indique la resolución', 'bad'); return; }
    await patchRecord<ImportIssue>('hse_template_import_issues', resolving.issue.id, { status: resolving.status, resolution_note: resolving.note.trim() || null });
    setResolving(null);
  };

  return (
    <Card title="Validación de la importación" actions={<Badge tone={pendingReview ? 'warn' : 'ok'}>{pendingReview ? `${pendingReview} por revisar` : 'Incidencias revisadas'}</Badge>}>
      <div className="stack-lg">
        <div>
          <div className="row between wrap gap"><h3>Incidencias para revisión manual</h3>
            <div className="row gap"><button className={`tab ${filter === 'abiertas' ? 'active' : ''}`} onClick={() => setFilter('abiertas')}>Pendientes</button><button className={`tab ${filter === 'todas' ? 'active' : ''}`} onClick={() => setFilter('todas')}>Todas ({issues.length})</button></div>
          </div>
          {shown.length === 0 ? <p className="muted small">No hay incidencias {filter === 'abiertas' ? 'pendientes' : ''}.</p> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Severidad</th><th>Tipo</th><th>Origen</th><th>Detalle</th><th>Estado</th></tr></thead>
              <tbody>{shown.map(i => (
                <tr key={i.id} className={editable ? 'clickable' : ''} onClick={() => editable && setResolving({ issue: i, status: i.status === 'pendiente' ? 'aceptada' : i.status, note: i.resolution_note ?? '' })}>
                  <td><Badge tone={sevTone[i.severity]}>{i.severity}</Badge></td>
                  <td className="small">{i.issue_type.replace(/_/g, ' ')}</td>
                  <td className="small mono">{i.source_ref ?? (i.item_id ? `ítem ${itemLabel.get(i.item_id)}` : '—')}</td>
                  <td className="small">{i.message}{i.resolution_note ? <div className="muted" style={{ marginTop: '.25rem' }}>↳ {i.resolution_note}</div> : null}</td>
                  <td><Badge tone={i.status === 'pendiente' ? 'warn' : 'ok'}>{LABELS.issueStatus[i.status]}</Badge></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </div>

        <div>
          <div className="row between wrap gap">
            <h3>Casos de validación (resultados de prueba del origen)</h3>
            {editable ? <Button variant="secondary" className="btn-sm" busy={busy} onClick={() => void onRpc('hse_run_validation_cases', { p_version: version.id }, 'Casos ejecutados en el servidor')}>Ejecutar en el servidor</Button> : null}
          </div>
          {cases.length === 0 ? <p className="muted small">{can(role, 'templates') ? 'Sin casos de validación.' : 'Los casos de validación son visibles para supervisores y administradores.'}</p> : cases.map(c => {
            const exp = c.expected as { sections: Record<string, { raw: number; target: number; score: number }>; final: number };
            const srv = c.computed as { final: number; band: string; sections: { section_id: string; raw: number; target: number; score: number }[] } | null;
            const local = evaluate(version, sections, items, c.answers);
            return (
              <div key={c.id} className="stack" style={{ marginTop: '.5rem' }}>
                <div className="row gap wrap small">
                  <strong>{c.name}</strong>
                  {c.matches === null ? <Badge>Sin ejecutar</Badge> : <Badge tone={c.matches ? 'ok' : 'bad'}>{c.matches ? 'Reproduce el origen' : 'NO coincide'}</Badge>}
                  <span className="muted">Dif. máx. {c.max_abs_diff === null ? '—' : Number(c.max_abs_diff).toExponential(1)} · {fmtDateTime(c.last_run_at)}</span>
                </div>
                <div className="table-wrap"><table className="t">
                  <thead><tr><th>Sección</th><th className="num">Obtenido</th><th className="num">Objetivo</th><th className="num">Nota origen</th><th className="num">Nota servidor</th><th className="num">Nota local</th></tr></thead>
                  <tbody>
                    {Object.entries(exp.sections).map(([sid, e]) => {
                      const s = srv?.sections.find(x => x.section_id === sid); const l = local.sections.find(x => x.section_id === sid);
                      const bad = s && Math.abs(Number(s.score) - e.score) > 1e-6;
                      return <tr key={sid}><td>{secTitle.get(sid) ?? sid}</td><td className="num">{e.raw}</td><td className="num">{e.target}</td><td className="num">{fmtNum(e.score, 4)}</td>
                        <td className="num" style={bad ? { color: 'var(--bad)' } : undefined}>{s ? fmtNum(Number(s.score), 4) : '—'}</td><td className="num">{l ? fmtNum(l.score, 4) : '—'}</td></tr>;
                    })}
                    <tr><td><strong>Resultado final</strong></td><td /><td /><td className="num"><strong>{fmtNum(exp.final, 4)}</strong></td>
                      <td className="num"><strong>{srv ? fmtNum(Number(srv.final), 4) : '—'}</strong> {srv?.band ? <Badge tone="info">{srv.band}</Badge> : null}</td>
                      <td className="num">{fmtNum(local.final, 4)} {local.band ? <Badge>{local.band}</Badge> : null}</td></tr>
                  </tbody>
                </table></div>
                <p className="muted small">El caso contiene sólo códigos de situación por ítem; no se usa como valor por defecto de auditorías.</p>
              </div>
            );
          })}
        </div>

        {editable && version.validation_status !== 'validada' ? (
          <div className="stack">
            <h3>Validar versión</h3>
            <Field label="Fundamento de la validación" hint="Quién confirmó las reglas de puntuación, los límites de evaluación y la numeración, y con qué criterio." required>
              <TextArea value={notes} onChange={e => setNotes(e.target.value)} />
            </Field>
            <div><Button busy={busy} disabled={!notes.trim() || pendingReview > 0} onClick={async () => { await onRpc('hse_validate_template_version', { p_version: version.id, p_notes: notes }, 'Versión validada'); setNotes(''); }}>Validar</Button>
              {pendingReview > 0 ? <span className="muted small" style={{ marginLeft: '.5rem' }}>Resuelva primero las {pendingReview} incidencias pendientes.</span> : null}</div>
          </div>
        ) : version.validation_status === 'validada' ? <div className="alert alert-ok">Validada {fmtDateTime(version.validated_at)}: {version.validation_notes}</div> : null}
      </div>

      <Modal open={!!resolving} title="Resolver incidencia" onClose={() => setResolving(null)}
        footer={<><Button variant="secondary" onClick={() => setResolving(null)}>Cancelar</Button><Button onClick={resolve}>Guardar</Button></>}>
        {resolving ? <>
          <div className="alert alert-info small">{resolving.issue.message}</div>
          <Field label="Decisión"><Select value={resolving.status} onChange={e => setResolving({ ...resolving, status: e.target.value as ImportIssue['status'] })}
            options={[{ value: 'aceptada', label: 'Aceptada: se mantiene como está' }, { value: 'corregida', label: 'Corregida en el borrador' }, { value: 'descartada', label: 'Descartada: no aplica' }, { value: 'pendiente', label: 'Volver a pendiente' }]} /></Field>
          <Field label="Nota de resolución" required><TextArea value={resolving.note} onChange={e => setResolving({ ...resolving, note: e.target.value })} /></Field>
          {resolving.status === 'corregida' ? <p className="muted small">Si corrige el contenido (numeración, proceso, texto), edítelo en el borrador antes de validar. Cambiar el contenido vuelve la validación a pendiente.</p> : null}
        </> : null}
      </Modal>
    </Card>
  );
}
