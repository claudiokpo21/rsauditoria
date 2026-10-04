import { useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { dictationErrorText, joinDictation, mergeFinals, setNativeValue, speechCtor, type SpeechRec } from './dictation';

let active: { abort: () => void } | null = null;   // un solo dictado a la vez en toda la app
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported', 'bad-grammar']);
const MAX_SILENT_RUNS = 4;   // tomas seguidas sin voz antes de detenerse solo (≈ 30 s de silencio)

/**
 * Textarea con botón de micrófono: lo dictado se agrega al final del texto (con "punto", "coma",
 * "punto y aparte"). Funciona con campos controlados y con los que guardan al salir del campo.
 *
 * Se dicta en tomas cortas (una frase por toma) que se reinician solas hasta tocar ■: el modo continuo
 * de Chrome en Android repite la frase acumulada. Cada toma recalcula su texto desde el valor que tenía
 * el campo al empezar, así un resultado repetido no se escribe dos veces.
 */
export function DictationTextArea({ dictation = true, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { dictation?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const session = useRef<{ wanting: boolean; rec: SpeechRec | null; changed: boolean; silent: number } | null>(null);
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const Ctor = dictation ? speechCtor() : null;
  // identidad estable de este campo para "un solo dictado a la vez"
  const handle = useRef({ abort: () => { const s = session.current; if (s) { s.wanting = false; s.rec?.abort(); } } }).current;

  useEffect(() => () => { const s = session.current; if (s) { s.wanting = false; s.rec?.abort(); } }, []);

  const finish = () => {
    const el = ref.current; const s = session.current;
    session.current = null; setOn(false); setInterim('');
    if (active === handle) active = null;
    // los campos que guardan al salir (lista de verificación) reciben su "blur" para guardar lo dictado
    if (el && s?.changed && document.activeElement !== el) el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  };

  const run = () => {
    const el = ref.current; const s = session.current;
    if (!el || !Ctor || !s || !s.wanting) { finish(); return; }
    const base = el.value;
    let shown = base; let heard = false;
    const r = new Ctor();
    r.lang = 'es-AR'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = e => {
      const finals: string[] = []; let partial = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]; const t = res[0]?.transcript ?? '';
        if (res.isFinal) finals.push(t); else partial = t;
      }
      const merged = mergeFinals(finals);
      if (merged) {
        heard = true;
        const next = joinDictation(base, merged);
        if (next !== shown && el.value === shown) { setNativeValue(el, next); shown = next; s.changed = true; }
      }
      setInterim(partial.trim());
    };
    r.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setMsg(dictationErrorText(e.error));
      if (FATAL.has(e.error)) s.wanting = false;
    };
    r.onend = () => {
      setInterim('');
      s.silent = heard ? 0 : s.silent + 1;
      if (s.wanting && s.silent >= MAX_SILENT_RUNS) { s.wanting = false; setMsg('El dictado se detuvo por silencio. Toque el micrófono para seguir.'); }
      if (s.wanting) setTimeout(run, 120); else finish();
    };
    try { s.rec = r; r.start(); }
    catch { setMsg('No se pudo iniciar el dictado. Vuelva a intentar.'); s.wanting = false; finish(); }
  };

  const start = () => {
    if (!ref.current || !Ctor) return;
    if (active && active !== handle) active.abort();
    setMsg(navigator.onLine ? null : 'Sin conexión: el dictado del navegador puede no funcionar. Si falla, use el micrófono del teclado.');
    session.current = { wanting: true, rec: null, changed: false, silent: 0 };
    active = handle; setOn(true); run();
  };
  const stop = () => { const s = session.current; if (!s) return; s.wanting = false; if (s.rec) s.rec.stop(); else finish(); };

  if (!Ctor) return <textarea rows={3} {...p} ref={ref} className={`input ${p.className ?? ''}`} />;
  const toggle = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); if (p.disabled) return; if (on) stop(); else start(); };
  return (
    <span className={`dictate ${on ? 'is-on' : ''}`}>
      <textarea rows={3} {...p} ref={ref} className={`input ${p.className ?? ''}`} />
      {/* span con rol de botón: no queda asociado a la etiqueta del campo */}
      <span role="button" tabIndex={p.disabled ? -1 : 0} aria-disabled={p.disabled || undefined} aria-pressed={on}
        className="dictate-btn" title={on ? 'Detener dictado' : 'Dictar por voz'} aria-label={on ? 'Detener dictado' : 'Dictar por voz'}
        onClick={toggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggle(e); }}>
        {on ? <span className="dictate-stop" aria-hidden /> : (
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" /></svg>
        )}
      </span>
      {on || interim ? <span className="dictate-live" aria-live="polite">{interim ? `«${interim}»` : 'Escuchando… diga "punto", "coma" o "punto y aparte". Toque ■ para terminar.'}</span> : null}
      {msg ? <span className="dictate-msg" role="status">{msg}</span> : null}
    </span>
  );
}
