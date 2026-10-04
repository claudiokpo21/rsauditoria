import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta } from '../../db/db';
import { newId, nowIso, patchRecord, saveRecord, softDelete } from '../../db/repo';
import { useAuth } from '../auth/AuthProvider';
import { usePendingSet } from '../../db/hooks';
import { Badge, Button, Card, Field, Input, Modal, Select, TextArea, fmtDate, useToast } from '../../components/ui';
import { LABELS, type Audit, type AuditSignature, type SignerRole } from '../../types';

/** Firma manuscrita con el dedo o el lápiz; exporta un PNG de 600×200 (liviano, apto para el PDF). */
function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);

  const setup = () => {
    const c = ref.current; if (!c) return;
    const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0f2340';
    strokes.current = 0; onChange(null);
  };
  useEffect(() => { setup(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const exportPng = () => {
    const c = ref.current!; const out = document.createElement('canvas'); out.width = 600; out.height = 200;
    out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  };
  return (
    <div className="stack" style={{ gap: '.35rem' }}>
      <canvas ref={ref} className="sigpad" aria-label="Recuadro para firmar"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; last.current = pos(e); }}
        onPointerMove={e => {
          if (!drawing.current || !last.current) return;
          const g = ref.current!.getContext('2d')!; const p = pos(e);
          g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke(); last.current = p;
        }}
        onPointerUp={() => { if (drawing.current) { drawing.current = false; last.current = null; strokes.current++; onChange(exportPng()); } }}
        onPointerCancel={() => { drawing.current = false; last.current = null; }} />
      <div className="row between small"><span className="muted">Firme dentro del recuadro.</span><Button type="button" variant="ghost" className="btn-sm" onClick={setup}>Borrar y volver a firmar</Button></div>
    </div>
  );
}

const ROLE_OPTS = Object.entries(LABELS.signerRole).map(([value, label]) => ({ value, label }));

/**
 * Acta de la reunión de cierre (fecha, asistentes, acuerdos) y firmas en campo.
 * Funciona sin conexión: las firmas se guardan en el dispositivo y se envían al sincronizar.
 * Una firma no se modifica; si hubo un error se da de baja y se firma de nuevo.
 */
export function ClosingMeetingCard({ audit, writer, companyName, leadName }: { audit: Audit; writer: boolean; companyName: string; leadName: string }) {
  const { orgId } = useAuth();
  const toast = useToast();
  const signatures = useLiveQuery(async () => (await db.hse_audit_signatures.where('audit_id').equals(audit.id).toArray())
    .filter(s => !s.deleted_at).sort((a, b) => a.signed_at.localeCompare(b.signed_at)), [audit.id]) ?? [];
  const pending = usePendingSet('hse_audit_signatures');
  const serverMissing = useLiveQuery(() => getMeta<boolean>('missing_table:hse_audit_signatures'), []) === true;
  const locked = !writer || ['cerrada', 'cancelada'].includes(audit.status) || serverMissing;
  const [acta, setActa] = useState({ closing_meeting_at: audit.closing_meeting_at ?? '', closing_attendees: audit.closing_attendees ?? '', closing_agreements: audit.closing_agreements ?? '' });
  useEffect(() => { setActa({ closing_meeting_at: audit.closing_meeting_at ?? '', closing_attendees: audit.closing_attendees ?? '', closing_agreements: audit.closing_agreements ?? '' }); },
    [audit.closing_meeting_at, audit.closing_attendees, audit.closing_agreements]);
  const dirty = acta.closing_meeting_at !== (audit.closing_meeting_at ?? '') || acta.closing_attendees !== (audit.closing_attendees ?? '') || acta.closing_agreements !== (audit.closing_agreements ?? '');
  const [sign, setSign] = useState<Partial<AuditSignature> | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [remove, setRemove] = useState<AuditSignature | null>(null);

  const saveActa = async () => {
    await patchRecord<Audit>('hse_audits', audit.id, { closing_meeting_at: acta.closing_meeting_at || null, closing_attendees: acta.closing_attendees.trim() || null, closing_agreements: acta.closing_agreements.trim() || null });
    toast('Acta guardada');
  };
  const openSign = () => {
    const hasLead = signatures.some(s => s.signer_role === 'auditor_lider');
    setPng(null);
    setSign(hasLead ? { signer_role: 'representante_contratista', signer_name: '', signer_company: companyName, signer_position: '', agreement: 'conforme', observations: '' }
                    : { signer_role: 'auditor_lider', signer_name: leadName, signer_company: '', signer_position: '', agreement: 'conforme', observations: '' });
  };
  const saveSign = async () => {
    if (!sign || !png) return;
    await saveRecord<AuditSignature>('hse_audit_signatures', {
      id: newId(), organization_id: orgId, audit_id: audit.id, signer_role: sign.signer_role as SignerRole, signer_name: (sign.signer_name ?? '').trim(),
      signer_position: sign.signer_position?.trim() || null, signer_company: sign.signer_company?.trim() || null, agreement: sign.agreement ?? 'conforme',
      observations: sign.agreement === 'con_observaciones' ? (sign.observations ?? '').trim() : null, signature_png: png, signed_at: nowIso(),
    } as AuditSignature);
    setSign(null); toast(navigator.onLine ? 'Firma registrada' : 'Firma guardada en el dispositivo; se enviará al sincronizar');
  };
  const canSave = !!png && (sign?.signer_name ?? '').trim().length >= 2 && (sign?.agreement !== 'con_observaciones' || (sign?.observations ?? '').trim().length >= 3);

  return (
    <Card title="Reunión de cierre y firmas" actions={!locked ? <Button className="btn-sm" onClick={openSign}>Agregar firma</Button> : null}>
      {serverMissing ? <div className="alert alert-warn small" style={{ marginBottom: '.75rem' }}>El acta y las firmas estarán disponibles cuando se actualice la base de datos del servidor (migración 0025).</div> : null}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Field label="Fecha de la reunión"><Input type="date" disabled={locked} value={acta.closing_meeting_at} onChange={e => setActa({ ...acta, closing_meeting_at: e.target.value })} style={{ maxWidth: 200 }} /></Field>
          <Field label="Asistentes" hint="Nombre, empresa y cargo de cada participante."><TextArea disabled={locked} value={acta.closing_attendees} onChange={e => setActa({ ...acta, closing_attendees: e.target.value })} /></Field>
          <Field label="Acuerdos y compromisos"><TextArea rows={4} disabled={locked} value={acta.closing_agreements} onChange={e => setActa({ ...acta, closing_agreements: e.target.value })} /></Field>
          {!locked ? <div><Button variant="secondary" disabled={!dirty} onClick={() => void saveActa()}>Guardar acta</Button></div> : null}
        </div>
        <div className="stack">
          {signatures.length === 0 ? <p className="muted small">Todavía no hay firmas. Al terminar la reunión, el auditor y el representante del contratista firman en este equipo, también sin conexión.</p> : (
            <div className="sig-grid">{signatures.map(s => (
              <figure key={s.id} className="sig">
                <img src={s.signature_png} alt={`Firma de ${s.signer_name}`} />
                <figcaption>
                  <strong>{s.signer_name}</strong>
                  <span className="small muted">{LABELS.signerRole[s.signer_role]}{s.signer_position ? ` · ${s.signer_position}` : ''}{s.signer_company ? ` · ${s.signer_company}` : ''}</span>
                  <span className="small">{new Date(s.signed_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} · <Badge tone={s.agreement === 'conforme' ? 'ok' : 'warn'}>{LABELS.agreement[s.agreement]}</Badge>{pending.has(s.id) ? <> <Badge tone="warn">Sin enviar</Badge></> : null}</span>
                  {s.observations ? <span className="small pre">{s.observations}</span> : null}
                  {!locked ? <Button variant="ghost" className="btn-sm" onClick={() => setRemove(s)}>Dar de baja</Button> : null}
                </figcaption>
              </figure>))}
            </div>
          )}
          {audit.closing_meeting_at ? <p className="small muted" style={{ margin: 0 }}>Reunión del {fmtDate(audit.closing_meeting_at)}. Las firmas y el acta salen en el informe PDF.</p> : null}
        </div>
      </div>

      <Modal open={!!sign} title="Firma" onClose={() => setSign(null)}
        footer={<><Button variant="secondary" onClick={() => setSign(null)}>Cancelar</Button><Button disabled={!canSave} onClick={() => void saveSign()}>Guardar firma</Button></>}>
        {sign ? <>
          <div className="grid grid-2">
            <Field label="Firma como"><Select value={sign.signer_role} options={ROLE_OPTS} onChange={e => {
              const r = e.target.value as SignerRole;
              setSign({ ...sign, signer_role: r, signer_company: r === 'representante_contratista' ? companyName : sign.signer_company, signer_name: r === 'auditor_lider' && !sign.signer_name ? leadName : sign.signer_name });
            }} /></Field>
            <Field label="Nombre y apellido" required><Input value={sign.signer_name ?? ''} onChange={e => setSign({ ...sign, signer_name: e.target.value })} autoComplete="off" /></Field>
            <Field label="Cargo"><Input value={sign.signer_position ?? ''} onChange={e => setSign({ ...sign, signer_position: e.target.value })} /></Field>
            <Field label="Empresa"><Input value={sign.signer_company ?? ''} onChange={e => setSign({ ...sign, signer_company: e.target.value })} /></Field>
          </div>
          <div className="row gap wrap" role="radiogroup" aria-label="Conformidad">
            {(['conforme', 'con_observaciones'] as const).map(a => (
              <button key={a} type="button" role="radio" aria-checked={sign.agreement === a} className={`opt ${sign.agreement === a ? (a === 'conforme' ? 'sel-ok' : 'sel-obs') : ''}`} onClick={() => setSign({ ...sign, agreement: a })}>{LABELS.agreement[a]}</button>
            ))}
          </div>
          {sign.agreement === 'con_observaciones' ? <Field label="Observaciones del firmante" required><TextArea value={sign.observations ?? ''} onChange={e => setSign({ ...sign, observations: e.target.value })} /></Field> : null}
          <p className="small muted" style={{ margin: 0 }}>Al firmar, la persona deja constancia de haber participado de la reunión de cierre y de su conformidad con el acta y el resultado presentados.</p>
          <SignaturePad onChange={setPng} />
        </> : null}
      </Modal>
      <Modal open={!!remove} title="Dar de baja la firma" onClose={() => setRemove(null)}
        footer={<><Button variant="secondary" onClick={() => setRemove(null)}>Cancelar</Button><Button variant="danger" onClick={async () => { if (remove) await softDelete('hse_audit_signatures', remove.id); setRemove(null); }}>Dar de baja</Button></>}>
        <p style={{ margin: 0 }}>La firma de <strong>{remove?.signer_name}</strong> deja de figurar en el acta. Queda registrada en el historial de cambios y no se puede restaurar; si fue un error, vuelva a firmar.</p>
      </Modal>
    </Card>
  );
}
