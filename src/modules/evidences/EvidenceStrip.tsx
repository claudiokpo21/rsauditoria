import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { softDelete } from '../../db/repo';
import { useAuth } from '../auth/AuthProvider';
import { Button, Modal, useToast } from '../../components/ui';
import { addEvidence, evidenceUrl, type EvidenceTarget } from './evidenceService';
import type { Evidence } from '../../types';

function Thumb({ ev, pending, onOpen }: { ev: Evidence; pending: boolean; onOpen: (url: string | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null; let alive = true;
    void evidenceUrl(ev.id, ev.storage_path).then(u => { if (!alive) return; setUrl(u); if (u?.startsWith('blob:')) revoke = u; });
    return () => { alive = false; if (revoke) URL.revokeObjectURL(revoke); };
  }, [ev.id, ev.storage_path]);
  return (
    <button className="thumb" onClick={() => onOpen(url)} title={ev.caption ?? ev.file_name ?? ''} type="button">
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
  const pendingUploads = useLiveQuery(async () => new Set((await db.outbox.where('table').equals('hse_evidences').toArray()).filter(o => o.kind === 'upload').map(o => o.record_id)), []) ?? new Set();

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { if (beforeAdd) await beforeAdd(); for (const f of Array.from(files)) await addEvidence(target, f, undefined, userId); toast(files.length > 1 ? `${files.length} evidencias agregadas` : 'Evidencia agregada'); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'bad'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  return (
    <div className="thumbs">
      {list.map(ev => <Thumb key={ev.id} ev={ev} pending={pendingUploads.has(ev.id)} onOpen={url => setView({ ev, url })} />)}
      {!readOnly ? <>
        <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={e => void onFiles(e.target.files)} />
        <Button type="button" variant="secondary" className="btn-sm" busy={busy} onClick={() => input.current?.click()}>📷 Evidencia</Button>
      </> : null}
      <Modal open={!!view} title={view?.ev.caption ?? view?.ev.file_name ?? 'Evidencia'} onClose={() => setView(null)} wide
        footer={!readOnly && view ? <Button variant="danger" onClick={async () => { await softDelete('hse_evidences', view.ev.id); setView(null); }}>Quitar evidencia</Button> : undefined}>
        {view?.url ? (view.ev.mime_type === 'application/pdf' ? <a href={view.url} target="_blank" rel="noreferrer">Abrir PDF</a> : <img src={view.url} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />) : <p className="muted">El archivo se verá cuando haya conexión.</p>}
        {view ? <p className="muted small">{view.ev.taken_at ? new Date(view.ev.taken_at).toLocaleString('es-AR') : ''}{view.ev.latitude ? ` · ${view.ev.latitude}, ${view.ev.longitude}` : ''}</p> : null}
      </Modal>
    </div>
  );
}
