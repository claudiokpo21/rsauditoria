import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../../components/ui';

type Tool = 'flecha' | 'circulo' | 'trazo';
type Pt = { x: number; y: number };
type Shape = { tool: Tool; color: string; pts: Pt[] };

const COLORS = [{ c: '#e3141b', n: 'Rojo' }, { c: '#ffd400', n: 'Amarillo' }, { c: '#ffffff', n: 'Blanco' }];
const MAX = 1600;

function drawShape(g: CanvasRenderingContext2D, s: Shape, lw: number) {
  g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = lw * 0.8;
  const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
  if (!a || !b) return;
  if (s.tool === 'trazo') {
    g.beginPath(); g.moveTo(a.x, a.y); for (const p of s.pts.slice(1)) g.lineTo(p.x, p.y); g.stroke();
  } else if (s.tool === 'circulo') {
    g.beginPath(); g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(4, Math.abs(b.x - a.x) / 2), Math.max(4, Math.abs(b.y - a.y) / 2), 0, 0, Math.PI * 2); g.stroke();
  } else {
    const ang = Math.atan2(b.y - a.y, b.x - a.x); const head = lw * 4.5;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6); g.stroke();
    g.beginPath(); g.moveTo(b.x, b.y);
    g.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
    g.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
    g.closePath(); g.fill();
  }
  g.shadowBlur = 0;
}

/**
 * Permite marcar el desvío sobre la foto (flecha, círculo o trazo libre) antes de guardarla
 * como evidencia. La foto marcada reemplaza a la original; si no se marca nada, se guarda tal cual.
 */
export function PhotoAnnotator({ file, onDone, onCancel }: { file: File | null; onDone: (f: File) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useRef<ImageBitmap | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>('flecha');
  const [color, setColor] = useState(COLORS[0].c);
  const [error, setError] = useState<string | null>(null);
  const cur = useRef<Shape | null>(null);

  const redraw = (extra?: Shape | null) => {
    const c = ref.current, im = img.current; if (!c || !im) return;
    const g = c.getContext('2d')!; g.drawImage(im, 0, 0, c.width, c.height);
    const lw = Math.max(4, Math.round(Math.max(c.width, c.height) / 220));
    for (const s of shapes) drawShape(g, s, lw);
    if (extra) drawShape(g, extra, lw);
  };
  useEffect(() => {
    if (!file) return;
    let alive = true; setShapes([]); setError(null);
    createImageBitmap(file).then(bm => {
      if (!alive) return;
      img.current = bm;
      const k = Math.min(1, MAX / Math.max(bm.width, bm.height));
      const c = ref.current!; c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
      redraw();
    }).catch(() => setError('No se pudo abrir la imagen para marcarla; puede guardarla sin marcas.'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  useEffect(() => { redraw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shapes]);

  const pt = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const save = () => {
    const c = ref.current;
    if (!file || !c || !img.current || shapes.length === 0) { if (file) onDone(file); return; }
    c.toBlob(b => { if (b) onDone(new File([b], file.name.replace(/\.\w+$/, '') + '-marcada.jpg', { type: 'image/jpeg', lastModified: Date.now() })); else onDone(file); }, 'image/jpeg', 0.9);
  };

  return (
    <Modal open={!!file} title="Marcar sobre la foto" wide onClose={onCancel}
      footer={<>
        <Button variant="secondary" onClick={() => file && onDone(file)}>Guardar sin marcas</Button>
        <Button disabled={!!error || shapes.length === 0} onClick={save}>Guardar con marcas</Button>
      </>}>
      {error ? <div className="alert alert-warn">{error}</div> : null}
      <div className="row gap wrap" role="toolbar" aria-label="Herramientas">
        {(['flecha', 'circulo', 'trazo'] as Tool[]).map(t => (
          <button key={t} type="button" className={`opt ${tool === t ? 'sel-opm' : ''}`} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {t === 'flecha' ? '➚ Flecha' : t === 'circulo' ? '◯ Círculo' : '✎ Trazo'}
          </button>
        ))}
        <span className="row gap" aria-label="Color">
          {COLORS.map(x => <button key={x.c} type="button" title={x.n} aria-label={x.n} aria-pressed={color === x.c} onClick={() => setColor(x.c)}
            className="swatch" style={{ background: x.c, outline: color === x.c ? '3px solid var(--brand)' : undefined }} />)}
        </span>
        <Button variant="ghost" className="btn-sm" disabled={!shapes.length} onClick={() => setShapes(s => s.slice(0, -1))}>Deshacer</Button>
      </div>
      <canvas ref={ref} className="annot"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); cur.current = { tool, color, pts: [pt(e)] }; }}
        onPointerMove={e => { if (!cur.current) return; const p = pt(e); cur.current = { ...cur.current, pts: cur.current.tool === 'trazo' ? [...cur.current.pts, p] : [cur.current.pts[0], p] }; redraw(cur.current); }}
        onPointerUp={() => { const s = cur.current; cur.current = null; if (s && s.pts.length > 1) setShapes(x => [...x, s]); }}
        onPointerCancel={() => { cur.current = null; redraw(); }} />
      <p className="small muted" style={{ margin: 0 }}>Arrastre sobre la foto para señalar el desvío. La foto marcada es la que queda como evidencia.</p>
    </Modal>
  );
}
