import { db } from '../../db/db';
import { newId, nowIso, saveEvidenceWithBlob } from '../../db/repo';
import { supabase, EVIDENCE_BUCKET } from '../../lib/supabase';
import { decryptBlob } from '../../lib/localCrypto';

const MAX_SIDE = 1920;  // fotos de 12–48 MP de celulares se reducen a ~0,3–1 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Reduce fotografías a JPEG ≤1920 px (las cámaras de celulares generan 4–12 MB). */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.82));
}

function position(): Promise<GeolocationPosition | null> {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res(p), () => res(null), { timeout: 4000, maximumAge: 60_000 });
  });
}

export interface EvidenceTarget { organization_id: string; audit_id: string; response_id?: string | null; finding_id?: string | null; action_id?: string | null }

export async function addEvidence(target: EvidenceTarget, file: File, caption?: string, userId?: string) {
  const blob = await compressImage(file);
  const mime = blob.type || file.type;
  if (!ALLOWED.includes(mime)) throw new Error('Formato no admitido. Use JPG, PNG, WEBP o PDF.');
  if (blob.size > 15 * 1024 * 1024) throw new Error('El archivo supera 15 MB.');
  const id = newId();
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const pos = await position();
  await saveEvidenceWithBlob({
    id, organization_id: target.organization_id, audit_id: target.audit_id,
    response_id: target.response_id ?? null, finding_id: target.finding_id ?? null, action_id: target.action_id ?? null,
    storage_path: `${target.organization_id}/${target.audit_id}/${id}.${ext}`,
    file_name: file.name.slice(0, 200), mime_type: mime, size_bytes: blob.size, caption: caption?.trim() || null,
    taken_at: file.lastModified ? new Date(file.lastModified).toISOString() : nowIso(),
    latitude: pos ? +pos.coords.latitude.toFixed(6) : null, longitude: pos ? +pos.coords.longitude.toFixed(6) : null,
    uploaded_by: userId ?? null,
  }, blob);
}

const urlCache = new Map<string, { url: string; exp: number }>();

/** URL para mostrar: el archivo local si existe; si no, URL firmada de 10 minutos (requiere conexión). */
export async function evidenceUrl(evidenceId: string, storagePath: string): Promise<string | null> {
  const local = await db.blobs.get(evidenceId);
  if (local) return URL.createObjectURL(await decryptBlob(local.enc));
  const c = urlCache.get(storagePath);
  if (c && c.exp > Date.now()) return c.url;
  if (!navigator.onLine) return null;
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, 600);
  if (error || !data) return null;
  urlCache.set(storagePath, { url: data.signedUrl, exp: Date.now() + 540_000 });
  return data.signedUrl;
}

/** Descarga la evidencia como data URL (para informes PDF). */
export async function evidenceDataUrl(evidenceId: string, storagePath: string): Promise<string | null> {
  const row = await db.blobs.get(evidenceId);
  let blob: Blob | null = row ? await decryptBlob(row.enc) : null;
  if (!blob && navigator.onLine) {
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).download(storagePath);
    blob = data ?? null;
  }
  if (!blob || !blob.type.startsWith('image/')) return null;
  return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => res(null); r.readAsDataURL(blob!); });
}
