/**
 * Subida de archivos de evidencia.
 *  - Ruta determinística {org}/{auditoría}/{evidencia}.ext y x-upsert=false: un reintento
 *    nunca crea un segundo archivo; si el servidor ya lo tiene, se considera recibido.
 *  - Archivos de más de 6 MB: carga reanudable TUS por partes de 6 MB (protocolo de
 *    Supabase Storage). La URL de la carga se guarda en IndexedDB, de modo que tras un
 *    corte o una recarga del navegador continúa desde el último trozo confirmado.
 */
import * as tus from 'tus-js-client';
import { db } from '../db/db';
import { decryptBlob } from '../lib/localCrypto';
import { supabase, EVIDENCE_BUCKET } from '../lib/supabase';
import { env } from '../lib/env';

export const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;
const CHUNK = 6 * 1024 * 1024;   // Supabase exige trozos de 6 MB

/** UrlStorage de tus-js-client persistido en IndexedDB (sobrevive a recargas). */
const urlStorage: tus.UrlStorage = {
  async findAllUploads() { return (await db.tus_uploads.toArray()).map(r => ({ urlStorageKey: r.fingerprint, uploadUrl: r.url, size: 0, metadata: {}, creationTime: r.created_at })) as never; },
  async findUploadsByFingerprint(fp: string) {
    const r = await db.tus_uploads.get(fp);
    return r ? [{ urlStorageKey: fp, uploadUrl: r.url, size: 0, metadata: {}, creationTime: r.created_at }] as never : [];
  },
  async removeUpload(key: string) { await db.tus_uploads.delete(key); },
  async addUpload(fp: string, upload: { uploadUrl?: string | null }) {
    if (upload.uploadUrl) await db.tus_uploads.put({ fingerprint: fp, url: upload.uploadUrl, created_at: new Date().toISOString() });
    return fp;
  },
};

const alreadyExists = (msg: string, status?: number) => status === 409 || /already exists|duplicate|exists/i.test(msg);

export type UploadProgress = (sent: number, total: number) => void;

export async function uploadEvidenceFile(evidenceId: string, path: string, onProgress?: UploadProgress): Promise<'subido' | 'ya_existia'> {
  const row = await db.blobs.get(evidenceId);
  if (!row) throw Object.assign(new Error('El archivo de la evidencia ya no está en este dispositivo'), { permanent: true });
  const blob = await decryptBlob(row.enc);

  if (blob.size <= RESUMABLE_THRESHOLD) {
    const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, blob, { contentType: row.mime_type, upsert: false, cacheControl: '3600' });
    if (error) {
      if (alreadyExists(error.message, (error as { statusCode?: string | number }).statusCode ? Number((error as { statusCode?: string | number }).statusCode) : undefined)) return 'ya_existia';
      throw error;
    }
    onProgress?.(blob.size, blob.size);
    return 'subido';
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error('Sesión vencida: inicie sesión para subir archivos'), { code: '28000' });
  return await new Promise((resolve, reject) => {
    const up = new tus.Upload(blob, {
      endpoint: `${env.supabaseUrl}/storage/v1/upload/resumable`,
      chunkSize: CHUNK,
      retryDelays: [0, 3000, 10000],
      removeFingerprintOnSuccess: true,
      fingerprint: async () => `ev:${evidenceId}`,
      urlStorage,
      headers: { authorization: `Bearer ${token}`, apikey: env.supabaseKey, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      metadata: { bucketName: EVIDENCE_BUCKET, objectName: path, contentType: row.mime_type, cacheControl: '3600' },
      onProgress: (sent, total) => onProgress?.(sent, total),
      onError: err => {
        const status = (err as tus.DetailedError).originalResponse?.getStatus();
        const body = (err as tus.DetailedError).originalResponse?.getBody() ?? err.message;
        if (alreadyExists(String(body), status)) { void db.tus_uploads.delete(`ev:${evidenceId}`); resolve('ya_existia'); }
        else reject(Object.assign(new Error(`Carga reanudable interrumpida: ${err.message}`), { network: !status || status >= 500 }));
      },
      onSuccess: () => resolve('subido'),
    });
    up.findPreviousUploads().then(prev => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); }, () => up.start());
  });
}
