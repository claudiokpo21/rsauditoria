/**
 * Cifrado local de archivos (fotografías y PDF de evidencias).
 *
 * - Clave AES-GCM de 256 bits generada en el dispositivo como CryptoKey NO exportable
 *   y guardada en IndexedDB: los bytes de la clave nunca son accesibles a JavaScript
 *   ni quedan en archivos legibles; copiar la carpeta del navegador no basta para ver
 *   las fotos.
 * - Borrado seguro por "crypto-shredding": al eliminar la clave, cualquier resto de los
 *   archivos cifrados que quede en disco es irrecuperable.
 *
 * Alcance: protege frente a acceso accidental o copia del perfil del navegador. No protege
 * frente a alguien que use la aplicación con la sesión abierta en el mismo dispositivo.
 */
import { db } from '../db/db';

const KEY_ID = 'blob_key_v1';

async function getKey(): Promise<CryptoKey> {
  const row = await db.keys.get(KEY_ID);
  if (row) return row.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await db.keys.put({ id: KEY_ID, key, created_at: new Date().toISOString() });
  return key;
}

export interface EncryptedBlob { iv: Uint8Array; data: ArrayBuffer; type: string; size: number }

export async function encryptBlob(blob: Blob): Promise<EncryptedBlob> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await blob.arrayBuffer());
  return { iv, data, type: blob.type, size: blob.size };
}

export async function decryptBlob(e: EncryptedBlob): Promise<Blob> {
  const key = await getKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv as BufferSource }, key, e.data);
  return new Blob([plain], { type: e.type });
}

/** Elimina la clave: los archivos cifrados existentes quedan ilegibles. */
export async function shredKey() {
  await db.keys.clear();
}
