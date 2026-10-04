import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNameMap, useOrgRows, usePendingSet, useProfiles } from '../../db/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Empty, Input, PageHeader, Select, fmtDate } from '../../components/ui';
import { LABELS, type Action, type Audit, type Finding } from '../../types';

export const findingTone = (s: Finding['status']) => (s === 'abierto' ? 'warn' : s === 'en_tratamiento' ? 'info' : 'ok');
export const sevTone = (s: Finding['severity']) => (s === 'critica' || s === 'alta' ? 'bad' : s === 'media' ? 'warn' : 'neutral');

export function FindingsPage() {
  const nav = useNavigate();
  const findings = useOrgRows<Finding>('hse_findings') ?? [];
  const actions = useOrgRows<Action>('hse_actions') ?? [];
  const audits = useOrgRows<Audit>('hse_audits') ?? [];
  const cName = useNameMap('hse_companies');
  const pending = usePendingSet('hse_findings');
  const { userId } = useAuth();
  const people = useProfiles();
  const [q, setQ] = useState(''); const [st, setSt] = useState('abiertos'); const [ty, setTy] = useState(''); const [co, setCo] = useState('');
  const [ca, setCa] = useState(''); const [flag, setFlag] = useState('');
  const aCode = new Map(audits.map(a => [a.id, a.code ?? a.title]));
  const today = new Date().toISOString().slice(0, 10);
  const list = useMemo(() => findings.filter(f =>
    (st === '' || (st === 'abiertos' ? ['abierto', 'en_tratamiento'].includes(f.status) : f.status === st)) &&
    (!ty || f.finding_type === ty) && (!co || f.company_id === co) && (!ca || f.category === ca) &&
    (flag === '' || (flag === 'recurrentes' ? f.recurrence_count > 0 : flag === 'vencidos' ? !!f.due_date && f.due_date < today && ['abierto', 'en_tratamiento'].includes(f.status) : flag === 'mios' ? f.responsible_user_id === userId : flag === 'por_verificar' ? f.status === 'cerrado' : true)) &&
    (!q || `${f.code ?? ''} ${f.title} ${f.description ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at)), [findings, st, ty, co, q, ca, flag, userId, today]);

  return (
    <div>
      <PageHeader title="Hallazgos y no conformidades" subtitle={`${findings.filter(f => ['abierto', 'en_tratamiento'].includes(f.status)).length} abiertos de ${findings.length}`} />
      <div className="row gap wrap" style={{ marginBottom: '1rem' }}>
        <Input placeholder="Buscar" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <Select value={st} onChange={e => setSt(e.target.value)} options={[{ value: 'abiertos', label: 'Abiertos y en tratamiento' }, { value: '', label: 'Todos' }, ...Object.entries(LABELS.findingStatus).map(([value, label]) => ({ value, label }))]} style={{ maxWidth: 220 }} />
        <Select placeholder="Todos los tipos" value={ty} onChange={e => setTy(e.target.value)} options={Object.entries(LABELS.findingType).map(([value, label]) => ({ value, label }))} style={{ maxWidth: 240 }} />
        <Select placeholder="Todas las empresas" value={co} onChange={e => setCo(e.target.value)} options={[...cName].map(([value, label]) => ({ value, label }))} style={{ maxWidth: 220 }} />
        <Select placeholder="Todas las categorías" value={ca} onChange={e => setCa(e.target.value)} options={Object.entries(LABELS.category).map(([value, label]) => ({ value, label }))} style={{ maxWidth: 220 }} />
        <Select placeholder="Sin filtro especial" value={flag} onChange={e => setFlag(e.target.value)} options={[{ value: 'vencidos', label: 'Vencidos' }, { value: 'recurrentes', label: 'Recurrentes' }, { value: 'por_verificar', label: 'Pendientes de verificación' }, { value: 'mios', label: 'Bajo mi responsabilidad' }]} style={{ maxWidth: 240 }} />
      </div>
      {list.length === 0 ? <Empty>No hay hallazgos para el filtro.</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Código</th><th>Hallazgo</th><th>Tipo</th><th>Severidad</th><th>Empresa</th><th>Responsable</th><th>Auditoría</th><th>Vence</th><th>Acciones</th><th>Estado</th></tr></thead>
          <tbody>{list.map(f => {
            const acts = actions.filter(a => a.finding_id === f.id);
            const done = acts.filter(a => ['completada', 'verificada', 'cancelada'].includes(a.status)).length;
            const overdue = f.due_date && f.due_date < today && ['abierto', 'en_tratamiento'].includes(f.status);
            return (
              <tr key={f.id} className="clickable" onClick={() => nav(`/hallazgos/${f.id}`)}>
                <td className="mono">{f.code ?? '—'}</td><td><strong>{f.title}</strong>{f.recurrence_count > 0 ? <> <Badge tone="bad">Recurrente ×{f.recurrence_count + 1}</Badge></> : null}</td>
                <td className="small">{LABELS.findingType[f.finding_type]}</td><td><Badge tone={sevTone(f.severity)}>{LABELS.severity[f.severity]}</Badge></td>
                <td>{f.company_id ? cName.get(f.company_id) : '—'}</td><td className="small">{f.responsible_user_id ? people.get(f.responsible_user_id) ?? '—' : '—'}</td><td className="small">{aCode.get(f.audit_id)}</td>
                <td>{overdue ? <Badge tone="bad">{fmtDate(f.due_date)}</Badge> : fmtDate(f.due_date)}</td>
                <td className="num">{done}/{acts.length}</td>
                <td><Badge tone={findingTone(f.status)}>{LABELS.findingStatus[f.status]}</Badge> {pending.has(f.id) ? <Badge tone="warn">Pendiente</Badge> : null}</td>
              </tr>);
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}
