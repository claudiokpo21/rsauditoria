#!/usr/bin/env node
/**
 * Respaldo y restauración de los ARCHIVOS de evidencias (bucket privado hse-evidencias).
 * Se ejecuta en un equipo de administración con la clave service_role del proyecto
 * (NUNCA en el navegador ni en el repositorio). Cada archivo se guarda con su SHA-256.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backup/storage-tool.mjs backup  respaldos/2026-10-03/archivos [--esperados rutas.txt]
 *     node scripts/backup/storage-tool.mjs restore respaldos/2026-10-03/archivos
 *     node scripts/backup/storage-tool.mjs verify  respaldos/2026-10-03/archivos
 *
 * Para pruebas: STORAGE_LOCAL_DIR=/ruta usa una carpeta local como si fuera el bucket.
 * --esperados: lista de storage_path vigentes según la base (consulta en el manual) para
 * detectar evidencias sin archivo y archivos huérfanos.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const BUCKET = 'hse-evidencias';
const [cmd, dir, ...rest] = process.argv.slice(2);
const arg = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : null; };
if (!cmd || !dir) { console.error('uso: storage-tool.mjs backup|restore|verify <carpeta> [--esperados archivo]'); process.exit(1); }
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- adaptadores
async function adapter() {
  if (process.env.STORAGE_LOCAL_DIR) {
    const root = process.env.STORAGE_LOCAL_DIR;
    const walk = async (d) => {
      const out = [];
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) out.push(...(e.isDirectory() ? await walk(join(d, e.name)) : [join(d, e.name)]));
      return out;
    };
    return {
      list: async () => (await walk(root)).map(f => relative(root, f).split('\\').join('/')),
      get: async (p) => readFile(join(root, p)),
      exists: async (p) => stat(join(root, p)).then(() => true, () => false),
      put: async (p, buf) => { await mkdir(dirname(join(root, p)), { recursive: true }); await writeFile(join(root, p), buf, { flag: 'wx' }); },
    };
  }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Defina SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o STORAGE_LOCAL_DIR para pruebas)');
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
  const listDir = async (prefix) => {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb.list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      for (const e of data) {
        const p = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) out.push(...await listDir(p)); else out.push(p);
      }
      if (data.length < 1000) break;
    }
    return out;
  };
  return {
    list: () => listDir(''),
    get: async (p) => { const { data, error } = await sb.download(p); if (error) throw error; return Buffer.from(await data.arrayBuffer()); },
    exists: async (p) => { const i = p.lastIndexOf('/'); const { data } = await sb.list(p.slice(0, i), { search: p.slice(i + 1) }); return !!data?.some(e => e.name === p.slice(i + 1)); },
    put: async (p, buf, type) => { const { error } = await sb.upload(p, buf, { upsert: false, contentType: type }); if (error) throw error; },
  };
}
const typeOf = (p) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' })[p.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

// ---------------------------------------------------------------- comandos
const st = await adapter();
const manifestPath = join(dir, 'manifest.json');

if (cmd === 'backup') {
  const files = await st.list();
  const entries = [];
  for (const p of files) {
    const buf = await st.get(p);
    await mkdir(dirname(join(dir, 'archivos', p)), { recursive: true });
    await writeFile(join(dir, 'archivos', p), buf);
    entries.push({ path: p, size: buf.length, sha256: sha(buf) });
  }
  const report = { fecha: new Date().toISOString(), bucket: BUCKET, archivos: entries.length, bytes: entries.reduce((s, e) => s + e.size, 0) };
  const expected = arg('--esperados');
  if (expected) {
    const want = new Set((await readFile(expected, 'utf8')).split('\n').map(s => s.trim()).filter(Boolean));
    const have = new Set(entries.map(e => e.path));
    report.evidencias_sin_archivo = [...want].filter(p => !have.has(p));
    report.archivos_huerfanos = [...have].filter(p => !want.has(p));
  }
  await writeFile(manifestPath, JSON.stringify({ ...report, entries }, null, 1));
  console.log(JSON.stringify(report));
  if (report.evidencias_sin_archivo?.length) process.exitCode = 4;
} else if (cmd === 'restore' || cmd === 'verify') {
  const m = JSON.parse(await readFile(manifestPath, 'utf8'));
  const res = { restaurados: 0, ya_presentes: 0, diferentes: [], corruptos_en_respaldo: [] };
  for (const e of m.entries) {
    const local = await readFile(join(dir, 'archivos', e.path));
    if (sha(local) !== e.sha256) { res.corruptos_en_respaldo.push(e.path); continue; }
    if (await st.exists(e.path)) {
      const cur = await st.get(e.path);
      if (sha(cur) === e.sha256) res.ya_presentes++;
      else res.diferentes.push(e.path);                     // nunca se sobrescribe: se informa para revisión manual
      continue;
    }
    if (cmd === 'verify') { res.diferentes.push(`${e.path} (falta en el destino)`); continue; }
    await st.put(e.path, local, typeOf(e.path));
    const back = await st.get(e.path);
    if (sha(back) !== e.sha256) throw new Error(`Verificación fallida tras subir ${e.path}`);
    res.restaurados++;
  }
  console.log(JSON.stringify(res));
  if (res.diferentes.length || res.corruptos_en_respaldo.length) process.exitCode = 5;
} else { console.error('comando desconocido'); process.exit(1); }
