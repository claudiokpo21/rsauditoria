import { DictationTextArea } from './DictationTextArea';
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function Button({ variant = 'primary', busy, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean }) {
  return <button {...p} className={`btn btn-${variant} ${p.className ?? ''}`} disabled={p.disabled || busy}>{busy ? <span className="spinner" aria-hidden /> : null}{children}</button>;
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string | null; children: ReactNode; required?: boolean }) {
  return (
    <label className="field">
      <span className="field-label">{label}{required ? <span className="req" aria-label="obligatorio"> *</span> : null}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.className ?? ''}`} />;
/** Textarea con dictado por voz (botón de micrófono); `dictation={false}` lo desactiva. */
export const TextArea = (p: TextareaHTMLAttributes<HTMLTextAreaElement> & { dictation?: boolean }) => <DictationTextArea {...p} />;
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={`input ${p.className ?? ''}`}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export const Card = ({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) => (
  <section className={`card ${className ?? ''}`}>
    {title || actions ? <header className="card-head"><h3>{title}</h3><div className="row gap">{actions}</div></header> : null}
    {children}
  </section>
);
export const Badge = ({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) => <span className={`badge badge-${tone}`}>{children}</span>;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{subtitle ? <p className="muted">{subtitle}</p> : null}</div><div className="row gap wrap">{actions}</div></div>;
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button></header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

// ---------- avisos ----------
interface Toast { id: number; text: string; tone: 'ok' | 'bad' | 'info' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems(x => [...x, { id, text, tone }]);
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), tone === 'bad' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map(t => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Stat({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad'; sub?: ReactNode }) {
  return <div className={`stat ${tone ? 'stat-' + tone : ''}`}><span className="stat-label">{label}</span><span className="stat-value">{value}</span>{sub ? <span className="stat-sub">{sub}</span> : null}</div>;
}

export const fmtDate = (d?: string | null) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-AR') : '—');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtNum = (n?: number | null, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const today = () => new Date().toISOString().slice(0, 10);
/** Muestra viñetas de la fuente Symbol (U+F0B7) como "•" sin alterar el texto guardado. */
export const displayText = (s?: string | null) => (s ?? '').replace(//g, '•');
