import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { supabase, errorMessage } from '../../lib/supabase';
import { runSync } from '../../sync/scheduler';
import { db } from '../../db/db';
import { newId, patchRecord, saveRecord } from '../../db/repo';
import { useOrgRows } from '../../db/hooks';
import { DemoButton } from '../demo/DemoButton';
import { useAuth, can } from '../auth/AuthProvider';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, TextArea, fmtDate, useToast } from '../../components/ui';
import { LABELS, type Audit, type AuditParticipant, type Company, type Role } from '../../types';
import { AUDIT_FIRM } from '../../config/brand';

interface AdminMember {
  membership_id: string; user_id: string; email: string | null; full_name: string | null; job_title: string | null; phone: string | null;
  role: Role; company_id: string | null; active: boolean; member_since: string; last_sign_in_at: string | null;
  email_confirmed: boolean; audits_assigned: number; actions_open: number;
}
interface Invitation { id: string; email: string; role: Role; company_id: string | null; expires_at: string; created_at: string }
type Tab = 'usuarios' | 'invitaciones' | 'permisos' | 'organizacion';

/** Qué hace cada rol, en una línea (se muestra al elegirlo). */
export const ROLE_INFO: Record<Role, string> = {
  owner: 'Todo, incluso designar otros propietarios. Siempre debe quedar al menos uno.',
  admin: 'Gestiona usuarios y permisos, reabre auditorías cerradas y todo lo demás.',
  supervisor: 'Empresas, listas de verificación, planificación, asignación de equipos, revisión y cierre.',
  auditor: 'Ejecuta las auditorías asignadas, registra hallazgos y verifica eficacia.',
  action_owner: 'Ve e informa el avance de las acciones y hallazgos a su cargo.',
  viewer: 'Sólo consulta tableros, auditorías e informes.',
  contractor: 'Ve lo de su empresa (y subcontratistas) e informa el avance de sus acciones.',
};
const ROLE_ORDER: Role[] = ['owner', 'admin', 'supervisor', 'auditor', 'action_owner', 'contractor', 'viewer'];

/** Matriz de permisos (refleja las políticas del servidor; ver docs/politicas-rls.md). */
const MATRIX: { what: string; cells: Partial<Record<Role, string>> }[] = [
  { what: 'Gestionar usuarios y permisos', cells: { owner: 'si', admin: 'si' } },
  { what: 'Empresas, ubicaciones y listas de verificación', cells: { owner: 'si', admin: 'si', supervisor: 'si' } },
  { what: 'Crear y planificar auditorías', cells: { owner: 'si', admin: 'si', supervisor: 'si', auditor: 'Propias' } },
  { what: 'Asignar el equipo auditor', cells: { owner: 'si', admin: 'si', supervisor: 'si' } },
  { what: 'Ejecutar auditorías (respuestas, fotos, firmas)', cells: { owner: 'si', admin: 'si', supervisor: 'si', auditor: 'Asignadas' } },
  { what: 'Registrar hallazgos', cells: { owner: 'si', admin: 'si', supervisor: 'si', auditor: 'Asignadas' } },
  { what: 'Revisar y cerrar auditorías', cells: { owner: 'si', admin: 'si', supervisor: 'si' } },
  { what: 'Reabrir una auditoría cerrada', cells: { owner: 'si', admin: 'si' } },
  { what: 'Informar avance de acciones', cells: { owner: 'si', admin: 'si', supervisor: 'si', auditor: 'Asignadas', action_owner: 'A su cargo', contractor: 'Su empresa' } },
  { what: 'Verificar eficacia', cells: { owner: 'si', admin: 'si', supervisor: 'si', auditor: 'si' } },
  { what: 'Ver historial de cambios', cells: { owner: 'si', admin: 'si', supervisor: 'si' } },
  { what: 'Ver tableros e informes', cells: { owner: 'si', admin: 'si', supervisor: 'si', auditor: 'si', viewer: 'si', action_owner: 'Lo suyo', contractor: 'Su empresa' } },
];

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
function ago(iso: string | null) {
  if (!iso) return 'Nunca ingresó';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'Hoy' : d === 1 ? 'Ayer' : d < 30 ? `Hace ${d} días` : fmtDate(iso);
}

/** Mensaje para mandar por WhatsApp o correo (todavía no hay envío automático de mails). */
export function inviteMessage(email: string, role: Role, org: string, expires?: string) {
  const link = `${window.location.origin}/?invitacion=${encodeURIComponent(email)}`;
  return `Hola. Te invité a la aplicación de auditorías HSE de ${AUDIT_FIRM.name} (${org}) como ${LABELS.role[role]}.\n\n` +
    `1. Entrá a ${link}\n2. Tocá «Crear cuenta» con este mismo correo: ${email}\n3. Confirmá el mail que te llega y volvé a ingresar.\n\n` +
    `La invitación vence el ${fmtDate(expires ?? new Date(Date.now() + 14 * 86400000).toISOString())}.`;
}

function ShareButtons({ text, email }: { text: string; email?: string }) {
  const toast = useToast();
  return (
    <div className="row gap wrap">
      <Button variant="secondary" className="btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Mensaje copiado'); } catch { toast('No se pudo copiar: selecciónelo y cópielo a mano', 'bad'); } }}>Copiar mensaje</Button>
      <a className="btn btn-secondary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
      {email ? <a className="btn btn-secondary btn-sm" href={`mailto:${email}?subject=${encodeURIComponent('Invitación a Auditorías HSE')}&body=${encodeURIComponent(text)}`}>Enviar por correo</a> : null}
    </div>
  );
}

function RolePicker({ value, onChange, allowOwner }: { value: Role; onChange: (r: Role) => void; allowOwner: boolean }) {
  return (
    <div className="role-picker" role="radiogroup" aria-label="Rol">
      {ROLE_ORDER.filter(r => r !== 'owner' || allowOwner).map(r => (
        <label key={r} className={`role-card ${value === r ? 'sel' : ''}`}>
          <input type="radio" name="rol" value={r} checked={value === r} onChange={() => onChange(r)} />
          <span><strong>{LABELS.role[r]}</strong><span className="small muted">{ROLE_INFO[r]}</span></span>
        </label>
      ))}
    </div>
  );
}

export function MembersPage() {
  const { orgId, role, current, refresh, userId } = useAuth();
  const toast = useToast();
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const [tab, setTab] = useState<Tab>('usuarios');
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [inv, setInv] = useState<{ emails: string; role: Role; company_id: string } | null>(null);
  const [sent, setSent] = useState<{ email: string; ok: boolean; status: string }[] | null>(null);
  const [edit, setEdit] = useState<AdminMember | null>(null);
  const [org, setOrg] = useState<{ name: string; tax_id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const online = navigator.onLine;
  const orgName = current?.organization_name ?? '';
  const companyName = (id: string | null) => (id ? companies.find(c => c.id === id)?.name ?? '—' : '—');

  const load = async () => {
    setLoadErr(null);
    const [m, i] = await Promise.all([
      supabase.rpc('hse_admin_members', { p_org: orgId }),
      supabase.from('hse_invitations').select('id,email,role,company_id,expires_at,created_at').eq('organization_id', orgId).is('accepted_at', null).order('created_at', { ascending: false }),
    ]);
    if (m.error) setLoadErr(m.error.code === 'PGRST202' ? 'Falta aplicar la migración 0026 (panel de administración) en Supabase.' : errorMessage(m.error));
    else setMembers((m.data ?? []) as AdminMember[]);
    setInvites((i.data ?? []) as Invitation[]);
  };
  useEffect(() => { if (online && can(role, 'admin')) void load(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => (members ?? []).filter(m => (!roleFilter || m.role === roleFilter)
    && (!q || `${m.full_name ?? ''} ${m.email ?? ''} ${m.job_title ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [members, q, roleFilter]);

  if (!can(role, 'admin')) return <Empty>Sólo propietarios y administradores gestionan usuarios y permisos.</Empty>;

  const stats = {
    active: (members ?? []).filter(m => m.active).length,
    never: (members ?? []).filter(m => m.active && !m.last_sign_in_at).length,
    inactive: (members ?? []).filter(m => !m.active).length,
  };

  const doInvite = async () => {
    if (!inv) return;
    const emails = [...new Set(inv.emails.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) { toast('Escriba al menos un correo', 'bad'); return; }
    const bad = emails.filter(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (bad.length) { toast(`Correo inválido: ${bad.join(', ')}`, 'bad'); return; }
    if (inv.role === 'contractor' && !inv.company_id) { toast('Elija la empresa del contratista', 'bad'); return; }
    setBusy(true);
    const out: { email: string; ok: boolean; status: string }[] = [];
    for (const email of emails) {
      const { data, error } = await supabase.rpc('hse_invite_member', { p_org: orgId, p_email: email, p_role: inv.role, p_company: inv.company_id || null });
      out.push(error ? { email, ok: false, status: errorMessage(error) }
        : { email, ok: true, status: (data as { status: string }).status === 'agregado' ? 'Ya tenía cuenta: quedó agregado' : 'Invitación registrada' });
    }
    setBusy(false); setSent(out); await load(); void runSync();
  };
  const closeInvite = () => { setInv(null); setSent(null); };

  return (
    <div className="stack-lg">
      <PageHeader title="Usuarios y permisos" subtitle={orgName}
        actions={<Button disabled={!online} onClick={() => setInv({ emails: '', role: 'auditor', company_id: '' })}>Invitar usuarios</Button>} />
      {!online ? <div className="alert alert-warn">La gestión de usuarios requiere conexión.</div> : null}
      {loadErr ? <div className="alert alert-bad">{loadErr}</div> : null}

      <div className="stat-row">
        <div className="mini-stat"><span>Usuarios activos</span><strong className="num-font">{members ? stats.active : '—'}</strong></div>
        <div className="mini-stat"><span>Invitaciones pendientes</span><strong className="num-font">{invites.length}</strong></div>
        <div className="mini-stat"><span>Nunca ingresaron</span><strong className="num-font">{members ? stats.never : '—'}</strong></div>
        <div className="mini-stat"><span>Sin acceso (inactivos)</span><strong className="num-font">{members ? stats.inactive : '—'}</strong></div>
      </div>

      <div className="tabs" role="tablist">
        {([['usuarios', 'Usuarios'], ['invitaciones', `Invitaciones (${invites.length})`], ['permisos', 'Permisos por rol'], ['organizacion', 'Organización']] as [Tab, string][]).map(([t, l]) =>
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{l}</button>)}
      </div>

      {tab === 'usuarios' ? (
        <Card>
          <div className="row gap wrap" style={{ marginBottom: '.75rem' }}>
            <Input type="search" placeholder="Buscar por nombre, correo o cargo" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 240px' }} aria-label="Buscar usuarios" />
            <Select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} aria-label="Filtrar por rol" style={{ flex: '0 1 240px' }}
              options={[{ value: '', label: 'Todos los roles' }, ...ROLE_ORDER.map(r => ({ value: r, label: LABELS.role[r] }))]} />
          </div>
          {!members ? <p className="muted small">{online ? 'Cargando…' : 'Disponible con conexión.'}</p> : list.length === 0 ? <p className="muted small">Ningún usuario coincide.</p> : (
            <div className="table-wrap"><table className="t users-t">
              <thead><tr><th>Usuario</th><th>Rol</th><th>Empresa</th><th>Último ingreso</th><th className="num">Asignado</th><th>Estado</th></tr></thead>
              <tbody>{list.map(m => {
                const me = m.user_id === userId;
                return (
                  <tr key={m.membership_id} className={!me ? 'clickable' : ''} onClick={() => !me && setEdit(m)} tabIndex={me ? -1 : 0}
                    onKeyDown={e => { if (!me && e.key === 'Enter') setEdit(m); }}>
                    <td><span className="user-cell"><span className="avatar" aria-hidden>{initials(m.full_name || m.email || '?')}</span>
                      <span><strong>{m.full_name || m.email}</strong>{me ? <span className="muted small"> (usted)</span> : null}<br /><span className="small muted">{m.email}{m.job_title ? ` · ${m.job_title}` : ''}</span></span></span></td>
                    <td><span className={`role-chip role-${m.role}`}>{LABELS.role[m.role]}</span></td>
                    <td className="small">{companyName(m.company_id)}</td>
                    <td className={`small ${m.last_sign_in_at ? '' : 'muted'}`}>{ago(m.last_sign_in_at)}</td>
                    <td className="num small">{m.audits_assigned} aud. · {m.actions_open} acc.</td>
                    <td>{m.active ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          )}
        </Card>
      ) : null}

      {tab === 'invitaciones' ? (
        <Card>
          {invites.length === 0 ? <p className="muted small">No hay invitaciones pendientes.</p> : (
            <ul className="plain inv-list">{invites.map(i => (
              <li key={i.id}>
                <div className="row between wrap gap">
                  <span><strong>{i.email}</strong><br /><span className="small muted">{LABELS.role[i.role]}{i.company_id ? ` · ${companyName(i.company_id)}` : ''} · vence {fmtDate(i.expires_at)}</span></span>
                  <span className="row gap wrap">
                    <Button variant="secondary" className="btn-sm" disabled={!online} onClick={async () => {
                      const { error } = await supabase.rpc('hse_invite_member', { p_org: orgId, p_email: i.email, p_role: i.role, p_company: i.company_id });
                      if (error) toast(errorMessage(error), 'bad'); else { toast('Invitación renovada por 14 días'); void load(); }
                    }}>Renovar</Button>
                    <Button variant="ghost" className="btn-sm" disabled={!online} onClick={async () => {
                      const { error } = await supabase.from('hse_invitations').delete().eq('id', i.id);
                      if (error) toast(errorMessage(error), 'bad'); else { toast('Invitación revocada'); void load(); }
                    }}>Revocar</Button>
                  </span>
                </div>
                <details className="small"><summary>Mensaje para enviarle</summary>
                  <pre className="msg-box">{inviteMessage(i.email, i.role, orgName, i.expires_at)}</pre>
                  <ShareButtons text={inviteMessage(i.email, i.role, orgName, i.expires_at)} email={i.email} />
                </details>
              </li>))}
            </ul>
          )}
          <p className="muted small">El invitado crea su cuenta con el mismo correo y lo confirma; al ingresar queda en la organización con el rol elegido. Si ya tenía cuenta, queda agregado en el momento.</p>
        </Card>
      ) : null}

      {tab === 'permisos' ? (
        <Card title="Qué puede hacer cada rol">
          <div className="table-wrap"><table className="t perm-t">
            <thead><tr><th>Acción</th>{ROLE_ORDER.map(r => <th key={r}>{LABELS.role[r]}</th>)}</tr></thead>
            <tbody>{MATRIX.map(row => (
              <tr key={row.what}><td>{row.what}</td>{ROLE_ORDER.map(r => {
                const c = row.cells[r];
                return <td key={r} className={c ? (c === 'si' ? 'perm-yes' : 'perm-part') : 'perm-no'}>{c === 'si' ? <span aria-label="Sí">✓</span> : c ?? <span aria-label="No">—</span>}</td>;
              })}</tr>))}
            </tbody>
          </table></div>
          <p className="muted small">Los permisos los aplica el servidor (políticas de seguridad por fila): aunque alguien manipule la aplicación, no puede ver ni cambiar datos fuera de su rol u organización. Para dar más o menos permisos a una persona, cámbiele el rol.</p>
        </Card>
      ) : null}

      {tab === 'organizacion' ? (<>
        <Card title="Datos de la organización" actions={<Button variant="secondary" className="btn-sm" disabled={!online} onClick={() => setOrg({ name: orgName, tax_id: '' })}>Editar</Button>}>
          <p style={{ margin: 0 }}><strong>{orgName}</strong></p>
        </Card>
        <Card title="Datos de ejemplo">
          <div className="row between wrap gap">
            <p className="small muted" style={{ margin: 0, maxWidth: '60ch' }}>Una organización aparte con contratistas, auditorías, hallazgos y planes de acción ficticios, para capacitar al equipo o probar la aplicación sin tocar los datos reales.</p>
            <DemoButton />
          </div>
        </Card>
      </>) : null}

      <Modal open={!!inv} wide title={sent ? 'Invitaciones enviadas' : 'Invitar usuarios'} onClose={closeInvite}
        footer={sent ? <Button onClick={closeInvite}>Listo</Button> : <><Button variant="secondary" onClick={closeInvite}>Cancelar</Button><Button busy={busy} onClick={doInvite}>Invitar</Button></>}>
        {inv && !sent ? <>
          <Field label="Correos" required hint="Uno o varios, separados por coma o en renglones distintos."><TextArea dictation={false} rows={3} value={inv.emails} onChange={e => setInv({ ...inv, emails: e.target.value })} placeholder="nombre@empresa.com" /></Field>
          <Field label="Rol"><RolePicker value={inv.role} onChange={r => setInv({ ...inv, role: r })} allowOwner={false} /></Field>
          {inv.role === 'contractor' ? <Field label="Empresa del contratista" required hint="Sólo verá auditorías, hallazgos y acciones de esta empresa y sus subcontratistas."><Select placeholder="Elegir…" value={inv.company_id} onChange={e => setInv({ ...inv, company_id: e.target.value })} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field> : null}
        </> : null}
        {inv && sent ? <>
          <ul className="plain">{sent.map(s => <li key={s.email} className="row gap"><Badge tone={s.ok ? 'ok' : 'bad'}>{s.ok ? 'OK' : 'Error'}</Badge><span><strong>{s.email}</strong> · {s.status}</span></li>)}</ul>
          {sent.some(s => s.ok) ? <>
            <p className="small">Todavía no hay envío automático de correos: mándele este mensaje a cada invitado.</p>
            {sent.filter(s => s.ok).map(s => (
              <div key={s.email} className="stack-sm"><pre className="msg-box">{inviteMessage(s.email, inv.role, orgName)}</pre><ShareButtons text={inviteMessage(s.email, inv.role, orgName)} email={s.email} /></div>
            ))}
          </> : null}
        </> : null}
      </Modal>

      {edit ? <MemberModal m={edit} companies={companies} allowOwner={role === 'owner'} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); await runSync(); }} busy={busy} setBusy={setBusy} /> : null}

      <Modal open={!!org} title="Datos de la organización" onClose={() => setOrg(null)} footer={<><Button variant="secondary" onClick={() => setOrg(null)}>Cancelar</Button><Button onClick={async () => {
        if (!org) return;
        const { error } = await supabase.from('hse_organizations').update({ name: org.name.trim(), tax_id: org.tax_id.trim() || null }).eq('id', orgId);
        if (error) toast(errorMessage(error), 'bad'); else { setOrg(null); await refresh(); toast('Organización actualizada'); }
      }}>Guardar</Button></>}>
        {org ? <><Field label="Nombre"><Input value={org.name} onChange={e => setOrg({ ...org, name: e.target.value })} /></Field><Field label="CUIT"><Input value={org.tax_id} onChange={e => setOrg({ ...org, tax_id: e.target.value })} /></Field></> : null}
      </Modal>
    </div>
  );
}

function MemberModal({ m, companies, allowOwner, onClose, onSaved, busy, setBusy }: {
  m: AdminMember; companies: Company[]; allowOwner: boolean; onClose: () => void; onSaved: () => Promise<void>; busy: boolean; setBusy: (b: boolean) => void;
}) {
  const { orgId } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ role: m.role, company_id: m.company_id ?? '', active: m.active });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [assign, setAssign] = useState<{ audit_id: string; participant_role: AuditParticipant['participant_role'] } | null>(null);
  const audits = useLiveQuery(async () => (await db.hse_audits.where('organization_id').equals(orgId).toArray())
    .filter(a => !a.deleted_at && ['planificada', 'en_curso'].includes(a.status)) as Audit[], [orgId]) ?? [];
  const parts = useLiveQuery(async () => (await db.hse_audit_participants.where('organization_id').equals(orgId).toArray())
    .filter(p => !p.deleted_at && p.user_id === m.user_id), [orgId, m.user_id]) ?? [];
  const auditById = new Map(audits.map(a => [a.id, a]));
  const mine = parts.filter(p => auditById.has(p.audit_id));
  const canAudit = ['owner', 'admin', 'supervisor', 'auditor'].includes(f.role);
  const lockedOwner = m.role === 'owner' && !allowOwner;

  const save = async () => {
    setBusy(true);
    try {
      if (f.role === 'contractor' && !f.company_id) throw new Error('El rol contratista requiere una empresa.');
      const { error } = await supabase.from('hse_memberships').update({ role: f.role, company_id: f.role === 'contractor' ? f.company_id : null, active: f.active }).eq('id', m.membership_id).select('id').single();
      if (error) throw error;
      toast('Usuario actualizado'); await onSaved();
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.from('hse_memberships').delete().eq('id', m.membership_id).select('id').single();
      if (error) throw error;
      toast('Usuario quitado de la organización'); await onSaved();
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };
  const addAssign = async () => {
    if (!assign?.audit_id) return;
    const existing = (await db.hse_audit_participants.where('audit_id').equals(assign.audit_id).toArray()).find(p => p.user_id === m.user_id);
    await saveRecord<AuditParticipant>('hse_audit_participants', {
      ...(existing ?? {}), id: existing?.id ?? newId(), organization_id: orgId, audit_id: assign.audit_id,
      user_id: m.user_id, participant_role: assign.participant_role, deleted_at: null,
    } as AuditParticipant);
    setAssign(null); toast('Auditoría asignada');
  };

  return (
    <Modal open wide title={m.full_name || m.email || 'Usuario'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button busy={busy} disabled={lockedOwner} onClick={save}>Guardar cambios</Button></>}>
      <div className="user-head">
        <span className="avatar avatar-lg" aria-hidden>{initials(m.full_name || m.email || '?')}</span>
        <span><strong>{m.email}</strong><br /><span className="small muted">{[m.job_title, m.phone].filter(Boolean).join(' · ') || 'Sin cargo cargado'} · miembro desde {fmtDate(m.member_since)} · {ago(m.last_sign_in_at)}</span></span>
      </div>
      {lockedOwner ? <div className="alert alert-warn">Sólo un propietario puede modificar a otro propietario.</div> : null}
      <Field label="Rol"><RolePicker value={f.role} onChange={r => setF({ ...f, role: r })} allowOwner={allowOwner} /></Field>
      {f.role === 'contractor' ? <Field label="Empresa" required><Select placeholder="Elegir…" value={f.company_id} onChange={e => setF({ ...f, company_id: e.target.value })} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field> : null}
      <label className="switch-row">
        <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} disabled={lockedOwner} />
        <span><strong>Acceso habilitado</strong><br /><span className="small muted">Desactivado no puede ingresar a la organización; su historial y firmas se conservan.</span></span>
      </label>

      <div className="stack-sm">
        <div className="row between wrap gap"><strong>Auditorías asignadas (planificadas o en curso)</strong>
          {canAudit && m.active ? <Button variant="secondary" className="btn-sm" onClick={() => setAssign({ audit_id: '', participant_role: 'auditor' })}>Asignar auditoría</Button> : null}</div>
        {mine.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No tiene auditorías pendientes asignadas.</p> : (
          <ul className="plain">{mine.map(p => { const a = auditById.get(p.audit_id)!; return (
            <li key={p.id} className="row between gap"><span><strong>{a.code ?? ''}</strong> {a.title} <span className="small muted">· {fmtDate(a.scheduled_date)} · {LABELS.participantRole[p.participant_role]}</span></span>
              {p.participant_role !== 'lider' ? <Button variant="ghost" className="btn-sm" onClick={async () => { await patchRecord<AuditParticipant>('hse_audit_participants', p.id, { deleted_at: new Date().toISOString() }); toast('Asignación quitada'); }}>Quitar</Button> : null}</li>); })}
          </ul>)}
        {assign ? (
          <div className="row gap wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="Auditoría"><Select placeholder="Elegir…" value={assign.audit_id} onChange={e => setAssign({ ...assign, audit_id: e.target.value })}
              options={audits.filter(a => !mine.some(p => p.audit_id === a.id)).map(a => ({ value: a.id, label: `${a.code ?? ''} ${a.title} (${fmtDate(a.scheduled_date)})` }))} /></Field>
            <Field label="Como"><Select value={assign.participant_role} onChange={e => setAssign({ ...assign, participant_role: e.target.value as AuditParticipant['participant_role'] })}
              options={[{ value: 'auditor', label: 'Auditor' }, { value: 'observador', label: 'Observador' }]} /></Field>
            <Button onClick={addAssign} disabled={!assign.audit_id}>Asignar</Button>
          </div>) : null}
      </div>

      {m.role !== 'owner' ? (
        <div className="danger-zone">
          {!confirmRemove ? <Button variant="ghost" className="btn-sm" onClick={() => setConfirmRemove(true)}>Quitar de la organización…</Button> : (
            <div className="row gap wrap"><span className="small">Pierde el acceso; lo que registró queda en el historial. ¿Confirma?</span>
              <Button variant="danger" className="btn-sm" busy={busy} onClick={remove}>Sí, quitar</Button><Button variant="ghost" className="btn-sm" onClick={() => setConfirmRemove(false)}>No</Button></div>)}
        </div>) : null}
    </Modal>
  );
}
