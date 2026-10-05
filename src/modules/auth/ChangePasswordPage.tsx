import { useState, type FormEvent } from 'react';
import { supabase, errorMessage } from '../../lib/supabase';
import { Button, Card, Field, Input } from '../../components/ui';

/** Primer ingreso con contraseña temporal: la persona elige la suya antes de usar la aplicación. */
export function ChangePasswordPage({ email }: { email: string }) {
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (p1.length < 10) { setErr('La contraseña debe tener al menos 10 caracteres.'); return; }
    if (p1 !== p2) { setErr('Las dos contraseñas no coinciden.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: p1, data: { must_change_password: false } });
    setBusy(false);
    if (error) setErr(/different from the old|same/i.test(error.message) ? 'Elija una contraseña distinta de la temporal.' : errorMessage(error));
  };
  return (
    <div className="auth-wrap">
      <Card className="auth-card auth-banded">
        <form className="stack" onSubmit={submit}>
          <h2>Elija su contraseña</h2>
          <p className="small muted" style={{ margin: 0 }}>Ingresó con una contraseña temporal ({email}). Para seguir, elija una propia; la temporal deja de funcionar.</p>
          <Field label="Nueva contraseña" required hint="Mínimo 10 caracteres."><Input type="password" autoComplete="new-password" value={p1} onChange={e => setP1(e.target.value)} required /></Field>
          <Field label="Repetir contraseña" required><Input type="password" autoComplete="new-password" value={p2} onChange={e => setP2(e.target.value)} required /></Field>
          {err ? <div className="alert alert-bad" role="alert">{err}</div> : null}
          <Button type="submit" busy={busy}>Guardar y entrar</Button>
          <a href="#" className="small" onClick={e => { e.preventDefault(); void supabase.auth.signOut(); }}>Salir</a>
        </form>
      </Card>
    </div>
  );
}
