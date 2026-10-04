import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNameMap, useOrgRows, useProfiles } from '../../db/hooks';
import { useAuth } from '../auth/AuthProvider';
import { auditAccess, findingAccess, useParticipants } from '../auth/access';
import { Badge, Empty, Input, PageHeader, Select, Stat, fmtDate } from '../../components/ui';
import { ActionForm } from './ActionForm';
import { LABELS, type Action, type Audit, type Finding } from '../../types';

export function ActionsPage() {
  const { userId, role, orgId, current } = useAuth();
  const [sp] = useSearchParams();
  const audits = useOrgRows<Audit>('hse_audits') ?? [];
  const participants = useParticipants(orgId);
  const actions = useOrgRows<Action>('hse_actions') ?? [];
  const findings = useOrgRows<Finding>('hse_findings') ?? [];
  const cName = useNameMap('hse_companies'); const people = useProfiles();
  const [q, setQ] = useState(''); const [st, setSt] = useState('abiertas'); const [mine, setMine] = useState(false); const [co, setCo] = useState('');
  const [sel, setSel] = useState<Action | null>(null);
  const fById = new Map(findings.map(f => [f.id, f]));
  const aById = new Map(audits.map(a => [a.id, a]));
  const accOf = (f: Finding) => findingAccess(f, auditAccess(aById.get(f.audit_id), role, userId, participants, current?.company_id), userId, actions, role);
  useEffect(() => { const id = sp.get('accion'); if (id && !sel) { const x = actions.find(a => a.id === id); if (x) setSel(x); } }, [sp, actions]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = new Date().toISOString().slice(0, 10);
  const isOpen = (a: Action) => ['pendiente', 'en_curso'].includes(a.status);
  const list = useMemo(() => actions.filter(a =>
    (st === '' || (st === 'abiertas' ? isOpen(a) : st === 'vencidas' ? isOpen(a) && a.due_date < today : a.status === st)) &&
    (!mine || a.responsible_user_id === userId) && (!co || a.responsible_company_id === co) &&
    (!q || `${a.description} ${fById.get(a.finding_id)?.title ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.due_date.localeCompare(b.due_date)), [actions, st, mine, co, q, userId, today, fById]);
  const overdue = actions.filter(a => isOpen(a) && a.due_date < today).length;
  const soon = actions.filter(a => isOpen(a) && a.due_date >= today && a.due_date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).length;

  return (
    <div className="stack-lg">
      <PageHeader title="Planes de acción" subtitle="Seguimiento de acciones correctivas y preventivas." />
      <div className="grid grid-4">
        <Stat label="Abiertas" value={actions.filter(isOpen).length} />
        <Stat label="Vencidas" value={overdue} tone={overdue ? 'bad' : 'ok'} />
        <Stat label="Vencen en 7 días" value={soon} tone={soon ? 'warn' : undefined} />
        <Stat label="Verificadas" value={actions.filter(a => a.status === 'verificada').length} sub={`${actions.filter(a => a.effectiveness === 'no_eficaz').length} no eficaces`} />
      </div>
      <div className="row gap wrap">
        <Input placeholder="Buscar" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <Select value={st} onChange={e => setSt(e.target.value)} options={[{ value: 'abiertas', label: 'Abiertas' }, { value: 'vencidas', label: 'Vencidas' }, { value: '', label: 'Todas' }, ...Object.entries(LABELS.actionStatus).map(([value, label]) => ({ value, label }))]} style={{ maxWidth: 200 }} />
        <Select placeholder="Todas las empresas" value={co} onChange={e => setCo(e.target.value)} options={[...cName].map(([value, label]) => ({ value, label }))} style={{ maxWidth: 220 }} />
        <label className="row gap small"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Asignadas a mí</label>
      </div>
      {list.length === 0 ? <Empty>No hay acciones para el filtro.</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Acción</th><th>Hallazgo</th><th>Responsable</th><th>Vence</th><th>Estado</th></tr></thead>
          <tbody>{list.map(a => {
            const f = fById.get(a.finding_id);
            return (
              <tr key={a.id} className="clickable" onClick={() => setSel(a)}>
                <td className="pre">{a.description}<div className="muted small">{LABELS.actionType[a.action_type]}</div></td>
                <td className="small">{f ? `${f.code ?? ''} ${f.title}` : '—'}</td>
                <td>{a.responsible_user_id ? people.get(a.responsible_user_id) : a.responsible_name ?? '—'}<div className="muted small">{a.responsible_company_id ? cName.get(a.responsible_company_id) : ''}</div></td>
                <td>{isOpen(a) && a.due_date < today ? <Badge tone="bad">{fmtDate(a.due_date)}</Badge> : fmtDate(a.due_date)}</td>
                <td><Badge tone={a.status === 'verificada' || a.status === 'completada' ? 'ok' : a.status === 'cancelada' ? 'neutral' : 'warn'}>{LABELS.actionStatus[a.status]}</Badge></td>
              </tr>);
          })}</tbody>
        </table></div>
      )}
      {sel && fById.get(sel.finding_id) ? <ActionForm initial={sel} finding={fById.get(sel.finding_id)!} findingAccess={accOf(fById.get(sel.finding_id)!)} onClose={() => setSel(null)} /> : null}
    </div>
  );
}
