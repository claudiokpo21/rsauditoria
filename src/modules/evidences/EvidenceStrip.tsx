import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { patchRecord, softDelete } from '../../db/repo';
import { useAuth } from '../auth/AuthProvider';
import { Button, Field, Input, Modal, useToast } from '../../components/ui';
import { addEvidence, evidenceUrl, type EvidenceTarget } from './evidenceService';
import type { Evidence } from '../../types';
import { PhotoAnnotator } from './PhotoAnnotator';
import { photoNumbers } from './photoNumbers';

function Thumb({ ev, pending, num, onOpen }: { ev: Evidence; pending: boolean; num?: number; onOpen: (url: string | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null; let alive = true;
    void evidenceUrl(ev.id, ev.storage_path).then(u => { if (!alive) return; setUrl(u); if (u?.startsWith('blob:')) revoke = u; });
    return () => { alive = false; if (revoke) URL.revokeObjectURL(revoke); };
  }, [ev.id, ev.storage_path]);
  return (
    <button className="thumb" onClick={() => onOpen(url)} title={`${num ? `Foto ${num}` : ''}${ev.caption ? ` · ${ev.caption}` : ''}`} type="button">
      {num ? <span className="photo-num">Foto {num}</span> : null}
      {ev.mime_type === 'application/pdf' ? 'PDF' : url ? <img src={url} alt={ev.caption ?? 'Evidencia'} loading="lazy" /> : 'Disponible con conexión'}
      {pending ? <span className="pend">sin subir</span> : null}
    </button>
  );
}

/** Tira de evidencias de una respuesta, hallazgo o acción, con captura desde la cámara. */
export function EvidenceStrip({ target, filter, readOnly, beforeAdd }: { target: EvidenceTarget; filter: Partial<Pick<Evidence, 'response_id' | 'finding_id' | 'action_id'>>; readOnly?: boolean; beforeAdd?: () => Promise<void> }) {
  const { userId } = useAuth();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ ev: Evidence; url: string | null } | null>(null);
  const key = Object.entries(filter).find(([, v]) => v)?.[0] as keyof Evidence | undefined;
  const val = key ? (filter as Record<string, string>)[key] : undefined;
  const list = useLiveQuery(async () => {
    if (!key || !val) return [];
    return (await db.hse_evidences.where(key as string).equals(val).toArray()).filter(e => !e.deleted_at);
  }, [key, val]) ?? [];
  // numeración de fotos de toda la auditoría (la misma que en el informe)
  const nums = useLiveQuery(async () => photoNumbers(await db.hse_evidences.where('audit_id').equals(target.audit_id).toArray()), [target.audit_id]) ?? new Map<string, number>();
  const [caption, setCaption] = useState('');
  const pendingUploads = useLiveQuery(async () => new Set((await db.outbox.where('table').equals('hse_evidences').toArray()).filter(o => o.kind === 'upload').map(o => o.record_id)), []) ?? new Set();

  const [annotate, setAnnotate] = useState<File | null>(null);
  const save = async (files: File[], desc?: string) => {
    setBusy(true);
    try { if (beforeAdd) await beforeAdd(); for (const f of files) await addEvidence(target, f, desc, userId); toast(files.length > 1 ? `${files.length} evidencias agregadas` : 'Evidencia agregada'); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'bad'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    // una sola foto: se ofrece marcar el desvío antes de guardarla
    if (list.length === 1 && list[0].type.startsWith('image/')) { setAnnotate(list[0]); return; }
    await save(list);
  };

  return (
    <div className="thumbs">
      {list.map(ev => <Thumb key={ev.id} ev={ev} num={nums.get(ev.id)} pending={pendingUploads.has(ev.id)} onOpen={url => { setCaption(ev.caption ?? ''); setView({ ev, url }); }} />)}
      {!readOnly ? <>
        <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={e => void onFiles(e.target.files)} />
        <Button type="button" variant="secondary" className="btn-sm" busy={busy} onClick={() => input.current?.click()}>📷 Evidencia</Button>
      </> : null}
      <PhotoAnnotator file={annotate} onCancel={() => { setAnnotate(null); if (input.current) input.current.value = ''; }}
        onDone={(f, desc) => { setAnnotate(null); void save([f], desc); }} />
      <Modal open={!!view} title={view && nums.get(view.ev.id) ? `Foto ${nums.get(view.ev.id)}` : view?.ev.file_name ?? 'Evidencia'} onClose={() => setView(null)} wide
        footer={!readOnly && view ? <Button variant="danger" onClick={async () => { await softDelete('hse_evidences', view.ev.id); setView(null); }}>Quitar evidencia</Button> : undefined}>
        {view?.url ? (view.ev.mime_type === 'application/pdf' ? <a href={view.url} target="_blank" rel="noreferrer">Abrir PDF</a> : <img src={view.url} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />) : <p className="muted">El archivo se verá cuando haya conexión.</p>}
        {view && !readOnly ? (
          <div className="row gap wrap" style={{ alignItems: 'flex-end' }}>
            <div className="grow"><Field label="Descripción de la foto"><Input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Qué muestra la foto" /></Field></div>
            <Button variant="secondary" disabled={caption.trim() === (view.ev.caption ?? '')} onClick={async () => { await patchRecord<Evidence>('hse_evidences', view.ev.id, { caption: caption.trim() || null }); toast('Descripción guardada'); }}>Guardar descripción</Button>
          </div>) : view?.ev.caption ? <p style={{ margin: 0 }}>{view.ev.caption}</p> : null}
        {view ? <p className="muted small">{view.ev.taken_at ? new Date(view.ev.taken_at).toLocaleString('es-AR') : ''}{view.ev.latitude ? ` · ${view.ev.latitude}, ${view.ev.longitude}` : ''}</p> : null}
      </Modal>
    </div>
  );
}
