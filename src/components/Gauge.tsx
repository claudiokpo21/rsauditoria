/** Indicador semicircular (tipo velocímetro) con los tramos de color del criterio de evaluación. */
export function Gauge({ value, max, segments, label }: { value: number | null; max: number; segments: { from: number; to: number; color: string }[]; label: string }) {
  const cx = 120, cy = 120, r = 100;
  const pt = (v: number, rr = r) => { const th = Math.PI * (1 - Math.min(max, Math.max(0, v)) / max); return [cx + rr * Math.cos(th), cy - rr * Math.sin(th)]; };
  const arc = (a: number, b: number) => { const [x1, y1] = pt(a); const [x2, y2] = pt(b); return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
  const gap = max * 0.006;
  const segs = segments.length ? segments : [{ from: 0, to: max, color: 'var(--rail-2, #24485a)' }];
  const [nx, ny] = value === null ? [cx, cy - 82] : pt(value, 82);
  return (
    <svg viewBox="0 0 240 132" className="gauge" role="img" aria-label={label}>
      <path d={arc(0, max)} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="22" />
      {segs.map((s, i) => <path key={i} d={arc(s.from + (i ? gap : 0), s.to - (i < segs.length - 1 ? gap : 0))} fill="none" stroke={s.color} strokeWidth="22" />)}
      {value !== null ? <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="currentColor" strokeWidth="5" strokeLinecap="round" /> : null}
      <circle cx={cx} cy={cy} r="9" fill="currentColor" />
    </svg>
  );
}
