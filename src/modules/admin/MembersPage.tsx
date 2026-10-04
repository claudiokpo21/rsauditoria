import { useEffect, useState } from 'react';
import { supabase, errorMessage } from '../../lib/supabase';
import { runSync } from '../../sync/scheduler';
import { useOrgRows, useProfiles } from '../../db/hooks';
import { useAuth, can } from '../auth/AuthProvider';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, fmtDate, useToast } from '../../components/ui';
import { LABELS, type Company, type MemberRow, type Role } from '../../types';

interface Invitation { id: string; email: string; role: Role; company_id: string | null; expires_at: string; created_at: string }

export function MembersPage() {
  const { orgId, role, current, refresh, userId } = useAuth();
  const toast = useToast();
  const members = useOrgRows<MemberRow>('hse_memberships') ?? [];
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const people = useProfiles();
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [inv, setInv] = useState<{ email: string; role: Role; company_id: string } | null>(null);
  const [edit, setEdit] = useState<MemberRow | null>(null);
  const [org, setOrg] = useState<{ name: string; tax_id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const online = navigator.onLine;
  const roleOpts = Object.entries(LABELS.role).filter(([k]) => k !== 'owner' || role === 'owner').map(([value, label]) => ({ value, label }));

  const loadInvites = async () => {
    const { data } = await supabase.from('hse_invitations').select('id,email,role,company_id,expires_at,created_at').eq('organization_id', orgId).is('accepted_at', null).order('created_at', { ascending: false });
    setInvites((data ?? []) as Invitation[]);
  };
  useEffect(() => { if (online && can(role, 'admin')) void loadInvites(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can(role, 'admin')) return <Empty>Sólo propietarios y administradores gestionan usuarios.</Empty>;

  const doInvite = async () => {
    if (!inv) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('hse_invite_member', { p_org: orgId, p_email: inv.email, p_role: inv.role, p_company: inv.company_id || null });
      if (error) throw error;
      toast((data as { status: string }).status === 'agregado' ? 'El usuario ya tenía cuenta: se agregó a la organización.' : 'Invitación registrada. Al crear su cuenta con ese correo ingresará a la organización.');
      setInv(null); await loadInvites(); await runSync();
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };
  const saveMember = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      if (edit.role === 'contractor' && !edit.company_id) throw new Error('El rol contratista requiere una empresa.');
      const { error } = await supabase.from('hse_memberships').update({ role: edit.role, company_id: edit.company_id || null, active: edit.active }).eq('id', edit.id);
      if (error) throw error;
      setEdit(null); await runSync(); toast('Miembro actualizado');
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };
  const saveOrg = async () => {
    if (!org) return;
    const { error } = await supabase.from('hse_organizations').update({ name: org.name.trim(), tax_id: org.tax_id.trim() || null }).eq('id', orgId);
    if (error) toast(errorMessage(error), 'bad'); else { setOrg(null); await refresh(); toast('Organización actualizada'); }
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Usuarios y organización" subtitle={current?.organization_name}
        actions={<><Button variant="secondary" disabled={!online} onClick={() => setOrg({ name: current?.organization_name ?? '', tax_id: '' })}>Datos de la organización</Button><Button disabled={!online} onClick={() => setInv({ email: '', role: 'auditor', company_id: '' })}>Invitar usuario</Button></>} />
      {!online ? <div className="alert alert-warn">La gestión de usuarios requiere conexión.</div> : null}
      <Card title={`Miembros (${members.length})`}>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Usuario</th><th>Rol</th><th>Empresa (contratista)</th><th>Estado</th></tr></thead>
          <tbody>{members.map(m => (
            <tr key={m.id} className={online && m.user_id !== userId ? 'clickable' : ''} onClick={() => online && m.user_id !== userId && setEdit(m)}>
              <td>{people.get(m.user_id) ?? m.user_id.slice(0, 8)}{m.user_id === userId ? <span className="muted small"> (usted)</span> : null}</td>
              <td>{LABELS.role[m.role]}</td><td>{m.company_id ? companies.find(c => c.id === m.company_id)?.name : '—'}</td>
              <td>{m.active ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
            </tr>))}</tbody>
        </table></div>
      </Card>
      <Card title={`Invitaciones pendientes (${invites.length})`}>
        {invites.length === 0 ? <p className="muted small">No hay invitaciones pendientes.</p> : (
          <div className="table-wrap"><table className="t"><tbody>{invites.map(i => (
            <tr key={i.id}><td>{i.email}</td><td>{LABELS.role[i.role]}</td><td className="small muted">vence {fmtDate(i.expires_at)}</td>
              <td className="num"><Button variant="ghost" className="btn-sm" onClick={async () => { const { error } = await supabase.from('hse_invitations').delete().eq('id', i.id); if (error) toast(errorMessage(error), 'bad'); else void loadInvites(); }}>Revocar</Button></td></tr>
          ))}</tbody></table></div>
        )}
        <p className="muted small">El invitado crea su cuenta en la pantalla de ingreso con el mismo correo. La invitación sólo se acepta si el correo está verificado.</p>
      </Card>

      <Modal open={!!inv} title="Invitar usuario" onClose={() => setInv(null)} footer={<><Button variant="secondary" onClick={() => setInv(null)}>Cancelar</Button><Button busy={busy} onClick={doInvite}>Invitar</Button></>}>
        {inv ? <>
          <Field label="Correo" required><Input type="email" value={inv.email} onChange={e => setInv({ ...inv, email: e.target.value })} /></Field>
          <Field label="Rol"><Select value={inv.role} onChange={e => setInv({ ...inv, role: e.target.value as Role })} options={roleOpts.filter(o => o.value !== 'owner')} /></Field>
          {inv.role === 'contractor' ? <Field label="Empresa del contratista" required hint="Sólo verá auditorías, hallazgos y acciones de esta empresa y sus subcontratistas."><Select placeholder="Elegir…" value={inv.company_id} onChange={e => setInv({ ...inv, company_id: e.target.value })} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field> : null}
          <div className="small muted">
            <strong>Permisos:</strong> Administrador gestiona usuarios, reaperturas y todo lo demás · Coordinador HSE maestros, plantillas, asignación, revisión y cierre · Auditor ejecuta las auditorías asignadas · Responsable de acciones correctivas ve e informa avance sólo de las acciones y hallazgos a su cargo · Usuario de consulta sólo lee · Responsable de contratista ve lo de su empresa e informa avance. Detalle en el manual de usuario.
          </div>
        </> : null}
      </Modal>
      <Modal open={!!edit} title="Editar miembro" onClose={() => setEdit(null)} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button busy={busy} onClick={saveMember}>Guardar</Button></>}>
        {edit ? <>
          <p><strong>{people.get(edit.user_id)}</strong></p>
          <Field label="Rol"><Select value={edit.role} onChange={e => setEdit({ ...edit, role: e.target.value as Role })} options={roleOpts} /></Field>
          {edit.role === 'contractor' ? <Field label="Empresa"><Select placeholder="Elegir…" value={edit.company_id ?? ''} onChange={e => setEdit({ ...edit, company_id: e.target.value })} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field> : null}
          <Field label="Estado"><Select value={edit.active ? 'si' : 'no'} onChange={e => setEdit({ ...edit, active: e.target.value === 'si' })} options={[{ value: 'si', label: 'Activo' }, { value: 'no', label: 'Inactivo (sin acceso)' }]} /></Field>
        </> : null}
      </Modal>
      <Modal open={!!org} title="Datos de la organización" onClose={() => setOrg(null)} footer={<><Button variant="secondary" onClick={() => setOrg(null)}>Cancelar</Button><Button onClick={saveOrg}>Guardar</Button></>}>
        {org ? <><Field label="Nombre"><Input value={org.name} onChange={e => setOrg({ ...org, name: e.target.value })} /></Field><Field label="CUIT"><Input value={org.tax_id} onChange={e => setOrg({ ...org, tax_id: e.target.value })} /></Field></> : null}
      </Modal>
    </div>
  );
}
