import { useState, type FormEvent } from 'react';
import { supabase, errorMessage } from '../../lib/supabase';
import { Button, Card, Field, Input } from '../../components/ui';

type Mode = 'login' | 'signup' | 'reset';

export function LoginPage() {
  // enlace de invitación: /?invitacion=correo → abre "Crear cuenta" con el correo cargado
  const invited = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('invitacion') : null;
  const [mode, setMode] = useState<Mode>(invited ? 'signup' : 'login');
  const [email, setEmail] = useState(invited ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');
        const { error, data } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setMsg({ tone: 'ok', text: data.session ? 'Cuenta creada.' : 'Le enviamos un correo para confirmar la cuenta. Luego inicie sesión.' });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/perfil?reset=1` });
        if (error) throw error;
        setMsg({ tone: 'ok', text: 'Si el correo existe, recibirá un enlace para restablecer la contraseña.' });
      }
    } catch (err) {
      const m = errorMessage(err);
      setMsg({ tone: 'bad', text: /Invalid login/i.test(m) ? 'Correo o contraseña incorrectos.' : /not confirmed/i.test(m) ? 'Confirme su correo antes de ingresar.' : m });
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <Card className="auth-card auth-banded">
        <form className="stack" onSubmit={submit}>
          {invited && mode === 'signup' ? <div className="alert alert-info">Lo invitaron a Auditorías HSE. Cree su cuenta con <strong>{invited}</strong> y confirme el correo que le llega; al ingresar quedará en la organización.</div> : null}
          <div className="row gap"><span className="brand-mark" aria-hidden><i /><i /><i /><i /></span><div><h1>Auditorías HSE</h1><p className="muted small" style={{ margin: 0 }}>Seguridad e Higiene, Salud Ocupacional, Medio Ambiente y CSMS</p></div></div>
          <h2>{mode === 'login' ? 'Iniciar sesión' : mode === 'signup' ? 'Crear cuenta' : 'Restablecer contraseña'}</h2>
          {mode === 'signup' ? <Field label="Nombre y apellido" required><Input value={name} onChange={e => setName(e.target.value)} required autoComplete="name" /></Field> : null}
          <Field label="Correo electrónico" required><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></Field>
          {mode !== 'reset' ? <Field label="Contraseña" required hint={mode === 'signup' ? 'Mínimo 10 caracteres.' : undefined}>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 10 : undefined} />
          </Field> : null}
          {msg ? <div className={`alert alert-${msg.tone === 'ok' ? 'ok' : 'bad'}`} role="status">{msg.text}</div> : null}
          <Button type="submit" busy={busy}>{mode === 'login' ? 'Ingresar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}</Button>
          <div className="row between small">
            {mode !== 'login' ? <a href="#" onClick={e => { e.preventDefault(); setMode('login'); }}>Ya tengo cuenta</a> : <a href="#" onClick={e => { e.preventDefault(); setMode('signup'); }}>Crear cuenta</a>}
            {mode === 'login' ? <a href="#" onClick={e => { e.preventDefault(); setMode('reset'); }}>Olvidé mi contraseña</a> : null}
          </div>
          {!navigator.onLine ? <div className="alert alert-warn">Sin conexión: el primer inicio de sesión requiere internet. Después podrá trabajar sin conexión.</div> : null}
        </form>
      </Card>
    </div>
  );
}
