import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, errorMessage } from '../../lib/supabase';
import { Button, Card, Field, Input, Modal, PageHeader, useToast } from '../../components/ui';
import { useAuth } from './AuthProvider';
import { LABELS } from '../../types';

export function ProfilePage() {
  const { profile, refresh, memberships, signOut, userId } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ full_name: '', phone: '', job_title: '' });
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState<number | null>(null);

  useEffect(() => { if (profile) setF({ full_name: profile.full_name ?? '', phone: profile.phone ?? '', job_title: profile.job_title ?? '' }); }, [profile]);

  const save = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.from('hse_profiles').update({ full_name: f.full_name || null, phone: f.phone || null, job_title: f.job_title || null }).eq('id', userId);
      if (error) throw error;
      await refresh(); toast('Perfil actualizado');
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };
  const changePwd = async () => {
    if (pwd.length < 10) { toast('La contraseña debe tener al menos 10 caracteres.', 'bad'); return; }
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) toast(errorMessage(error), 'bad'); else { setPwd(''); toast('Contraseña actualizada'); }
  };
  const out = async (force = false) => {
    const r = await signOut(force);
    if (r && 'pending' in r) { setConfirmOut(r.pending); return; }
    nav('/');
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Mi perfil" subtitle={profile?.email} actions={<Button variant="secondary" onClick={() => void out()}>Cerrar sesión</Button>} />
      {sp.get('reset') ? <div className="alert alert-info">Ingrese una nueva contraseña para completar el restablecimiento.</div> : null}
      <div className="grid grid-2">
        <Card title="Datos personales">
          <div className="stack">
            <Field label="Nombre y apellido"><Input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></Field>
            <Field label="Cargo / función"><Input value={f.job_title} onChange={e => setF({ ...f, job_title: e.target.value })} /></Field>
            <Field label="Teléfono"><Input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
            <Button onClick={save} busy={busy} disabled={!navigator.onLine}>Guardar</Button>
            {!navigator.onLine ? <p className="muted small">El perfil se edita con conexión.</p> : null}
          </div>
        </Card>
        <div className="stack">
          <Card title="Contraseña">
            <div className="stack">
              <Field label="Nueva contraseña" hint="Mínimo 10 caracteres."><Input type="password" value={pwd} onChange={e => setPwd(e.target.value)} autoComplete="new-password" /></Field>
              <Button variant="secondary" onClick={changePwd} disabled={!navigator.onLine}>Cambiar contraseña</Button>
            </div>
          </Card>
          <Card title="Organizaciones">
            <ul className="stack" style={{ margin: 0, paddingLeft: '1rem' }}>
              {memberships.map(m => <li key={m.organization_id}>{m.organization_name} — {LABELS.role[m.role]}</li>)}
            </ul>
          </Card>
        </div>
      </div>
      <Modal open={confirmOut !== null} title="Cambios sin sincronizar" onClose={() => setConfirmOut(null)}
        footer={<><Button variant="secondary" onClick={() => setConfirmOut(null)}>Volver</Button><Button variant="danger" onClick={() => void out(true)}>Cerrar sesión y descartar</Button></>}>
        <p>Hay <strong>{confirmOut}</strong> cambios todavía no enviados al servidor. Si cierra la sesión se borrarán de este dispositivo. Conéctese y espere a que se sincronicen para no perderlos.</p>
      </Modal>
    </div>
  );
}
