import { useState } from 'react';
import { supabase, errorMessage } from '../../lib/supabase';
import { Button, Card, Field, Input } from '../../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { DemoButton } from '../demo/DemoButton';

/** Primer ingreso sin organizaciones: crear una propia o esperar invitación. */
export function CreateOrgPage() {
  const { refresh, selectOrg, profile, signOut, bootstrapError } = useAuth();
  const [name, setName] = useState('');
  const [tax, setTax] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.rpc('hse_create_organization', { p_name: name, p_tax_id: tax || null });
      if (error) throw error;
      await refresh(); await selectOrg(data as string);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <Card className="auth-card">
        <div className="stack">
          <h1>Bienvenido{profile?.full_name ? `, ${profile.full_name}` : ''}</h1>
          {bootstrapError ? <div className="alert alert-bad">{bootstrapError}</div> : null}
          <p className="muted">Todavía no pertenece a ninguna organización. Si lo invitaron, pida al administrador que use este correo: <strong>{profile?.email}</strong> y vuelva a ingresar. También puede crear su propia organización.</p>
          <Field label="Nombre de la organización" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="CUIT (opcional)"><Input value={tax} onChange={e => setTax(e.target.value)} /></Field>
          {err ? <div className="alert alert-bad">{err}</div> : null}
          <Button onClick={create} busy={busy} disabled={name.trim().length < 2 || !navigator.onLine}>Crear organización</Button>
          <div className="alert alert-info stack" style={{ gap: '.5rem' }}>
            <span><strong>¿Quiere verla funcionando primero?</strong> Cree una organización de ejemplo con auditorías, hallazgos y planes de acción ficticios. Su organización real la puede crear después.</span>
            <div><DemoButton /></div>
          </div>
          <div className="row between">
            <Button variant="ghost" onClick={() => void refresh()}>Ya me invitaron: reintentar</Button>
            <Button variant="ghost" onClick={() => void signOut(true)}>Salir</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
