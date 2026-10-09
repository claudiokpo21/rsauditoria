import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useNameMap, useProfiles, useRecord } from '../../db/hooks';
import { patchRecord } from '../../db/repo';
import { useAuth } from '../auth/AuthProvider';
import { auditAccess, canWrite, useParticipants } from '../auth/access';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, TextArea, fmtDate, today, useToast } from '../../components/ui';
import { downloadBlob } from './excel';
import { loadAuditReport } from './reportData';
import { buildFinalReportPdf } from './finalPdf';
import { planHash, resolveReport, type PlanApproval, type PlanRow, type ReportData, type Strength } from './finalReport';
import { LABELS, type Audit } from '../../types';

const safe = (s: string) => s.replace(/[^\w\-.]+/g, '_').slice(0, 60);
type Draft = Required<ReportData>;
const APPROVAL_LABEL: Record<PlanApproval['status'], string> = { borrador: 'Borrador', enviado: 'Enviado al cliente', aprobado: 'Aceptado por el cliente' };
const APPROVAL_TONE: Record<PlanApproval['status'], 'neutral' | 'info' | 'ok'> = { borrador: 'neutral', enviado: 'info', aprobado: 'ok' };

/**
 * Plan de auditoría e informe final (modelo RS Consultora). El plan se arma antes de la
 * auditoría, se envía al cliente y se registra su aceptación; recién entonces se inicia.
 * El informe final reutiliza los datos del plan y agrega desarrollo, conclusiones,
 * fortalecimiento (fortalezas), recomendación y declaración del auditor.
 */
export function AuditDocsPage({ tab }: { tab: 'plan' | 'informe' }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { orgId, role, userId, current } = useAuth();
  const toast = useToast();
  const participants = useParticipants(orgId);
  const audit = useRecord<Audit>('hse_audits', id);
  const sections = useLiveQuery(async () => audit ? (await db.hse_template_sections.where('version_id').equals(audit.template_version_id).toArray()).filter(s => !s.deleted_at).sort((a, b) => a.sort_order - b.sort_order) : [], [audit?.template_version_id]) ?? [];
  const findingCount = useLiveQuery(async () => id ? (await db.hse_findings.where('audit_id').equals(id).toArray()).filter(f => !f.deleted_at).length : 0, [id]) ?? 0;
  const cName = useNameMap('hse_companies'); const lName = useNameMap('hse_locations');
  const people = useProfiles();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [photos, setPhotos] = useState(true);

  const ctx = useMemo(() => audit ? ({
    company: audit.company_id ? cName.get(audit.company_id) ?? '—' : '—',
    location: audit.location_id ? lName.get(audit.location_id) ?? '—' : '—',
    leadAuditor: audit.lead_auditor_id ? people.get(audit.lead_auditor_id) ?? '—' : '—',
    sections: sections.map(s => s.title.trim()),
  }) : null, [audit, cName, lName, people, sections]);

  // el borrador se arma una vez con lo guardado + valores sugeridos; si llega una versión nueva y no hay cambios locales, se refresca
  const serverJson = JSON.stringify(audit?.report_data ?? null);
  useEffect(() => {
    if (!audit || !ctx || !sections.length) return;
    if (draft && JSON.stringify(draft) !== savedJson) return;
    const d = resolveReport(audit, ctx);
    setDraft(d); setSavedJson(JSON.stringify(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverJson, ctx?.company, ctx?.location, ctx?.leadAuditor, sections.length]);

  if (audit === undefined) return null;
  if (audit === null) return <Empty>Auditoría no encontrada en este dispositivo.</Empty>;
  if (!draft) return <Empty>Cargando…</Empty>;

  const access = auditAccess(audit, role, userId, participants, current?.company_id);
  const writer = canWrite(access) && !['cerrada', 'cancelada'].includes(audit.status);
  const dirty = JSON.stringify(draft) !== savedJson;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const approval = draft.plan_approval ?? { status: 'borrador' };
  const changedAfterApproval = approval.status === 'aprobado' && !!approval.plan_hash && approval.plan_hash !== planHash(draft);

  const save = async (next: Draft = draft, msg = 'Guardado') => {
    await patchRecord<Audit>('hse_audits', audit.id, { report_data: next });
    setDraft(next); setSavedJson(JSON.stringify(next));
    if (msg) toast(msg);
  };
  const download = async (kind: 'plan' | 'final') => {
    setBusy(kind);
    try {
      if (writer && dirty) await save(draft, '');
      const r = await loadAuditReport(audit.id, current?.organization_name ?? '');
      const blob = await buildFinalReportPdf(r, kind, { includePhotos: photos });
      downloadBlob(blob, `${kind === 'plan' ? 'Plan_de_auditoria' : 'Informe_final'}_${safe(draft.contractor || audit.code || audit.title)}.pdf`);
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'bad'); } finally { setBusy(null); }
  };

  const planRows = draft.plan;
  const setRow = (i: number, p: Partial<PlanRow>) => set('plan', planRows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const moveRow = (i: number, d: -1 | 1) => { const a2 = [...planRows]; const j = i + d; if (j < 0 || j >= a2.length) return; [a2[i], a2[j]] = [a2[j], a2[i]]; set('plan', a2); };
  const strengths = draft.strengths;
  const setStrength = (i: number, p: Partial<Strength>) => set('strengths', strengths.map((s, j) => (j === i ? { ...s, ...p } : s)));

  const tabs = (
    <div className="seg-tabs" role="tablist">
      <Link role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'on' : ''} to={`/auditorias/${audit.id}/plan`}>1. Plan de auditoría</Link>
      <Link role="tab" aria-selected={tab === 'informe'} className={tab === 'informe' ? 'on' : ''} to={`/auditorias/${audit.id}/informe`}>2. Informe final</Link>
    </div>
  );

  return (
    <div className="stack-lg docs-page">
      <PageHeader title={tab === 'plan' ? 'Plan de auditoría' : 'Informe final'}
        subtitle={<>{audit.code ?? ''} · {ctx?.company} · {LABELS.auditStatus[audit.status]}</>}
        actions={<>
          <Badge tone={APPROVAL_TONE[approval.status]}>Plan: {APPROVAL_LABEL[approval.status]}</Badge>
          <Button variant="secondary" onClick={() => nav(`/auditorias/${audit.id}`)}>Volver a la auditoría</Button>
        </>} />
      {tabs}
      {!writer ? <div className="alert alert-info">Sólo lectura: {['cerrada', 'cancelada'].includes(audit.status) ? `la auditoría está ${LABELS.auditStatus[audit.status].toLowerCase()}.` : 'no tiene permiso para editar esta auditoría.'}</div> : null}
      <p className="muted small">En los textos: una línea que empieza con «- » es una viñeta, una línea en blanco separa párrafos y **así** queda en negrita.</p>

      {tab === 'plan' ? <>
        <Card title="Aceptación del cliente">
          <div className="stack">
            {approval.status === 'aprobado'
              ? <div className="alert alert-ok">Plan aceptado por <strong>{approval.approved_by}</strong> el {fmtDate(approval.approved_at)}.{approval.notes ? <> {approval.notes}</> : null} La auditoría ya se puede iniciar.</div>
              : approval.status === 'enviado'
                ? <div className="alert alert-info">Enviado al cliente{approval.sent_to ? <> ({approval.sent_to})</> : null} el {fmtDate(approval.sent_at)}. Cuando lo acepte, registrá la aceptación para habilitar la auditoría.</div>
                : <div className="alert alert-warn">La auditoría se inicia recién cuando el cliente acepta el plan. Completá el plan, descargá el PDF, envialo y registrá la aceptación.</div>}
            {changedAfterApproval ? <div className="alert alert-warn">El plan cambió después de que el cliente lo aceptó. Si el cambio es importante, volvé a enviarlo y registrá la nueva aceptación.</div> : null}
            <div className="row gap wrap">
              <Button busy={busy === 'plan'} onClick={() => void download('plan')}>Descargar plan (PDF)</Button>
              {writer && approval.status === 'borrador' ? <Button variant="secondary" onClick={() => void save({ ...draft, plan_approval: { ...approval, status: 'enviado', sent_at: today() } }, 'Plan marcado como enviado')}>Marcar como enviado</Button> : null}
              {writer && approval.status !== 'aprobado' ? <Button variant="secondary" onClick={() => setApprovalOpen(true)}>Registrar aceptación del cliente</Button> : null}
              {writer && approval.status === 'aprobado' && changedAfterApproval ? <Button variant="secondary" onClick={() => setApprovalOpen(true)}>Registrar nueva aceptación</Button> : null}
              {writer && approval.status === 'aprobado' && audit.status === 'planificada' ? <Button variant="ghost" onClick={() => void save({ ...draft, plan_approval: { status: 'enviado', sent_at: approval.sent_at ?? today(), sent_to: approval.sent_to } }, 'Aceptación anulada')}>Anular aceptación</Button> : null}
            </div>
          </div>
        </Card>

        <Card title="Datos generales">
          <div className="grid grid-2">
            <Field label="Título del plan"><Input disabled={!writer} value={draft.plan_title} onChange={e => set('plan_title', e.target.value)} /></Field>
            <Field label="Compañía solicitante" hint="Ej.: Pampa Energía E&P – Gerencia CSMS"><Input disabled={!writer} value={draft.requesting_company} onChange={e => set('requesting_company', e.target.value)} /></Field>
            <Field label="Empresa contratista"><Input disabled={!writer} value={draft.contractor} onChange={e => set('contractor', e.target.value)} /></Field>
            <Field label="Contrato"><Input disabled={!writer} value={draft.contract} onChange={e => set('contract', e.target.value)} /></Field>
            <Field label="Auditor responsable"><Input disabled={!writer} value={draft.lead_auditor} onChange={e => set('lead_auditor', e.target.value)} /></Field>
            <Field label="Fecha de realización" hint="Texto libre: «28 y 29-05-2026»"><Input disabled={!writer} value={draft.dates_text} onChange={e => set('dates_text', e.target.value)} /></Field>
          </div>
          <Field label="Lugares a auditar"><Input disabled={!writer} value={draft.places} onChange={e => set('places', e.target.value)} /></Field>
        </Card>
        <Card title="Objetivo y criterios">
          <Field label="Objetivo de la auditoría"><TextArea rows={5} disabled={!writer} value={draft.objectives} onChange={e => set('objectives', e.target.value)} /></Field>
          <Field label="Criterios de auditoría"><TextArea rows={5} disabled={!writer} value={draft.criteria} onChange={e => set('criteria', e.target.value)} /></Field>
        </Card>
        <Card title="Cronograma" actions={writer ? <Button variant="secondary" className="btn-sm" onClick={() => set('plan', [...planRows, { date: planRows[planRows.length - 1]?.date ?? '', time: '', process: '', auditees: '', topics: '' }])}>Agregar fila</Button> : null}>
          {!planRows.length ? <p className="muted small">Todavía no hay actividades. Agregá una fila por actividad: fecha, hora, proceso, auditados y temas. Las filas resaltadas (traslados, fin del día, reunión de cierre) salen en verde.</p> : null}
          <div className="plan-rows">
            {planRows.map((p, i) => (
              <div key={i} className={`plan-row ${p.highlight ? 'hl' : ''}`}>
                <Input aria-label="Fecha" placeholder="Fecha" disabled={!writer} value={p.date} onChange={e => setRow(i, { date: e.target.value })} />
                <Input aria-label="Hora" placeholder="Hora" disabled={!writer} value={p.time} onChange={e => setRow(i, { time: e.target.value })} />
                <TextArea dictation={false} rows={2} aria-label="Proceso a auditar" placeholder="Proceso a auditar" disabled={!writer} value={p.process} onChange={e => setRow(i, { process: e.target.value })} />
                {p.highlight ? <span className="muted small plan-hl-note">Fila resaltada</span> : <>
                  <TextArea dictation={false} rows={2} aria-label="Auditados disponibles" placeholder="Auditados disponibles" disabled={!writer} value={p.auditees} onChange={e => setRow(i, { auditees: e.target.value })} />
                  <TextArea dictation={false} rows={2} aria-label="Temas" placeholder="Temas" disabled={!writer} value={p.topics} onChange={e => setRow(i, { topics: e.target.value })} />
                </>}
                {writer ? <div className="plan-row-tools">
                  <label className="small row gap" title="Resaltar en verde"><input type="checkbox" checked={!!p.highlight} onChange={e => setRow(i, { highlight: e.target.checked })} /> Resaltar</label>
                  <Button variant="ghost" className="btn-sm" aria-label="Subir" onClick={() => moveRow(i, -1)}>↑</Button>
                  <Button variant="ghost" className="btn-sm" aria-label="Bajar" onClick={() => moveRow(i, 1)}>↓</Button>
                  <Button variant="ghost" className="btn-sm" aria-label="Quitar fila" onClick={() => set('plan', planRows.filter((_, j) => j !== i))}>✕</Button>
                </div> : null}
              </div>))}
          </div>
        </Card>
      </> : <>
        {approval.status !== 'aprobado' && audit.status === 'planificada' ? <div className="alert alert-warn">El plan todavía no está aceptado por el cliente. <Link to={`/auditorias/${audit.id}/plan`}>Ir al plan</Link></div> : null}
        <Card title="Descargar">
          <div className="stack">
            <p className="muted small">El informe toma los datos generales, objetivo, criterios y cronograma del plan; los hallazgos ({findingCount}) y el resultado salen de la auditoría. Las oportunidades de mejora, observaciones y no conformidades se agrupan por requisito.</p>
            <label className="row gap small"><input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} /> Incluir registro fotográfico</label>
            <div className="row gap wrap"><Button busy={busy === 'final'} onClick={() => void download('final')}>Descargar informe final (PDF)</Button>
              <Link className="btn btn-secondary" to={`/informes?audit=${audit.id}`}>Otros informes</Link></div>
          </div>
        </Card>
        <Card title="Título y desarrollo">
          <Field label="Título del informe"><Input disabled={!writer} value={draft.title} onChange={e => set('title', e.target.value)} /></Field>
          <Field label="Desarrollo de la auditoría" hint="Quién la solicitó, alcance, procesos revisados, recorrida, predisposición del personal."><TextArea rows={10} disabled={!writer} value={draft.development} onChange={e => set('development', e.target.value)} /></Field>
        </Card>
        <Card title="Conclusiones">
          <Field label="Conclusión general"><TextArea rows={6} disabled={!writer} value={draft.conclusions} onChange={e => set('conclusions', e.target.value)} /></Field>
          <p className="muted small">Procedimientos y herramientas en los que se verificó la conformidad, por requisito (salen con ✓). Dejá vacío el requisito que no corresponda. Para sub-viñetas: «- **CSMS:** texto».</p>
          {draft.conformities.map((c, i) => (
            <Field key={c.section + i} label={`✓ ${c.section}`}><TextArea rows={3} disabled={!writer} value={c.text} onChange={e => set('conformities', draft.conformities.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field>
          ))}
        </Card>
        <Card title="Fortalecimiento" actions={writer ? <Button variant="secondary" className="btn-sm" onClick={() => set('strengths', [...strengths, { area: '', text: '' }])}>Agregar fortaleza</Button> : null}>
          <p className="muted small">Fortalezas del contratista. En el informe salen en la sección «Fortalezas», numeradas.</p>
          {!strengths.length ? <p className="muted small">Sin fortalezas cargadas.</p> : null}
          {strengths.map((s, i) => (
            <div key={i} className="strength-row">
              <span className="strength-n">{String(i + 1).padStart(2, '0')}</span>
              <div className="stack" style={{ gap: '.5rem', flex: 1, minWidth: 0 }}>
                <Input aria-label="Área" placeholder="Área (ej.: OPERACIONES)" disabled={!writer} value={s.area} onChange={e => setStrength(i, { area: e.target.value })} />
                <TextArea rows={3} aria-label="Fortaleza" placeholder="Descripción de la fortaleza" disabled={!writer} value={s.text} onChange={e => setStrength(i, { text: e.target.value })} />
              </div>
              {writer ? <Button variant="ghost" className="btn-sm" aria-label="Quitar fortaleza" onClick={() => set('strengths', strengths.filter((_, j) => j !== i))}>✕</Button> : null}
            </div>))}
        </Card>
        <Card title="Cierre del informe">
          <Field label="Recomendación (debajo de la evaluación)"><TextArea rows={3} disabled={!writer} value={draft.recommendation} onChange={e => set('recommendation', e.target.value)} /></Field>
          <Field label="Declaración del auditor"><TextArea rows={4} disabled={!writer} value={draft.statement} onChange={e => set('statement', e.target.value)} /></Field>
          <p className="muted small">La firma del final es la del auditor líder registrada en la reunión de cierre; si no hay, queda la línea para firmar.</p>
        </Card>
      </>}

      {writer && dirty ? <div className="savebar"><span>Hay cambios sin guardar</span><Button onClick={() => void save()}>Guardar</Button></div> : null}

      <ApprovalModal open={approvalOpen} onClose={() => setApprovalOpen(false)} initial={approval}
        onSave={async a2 => { await save({ ...draft, plan_approval: { ...a2, status: 'aprobado', plan_hash: planHash(draft) } }, 'Aceptación registrada: ya se puede iniciar la auditoría'); setApprovalOpen(false); }} />
    </div>
  );
}

function ApprovalModal({ open, onClose, initial, onSave }: { open: boolean; onClose: () => void; initial: PlanApproval; onSave: (a: PlanApproval) => Promise<void> }) {
  const [f, setF] = useState<PlanApproval>({ ...initial, approved_at: initial.approved_at ?? today() });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ ...initial, approved_at: initial.approved_at ?? today() }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = (f.approved_by ?? '').trim().length >= 3 && !!f.approved_at;
  return (
    <Modal open={open} title="Aceptación del plan por el cliente" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!ok} busy={busy} onClick={async () => { setBusy(true); try { await onSave({ ...f, approved_by: f.approved_by!.trim(), notes: f.notes?.trim() || null }); } finally { setBusy(false); } }}>Registrar aceptación</Button></>}>
      <div className="stack">
        <Field label="Aceptado por" hint="Nombre, cargo y empresa de quien aceptó (ej.: Claudio Ciampa, Gerente HSE, Pampa Energía)" required><Input autoFocus value={f.approved_by ?? ''} onChange={e => setF({ ...f, approved_by: e.target.value })} /></Field>
        <Field label="Fecha de aceptación" required><Input type="date" value={f.approved_at ?? ''} onChange={e => setF({ ...f, approved_at: e.target.value })} /></Field>
        <Field label="Medio o comentario" hint="Ej.: correo del 20/05/2026"><TextArea dictation={false} rows={2} value={f.notes ?? ''} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
