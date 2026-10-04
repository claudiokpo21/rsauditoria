#!/usr/bin/env node
/**
 * Verifica que el build publicado no contenga secretos administrativos:
 *  - claves secretas de Supabase (sb_secret_…)
 *  - JWT con rol service_role / supabase_admin
 *  - cadenas de conexión a PostgreSQL con contraseña
 * Uso: node scripts/scan-secrets.mjs [carpeta=dist]   (falla con código 1 si encuentra algo)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.argv[2] ?? 'dist';
const files = [];
const walk = async (d) => { for (const e of await readdir(d, { withFileTypes: true })) e.isDirectory() ? await walk(join(d, e.name)) : files.push(join(d, e.name)); };
await walk(root);
const findings = [];
for (const f of files) {
  if (!/\.(js|mjs|html|json|css|map|txt|webmanifest)$/.test(f)) continue;
  const s = await readFile(f, 'utf8');
  for (const m of s.matchAll(/sb_secret_[A-Za-z0-9_-]{16,}/g)) findings.push([f, 'clave secreta de Supabase', m[0].slice(0, 14) + '…']);
  for (const m of s.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try { const p = JSON.parse(Buffer.from(m[1], 'base64url').toString()); if (['service_role', 'supabase_admin'].includes(p.role)) findings.push([f, `JWT con rol ${p.role}`, m[0].slice(0, 16) + '…']); } catch { /* no es JWT */ }
  }
  for (const m of s.matchAll(/postgres(?:ql)?:\/\/[^:\s"'`]+:[^@\s"'`]+@/g)) findings.push([f, 'cadena de conexión con contraseña', m[0].replace(/:[^:@]+@/, ':***@')]);
}
console.log(`Analizados ${files.length} archivos de ${root}.`);
if (findings.length) { for (const x of findings) console.log('SECRETO', ...x); process.exit(1); }
console.log('Sin secretos administrativos en el build.');
