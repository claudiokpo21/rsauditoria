import { useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { dictationErrorText, joinDictation, setNativeValue, speechCtor, type SpeechRec } from './dictation';

let active: SpeechRec | null = null;   // un solo dictado a la vez en toda la app

/**
 * Textarea con botón de micrófono: lo dictado se agrega al final del texto (con "punto", "coma",
 * "punto y aparte"). Funciona con campos controlados y con los que guardan al salir del campo.
 */
export function DictationTextArea({ dictation = true, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { dictation?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<SpeechRec | null>(null);
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const Ctor = dictation ? speechCtor() : null;

  useEffect(() => () => { rec.current?.abort(); }, []);

  const stop = () => rec.current?.stop();
  const start = () => {
    const el = ref.current; if (!el || !Ctor) return;
    if (active && active !== rec.current) active.abort();
    setMsg(null); setInterim('');
    if (!navigator.onLine) setMsg('Sin conexión: el dictado del navegador puede no funcionar. Si falla, use el micrófono del teclado.');
    const r = new Ctor();
    r.lang = 'es-AR'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let changed = false;
    r.onresult = e => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]; const t = res[0].transcript;
        if (res.isFinal) { setNativeValue(el, joinDictation(el.value, t)); changed = true; }
        else partial += t;
      }
      setInterim(partial.trim());
    };
    r.onerror = e => { if (e.error !== 'aborted') setMsg(dictationErrorText(e.error)); };
    r.onend = () => {
      setOn(false); setInterim(''); if (active === r) active = null; rec.current = null;
      // los campos que guardan al salir (lista de verificación) reciben su "blur" para guardar lo dictado
      if (changed && document.activeElement !== el) el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    };
    try { r.start(); rec.current = r; active = r; setOn(true); }
    catch { setMsg('No se pudo iniciar el dictado. Vuelva a intentar.'); }
  };

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
