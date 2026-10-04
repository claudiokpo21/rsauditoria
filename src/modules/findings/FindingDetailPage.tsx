import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useNameMap, useRecord, useProfiles, usePendingSet } from '../../db/hooks';
import { patchRecord } from '../../db/repo';
import { supabase, errorMessage } from '../../lib/supabase';
import { runSync } from '../../sync/scheduler';
import { useAuth, can } from '../auth/AuthProvider';
import { auditAccess, canWrite, findingAccess, useParticipants } from '../auth/access';
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Select, TextArea, displayText, fmtDate, fmtDateTime, useToast } from '../../components/ui';
import { RecordHistory } from '../../components/RecordHistory';
import { EvidenceStrip } from '../evidences/EvidenceStrip';
import { FindingForm, isNc } from './FindingForm';
import { RcaEditor } from './RcaEditor';
import { ActionForm } from '../actions/ActionForm';
import { findingTone, sevTone } from './FindingsPage';
import { LABELS, type Action, type Audit, type Finding, type TemplateItem } from '../../types';

type Dialog = null | 'cerrar' | 'verificar' | 'reabrir' | 'reabrir_verificado';

/** Reglas de cierre que también aplica el servidor (hse_guard_finding / hse_findings_rules). */
export function closeBlockers(f: Finding, actions: Action[]): string[] {
  const live = actions.filter(a => !a.deleted_at);
  const out: string[] = [];
  const open = live.filter(a => !['completada', 'verificada', 'cancelada'].includes(a.status));
  if (open.length) out.push(`${open.length} acción/es sin completar`);
  if (isNc(f.finding_type)) {
    if (!f.root_cause?.trim()) out.push('falta el análisis de causa raíz');
    if (!live.some(a => a.action_type === 'correctiva' && a.status !== 'cancelada')) out.push('falta al menos una acción correctiva');
  }
  return out;
}
export function verifyBlockers(f: Finding, actions: Action[], userId: string): string[] {
  const live = actions.filter(a => !a.deleted_at);
  const out: string[] = [];
  if (f.status !== 'cerrado') out.push('el hallazgo debe estar cerrado (pendiente de verificación)');
  const unverified = live.filter(a => !['verificada', 'cancelada'].includes(a.status));
  if (unverified.length) out.push(`${unverified.length} acción/es sin verificar`);
  if (isNc(f.finding_type) && !live.some(a => a.status === 'verificada')) out.push('una no conformidad requiere al menos una acción verificada');
  if (live.some(a => a.responsible_user_id === userId)) out.push('usted es responsable de una acción: la verificación debe hacerla otra persona');
  return out;
}

export function FindingDetailPage() {
  const { id } = useParams();
  const { orgId, role, userId, current } = useAuth();
  const toast = useToast();
  const f = useRecord<Finding>('hse_findings', id);
  const audit = useRecord<Audit>('hse_audits', f?.audit_id);
  const item = useRecord<TemplateItem>('hse_template_items', f?.item_id ?? undefined);
  const prev = useRecord<Finding>('hse_findings', f?.recurrence_of ?? undefined);
  const participants = useParticipants(orgId);
  const actions = useLiveQuery(async () => id ? (await db.hse_actions.where('finding_id').equals(id).toArray()).filter(a => !a.deleted_at).sort((a, b) => a.due_date.localeCompare(b.due_date)) : [], [id]) ?? [];
  const cName = useNameMap('hse_companies'); const lName = useNameMap('hse_locations'); const pName = useNameMap('hse_processes'); const people = useProfiles();
  const pending = usePendingSet('hse_findings');
  const [edit, setEdit] = useState(false);
  const [act, setAct] = useState<Partial<Action> | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notes, setNotes] = useState(''); const [eff, setEff] = useState<'' | 'eficaz' | 'no_eficaz'>(''); const [busy, setBusy] = useState(false);
  if (f === undefined) return null;
  if (f === null) return <Empty>Hallazgo no encontrado en este dispositivo.</Empty>;

  const aAcc = auditAccess(audit, role, userId, participants, current?.company_id);
  const acc = findingAccess(f, aAcc, userId, actions, role);
  const writer = canWrite(acc);
  const today = new Date().toISOString().slice(0, 10);
  const closeB = closeBlockers(f, actions);
  const verifyB = verifyBlockers(f, actions, userId);
  const isVerifier = writer && can(role, 'verify');

  const confirm = async () => {
    setBusy(true);
    try {
      if (dialog === 'cerrar') {
        if (closeB.length) { toast(`No se puede cerrar: ${closeB.join('; ')}`, 'bad'); return; }
        await patchRecord<Finding>('hse_findings', f.id, { status: 'cerrado' });
        toast('Hallazgo cerrado: queda pendiente la verificación de eficacia');
      } else if (dialog === 'verificar') {
        if (verifyB.length) { toast(`No se puede verificar: ${verifyB.join('; ')}`, 'bad'); return; }
        if (notes.trim().length < 10 || !eff) { toast('Describa la evidencia de la verificación e indique el resultado', 'bad'); return; }
        await patchRecord<Finding>('hse_findings', f.id, { status: 'verificado', verification_notes: notes.trim(), effectiveness: eff });
        toast('Verificación registrada (cierre definitivo)');
      } else if (dialog === 'reabrir') {
        await patchRecord<Finding>('hse_findings', f.id, { status: 'en_tratamiento' });
        toast('Hallazgo reabierto');
      } else if (dialog === 'reabrir_verificado') {
        if (notes.trim().length < 20) { toast('El motivo debe tener al menos 20 caracteres', 'bad'); return; }
        const { error } = await supabase.rpc('hse_reopen_finding', { p_finding: f.id, p_reason: notes.trim() });
        if (error) throw error;
        await runSync();
        toast('Hallazgo reabierto; la reapertura quedó registrada');
      }
      setDialog(null); setNotes(''); setEff('');
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };

  return (
    <div className="stack-lg">
      <PageHeader title={f.title} subtitle={<>{f.code ?? 'Código al sincronizar'} · {audit ? <Link to={`/auditorias/${audit.id}`}>{audit.code ?? audit.title}</Link> : 'auditoría no disponible'} · detectado {fmtDate(f.detected_at)}</>}
        actions={<>
          <Badge tone={findingTone(f.status)}>{LABELS.findingStatus[f.status]}</Badge>
          {pending.has(f.id) ? <Badge tone="warn">Pendiente de sincronizar</Badge> : null}
          {writer && f.status !== 'verificado' ? <Button variant="secondary" onClick={() => setEdit(true)}>Editar</Button> : null}
          {writer && ['abierto', 'en_tratamiento'].includes(f.status) ? <Button onClick={() => setDialog('cerrar')}>Cerrar</Button> : null}
          {writer && f.status === 'cerrado' ? <Button variant="secondary" onClick={() => setDialog('reabrir')}>Reabrir</Button> : null}
          {isVerifier && f.status === 'cerrado' ? <Button onClick={() => setDialog('verificar')}>Verificar eficacia</Button> : null}
          {can(role, 'reopen_finding') && f.status === 'verificado' ? <Button variant="secondary" disabled={!navigator.onLine} onClick={() => setDialog('reabrir_verificado')}>Reabrir (autorización)</Button> : null}
        </>} />
      {f.recurrence_count > 0 ? (
        <div className="alert alert-warn">Hallazgo <strong>recurrente</strong>: es la {f.recurrence_count + 1}.ª vez que se detecta en esta empresa para el mismo requisito.
          {prev ? <> Anterior: <Link to={`/hallazgos/${prev.id}`}>{prev.code ?? prev.title}</Link> ({LABELS.findingStatus[prev.status]}).</> : null}</div>
      ) : null}
      <div className="grid grid-2">
        <Card title="Detalle">
          <dl className="stack small" style={{ margin: 0 }}>
            <div className="row gap wrap">
              <Badge>{LABELS.findingType[f.finding_type]}</Badge><Badge tone={sevTone(f.severity)}>Severidad {LABELS.severity[f.severity].toLowerCase()}</Badge>
              {f.category ? <Badge tone="info">{LABELS.category[f.category]}</Badge> : null}
              {f.due_date ? <Badge tone={f.due_date < today && ['abierto', 'en_tratamiento'].includes(f.status) ? 'bad' : 'neutral'}>Vence {fmtDate(f.due_date)}</Badge> : null}
            </div>
            <div><strong>Responsable:</strong> {f.responsible_user_id ? people.get(f.responsible_user_id) ?? 'usuario de la organización' : '—'}</div>
            <div><strong>Empresa:</strong> {f.company_id ? cName.get(f.company_id) : '—'} · <strong>Ubicación:</strong> {f.location_id ? lName.get(f.location_id) : '—'}{f.process_id ? <> · <strong>Proceso:</strong> {pName.get(f.process_id)}</> : null}</div>
            {item ? <div><strong>Pregunta {item.original_number ?? item.code ?? ''}:</strong> <span className="pre">{displayText(item.question)}</span></div> : <div className="muted">Hallazgo general (sin pregunta asociada)</div>}
            {f.requirement ? <div><strong>Requisito incumplido:</strong> {f.requirement}</div> : null}
            {f.legal_reference ? <div><strong>Referencia legal:</strong> {f.legal_reference}</div> : null}
            <div><strong>Descripción objetiva:</strong><div className="pre">{f.description || '—'}</div></div>
            <div><strong>Acción inmediata:</strong><div className="pre">{f.immediate_action || '—'}</div></div>
            {f.closed_at ? <div className="muted">Cerrado {fmtDate(f.closed_at)}{f.closed_by ? ` por ${people.get(f.closed_by) ?? 'usuario de la organización'}` : ''}</div> : null}
          </dl>
        </Card>
        <Card title="Evidencias del hallazgo">
          {audit ? <EvidenceStrip readOnly={!writer || f.status === 'verificado'} target={{ organization_id: orgId, audit_id: audit.id, finding_id: f.id }} filter={{ finding_id: f.id }} /> : null}
        </Card>
      </div>

      <Card title="Análisis de causa raíz">
        <RcaEditor key={`${f.id}-${f.updated_at ?? ''}-${f.root_cause ?? ''}`} finding={f} readOnly={!writer || ['cerrado', 'verificado'].includes(f.status)} />
      </Card>

      <Card title={`Plan de acción (${actions.length})`} actions={writer && ['abierto', 'en_tratamiento'].includes(f.status) ? <Button className="btn-sm" onClick={() => setAct({})}>Agregar acción</Button> : null}>
        {actions.length === 0 ? <p className="muted small">Sin acciones. Defina acciones de contención, correctivas y preventivas, con responsable, vencimiento y criterio de eficacia.</p> : (
          <div className="table-wrap"><table className="t t-stack">
            <thead><tr><th>Acción</th><th>Tipo</th><th>Responsable</th><th>Vence</th><th>Estado</th></tr></thead>
            <tbody>{actions.map(a => (
              <tr key={a.id} className="clickable" onClick={() => setAct(a)}>
                <td data-label="Acción" className="pre">{a.description}{a.effectiveness_criteria ? <div className="muted small">Eficacia: {a.effectiveness_criteria}</div> : null}</td>
                <td data-label="Tipo">{LABELS.actionType[a.action_type]}</td>
                <td data-label="Responsable">{a.responsible_user_id ? people.get(a.responsible_user_id) ?? 'usuario' : a.responsible_name ?? '—'}<div className="muted small">{a.responsible_company_id ? cName.get(a.responsible_company_id) : ''}</div></td>
                <td data-label="Vence">{a.due_date < today && ['pendiente', 'en_curso'].includes(a.status) ? <Badge tone="bad">{fmtDate(a.due_date)}</Badge> : fmtDate(a.due_date)}</td>
                <td data-label="Estado"><Badge tone={a.status === 'verificada' || a.status === 'completada' ? 'ok' : a.status === 'cancelada' ? 'neutral' : 'warn'}>{LABELS.actionStatus[a.status]}</Badge>{a.effectiveness ? <div className="small muted">{a.effectiveness === 'eficaz' ? 'Eficaz' : 'No eficaz'}</div> : null}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      {f.status === 'verificado' || f.verification_notes ? (
        <Card title="Verificación de eficacia">
          <div className="small stack">
            <div><Badge tone={f.effectiveness === 'eficaz' ? 'ok' : 'bad'}>{f.effectiveness === 'eficaz' ? 'Eficaz' : f.effectiveness === 'no_eficaz' ? 'No eficaz' : '—'}</Badge> {f.verified_at ? <span className="muted">· {fmtDateTime(f.verified_at)}{f.verified_by ? ` · ${people.get(f.verified_by) ?? 'usuario de la organización'}` : ''}</span> : null}</div>
            <div className="pre">{f.verification_notes}</div>
            {f.effectiveness === 'no_eficaz' ? <div className="alert alert-warn">La acción no fue eficaz: registre un nuevo hallazgo o reabra éste con autorización.</div> : null}
          </div>
        </Card>
      ) : null}

      <Card><RecordHistory table="hse_findings" id={f.id} /></Card>

      {edit ? <FindingForm initial={f} onClose={() => setEdit(false)} /> : null}
      {act ? <ActionForm initial={act} finding={f} findingAccess={acc} onClose={() => setAct(null)} /> : null}
      <Modal open={!!dialog} onClose={() => setDialog(null)}
        title={dialog === 'verificar' ? 'Verificar eficacia (cierre definitivo)' : dialog === 'reabrir' ? 'Reabrir hallazgo' : dialog === 'reabrir_verificado' ? 'Reabrir hallazgo verificado' : 'Cerrar hallazgo'}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button busy={busy} onClick={confirm}
          disabled={(dialog === 'cerrar' && closeB.length > 0) || (dialog === 'verificar' && verifyB.length > 0)}>Confirmar</Button></>}>
        {dialog === 'cerrar' ? (closeB.length
          ? <div className="alert alert-warn">No se puede cerrar todavía: {closeB.join('; ')}. El servidor aplica las mismas reglas.</div>
          : <p className="small">El hallazgo queda <strong>cerrado, pendiente de verificación de eficacia</strong>. El cierre definitivo lo hace un auditor o coordinador que no sea responsable de las acciones.</p>) : null}
        {dialog === 'verificar' ? <>
          {verifyB.length ? <div className="alert alert-warn">No se puede verificar: {verifyB.join('; ')}.</div> : null}
          <Field label="Evidencia de la verificación" required hint="Qué se revisó para comprobar que el desvío no se repite"><TextArea rows={4} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
          <Field label="Resultado" required><Select placeholder="—" value={eff} onChange={e => setEff(e.target.value as typeof eff)} options={[{ value: 'eficaz', label: 'Eficaz' }, { value: 'no_eficaz', label: 'No eficaz' }]} /></Field>
        </> : null}
        {dialog === 'reabrir' ? <p className="small">El hallazgo vuelve a "en tratamiento".</p> : null}
        {dialog === 'reabrir_verificado' ? <>
          <p className="small">Un hallazgo verificado está cerrado definitivamente. La reapertura queda registrada con su usuario y motivo.</p>
          <Field label="Motivo (mínimo 20 caracteres)" required><TextArea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        </> : null}
      </Modal>
    </div>
  );
}
