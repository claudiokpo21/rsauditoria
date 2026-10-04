"""
Pruebas de navegador del funcionamiento offline-first (Chromium real: IndexedDB,
Service Worker, WebCrypto, cámara simulada con archivos).

Antes: python3 tests/e2e/make_fixtures.py (genera foto y PDF grandes)
Uso:  python3 tests/e2e/offline_e2e.py http://localhost:4176  [carpeta_salida]
Requiere un build con VITE_SUPABASE_URL apuntando al proyecto (se intercepta).
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright, expect
from fake_supabase import FakeSupabase

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4176'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e-out'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
PHOTO = os.path.join(HERE, 'foto_grande.jpg')
PDF = os.path.join(HERE, 'informe_grande.pdf')
SB = 'https://hhwfhearafhmougtfssu.supabase.co'
STORAGE_KEY = 'sb-hhwfhearafhmougtfssu-auth-token'

fake = FakeSupabase()
results = []

def check(name, cond, detail=''):
    results.append({'prueba': name, 'ok': bool(cond), 'detalle': detail})
    print(('OK   ' if cond else 'FALLA'), name, '-', detail, flush=True)

IDB_JS = """async ([store, op]) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('hse-audit-manager'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction(store, 'readonly'); const st = tx.objectStore(store);
  const all = await new Promise(res => { const r = st.getAll(); r.onsuccess = () => res(r.result); });
  db.close();
  if (op === 'count') return all.length;
  if (op === 'statuses') return all.map(o => o.status);
  if (op === 'blobsizes') return all.map(b => ({ id: b.evidence_id, size: b.enc.size, cipher: b.enc.data.byteLength, type: b.enc.type, hasPlain: 'blob' in b }));
  return all;
}"""

def idb(page, store, op='count'):
    return page.evaluate(IDB_JS, [store, op])

def phase(page):
    return page.locator('[data-sync-phase]').first.get_attribute('data-sync-phase')

def wait_phase(page, want, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if phase(page) in want: return True
        except Exception: pass
        time.sleep(0.5)
    return False

def new_context(browser, who):
    ctx = browser.new_context(viewport={'width': 412, 'height': 915}, service_workers='allow')   # tamaño de celular
    ctx.add_init_script(f"if (!localStorage.getItem('{STORAGE_KEY}')) localStorage.setItem('{STORAGE_KEY}', {json.dumps(json.dumps(fake.session(who)))});")
    ctx.route(f'{SB}/**', fake.handle)
    return ctx

def open_audit(page):
    page.goto(f'{BASE}/auditorias/{fake.audit}')
    page.wait_for_selector('.item', timeout=30000)

def items(page):
    return page.locator('.item')

def answer(page, idx, label):
    items(page).nth(idx).get_by_role('radio', name=label, exact=True).click()

def server_responses():
    return [r for r in fake.tables['hse_audit_responses'].values()]

with sync_playwright() as p:
    browser = p.chromium.launch()
    # =================================================================== 1. descarga previa
    ctxA = new_context(browser, 'A')
    A = ctxA.new_page()
    A.goto(BASE + '/')
    A.wait_for_selector('text=Dashboard', timeout=30000)
    check('1.1 Primer ingreso con conexión y descarga inicial', wait_phase(A, ['sincronizado']), f'fase={phase(A)}')
    A.wait_for_function('navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready', timeout=20000)
    A.reload(); A.wait_for_selector('text=Dashboard')
    sw = A.evaluate('navigator.serviceWorker.controller ? "activo" : "no"')
    check('1.2 Service Worker controla la app (recursos en caché)', sw == 'activo', sw)
    open_audit(A)
    A.get_by_role('button', name='Descargar para usar sin conexión').click()
    expect(A.get_by_role('button', name='✓ Disponible sin conexión')).to_be_visible(timeout=20000)
    check('1.3 Auditoría descargada para uso sin conexión', True, f'{len(fake.items)} ítems de plantilla')

    # =================================================================== 2. trabajo sin conexión
    ctxA.set_offline(True); fake.down = True
    answer(A, 0, 'Cumple')
    answer(A, 1, 'No cumple')
    ta = items(A).nth(1).locator('textarea'); ta.fill('Extintor del dog house vencido en 08/2026.'); ta.blur()
    items(A).nth(1).locator('input[type=file]').set_input_files(PHOTO)
    # marcar el desvío sobre la foto (flecha) antes de guardarla, sin conexión
    cv = A.locator('canvas.annot'); cv.wait_for(timeout=60000); A.wait_for_timeout(800)
    bb = cv.bounding_box()
    A.mouse.move(bb['x'] + bb['width'] * .2, bb['y'] + bb['height'] * .8); A.mouse.down()
    A.mouse.move(bb['x'] + bb['width'] * .5, bb['y'] + bb['height'] * .5, steps=8); A.mouse.up()
    A.get_by_role('button', name='Guardar con marcas').click()
    A.wait_for_selector('canvas.annot', state='detached', timeout=30000)
    items(A).nth(2).locator('input[type=file]').set_input_files(PDF)
    A.wait_for_function("document.querySelectorAll('.thumb .pend').length >= 2", timeout=60000)
    time.sleep(1)
    st = idb(A, 'outbox', 'statuses')
    check('2.1 Cambios offline guardados en la cola persistente', len(st) >= 5 and set(st) <= {'pendiente'}, f'{len(st)} operaciones {set(st)}')
    check('2.2 Estado visible "Sin conexión"', wait_phase(A, ['sin_conexion'], 10), A.locator('[data-sync-phase]').inner_text())
    bl = idb(A, 'blobs', 'blobsizes')
    photo = [b for b in bl if b['type'] == 'image/jpeg']; pdf = [b for b in bl if b['type'] == 'application/pdf']
    check('2.3 Foto grande comprimida en el dispositivo', photo and photo[0]['size'] < 2_500_000, f"original {os.path.getsize(PHOTO)/1e6:.1f} MB → {photo[0]['size']/1e6:.2f} MB" if photo else 'sin foto')
    evs = idb(A, 'hse_evidences', 'all')
    check('2.5 Foto marcada sobre el desvío (flecha) y guardada como evidencia, sin conexión', any('marcada' in (e.get('file_name') or '') for e in evs), ', '.join(e.get('file_name') or '' for e in evs))
    check('2.4 Archivos guardados cifrados (AES-GCM, sin copia en claro)', all(not b['hasPlain'] and b['cipher'] == b['size'] + 16 for b in bl), f'{len(bl)} archivos')
    A.screenshot(path=f'{OUT}/2-offline-celular.png', full_page=True)

    # =================================================================== 3. recargas y reinicio
    A.reload(); A.wait_for_selector('.item', timeout=30000)
    ok = items(A).nth(0).get_by_role('radio', name='Cumple', exact=True).get_attribute('aria-checked') == 'true'
    check('3.1 Recarga sin conexión: la app abre desde el Service Worker y conserva respuestas', ok and idb(A, 'outbox') == len(st), f'cola={idb(A, "outbox")}')
    A.close()
    A = ctxA.new_page()                     # nueva pestaña = navegador reabierto (mismo perfil)
    A.goto(f'{BASE}/auditorias/{fake.audit}'); A.wait_for_selector('.item', timeout=30000)
    ta_val = items(A).nth(1).locator('textarea').input_value()
    check('3.2 Reapertura sin conexión: cola y comentarios intactos', idb(A, 'outbox') == len(st) and 'vencido' in ta_val, f'cola={idb(A, "outbox")}')

    # =================================================================== 4. reconexión con fallas
    fake.lose_next_push_response = 1        # el servidor aplica el lote pero la respuesta se pierde
    fake.fail_tus_patch = 4                 # la carga reanudable se corta varias veces
    fake.down = False; ctxA.set_offline(False)
    synced = wait_phase(A, ['sincronizado'], 180)
    resp = server_responses(); ev = list(fake.tables['hse_evidences'].values())
    check('4.1 Al reconectar se sincroniza solo y queda "Sincronizado"', synced, f'fase={phase(A)} llamadas push={fake.calls["push"]}')
    check('4.2 Respuesta perdida tras aplicar: se reenvió y no hubo duplicados (clave de idempotencia)',
          len(resp) == 3 and len(ev) == 2 and len(fake.receipts) == len(st) and fake.calls['push_ops'] > len(fake.receipts),
          f'respuestas={len(resp)} evidencias={len(ev)} recibos únicos={len(fake.receipts)} operaciones enviadas (con reenvío)={fake.calls["push_ops"]}')
    pdf_obj = [v for k, v in fake.objects.items() if k.endswith('.pdf')]
    check('4.3 PDF de 14,7 MB subido por partes y reanudado tras cortes', pdf_obj and pdf_obj[0] == os.path.getsize(PDF), f'bytes={pdf_obj[0] if pdf_obj else 0} PATCH={fake.calls["tus_patch"]} HEAD={fake.calls["tus_head"]}')
    check('4.4 Un archivo por evidencia (sin duplicar al reintentar)', len(fake.objects) == 2, f'objetos={len(fake.objects)} subidas estándar={fake.calls["upload"]}')
    a_srv = [r for r in resp if r['item_id'] == fake.items[1]][0]
    check('4.5 Datos correctos en el servidor', a_srv['answer'] == 'no_cumple' and 'vencido' in (a_srv['comment'] or ''), json.dumps({k: a_srv[k] for k in ('answer', 'comment', 'row_version')}, ensure_ascii=False))
    lc = A.locator('[data-sync-phase]').get_attribute('title')
    meta = A.evaluate("async () => { const db = await new Promise(r => { const q = indexedDB.open('hse-audit-manager'); q.onsuccess = () => r(q.result); }); const v = await new Promise(r => { const q = db.transaction('meta').objectStore('meta').getAll(); q.onsuccess = () => r(q.result); }); db.close(); return (v.find(m => m.key.startsWith('last_sync_confirmed:')) || {}).value || null; }")
    check('4.6 Muestra la fecha de la última sincronización confirmada', meta is not None and 'nunca' not in lc, f'{lc} (registrada {meta})')

    # =================================================================== 5. sincronización repetida
    before = (len(server_responses()), len(fake.tables['hse_evidences']), len(fake.objects), len(fake.receipts))
    A.goto(f'{BASE}/admin/sync'); A.wait_for_selector('text=Cola de operaciones')
    for _ in range(3):
        A.get_by_role('button', name='Sincronizar ahora').click(); time.sleep(2.5)
    after = (len(server_responses()), len(fake.tables['hse_evidences']), len(fake.objects), len(fake.receipts))
    check('5.1 Sincronizar varias veces no cambia ni duplica nada', before == after and idb(A, 'outbox') == 0, f'antes={before} después={after}')
    A.screenshot(path=f'{OUT}/5-sincronizado.png', full_page=True)

    # =================================================================== 6. dos usuarios, cambios simultáneos
    ctxB = new_context(browser, 'B')
    B = ctxB.new_page(); B.goto(BASE + '/'); B.wait_for_selector('text=Dashboard', timeout=30000); wait_phase(B, ['sincronizado'])
    open_audit(B); B.get_by_role('button', name='Descargar para usar sin conexión').click()
    expect(B.get_by_role('button', name='✓ Disponible sin conexión')).to_be_visible(timeout=20000)
    open_audit(A)
    ctxA.set_offline(True); ctxB.set_offline(True); fake.down = True
    answer(A, 0, 'No cumple')                                   # A cambia el ítem 1
    answer(B, 0, 'N/A')                                         # B cambia el MISMO ítem
    tb = items(B).nth(2).locator('textarea'); tb.fill('B: kit antiderrame completo'); tb.blur()   # y otro campo distinto
    time.sleep(1)
    fake.down = False
    ctxA.set_offline(False); wait_phase(A, ['sincronizado'], 60)
    ctxB.set_offline(False); wait_phase(B, ['error', 'sincronizado'], 60)
    r1 = [r for r in server_responses() if r['item_id'] == fake.items[0]][0]
    r3 = [r for r in server_responses() if r['item_id'] == fake.items[2]][0]
    check('6.1 Conflicto detectado en el mismo campo (estado "Error")', phase(B) == 'error' and 'conflicto' in idb(B, 'outbox', 'statuses'), f'fase B={phase(B)} cola={idb(B, "outbox", "statuses")}')
    check('6.2 No se sobrescribió el cambio de A', r1['answer'] == 'no_cumple', f'servidor ítem 1={r1["answer"]}')
    check('6.3 El cambio de B en otro registro sí se aplicó', 'antiderrame' in (r3.get('comment') or ''), f'servidor ítem 3 comentario={r3.get("comment")}')
    B.goto(f'{BASE}/admin/sync'); B.get_by_role('button', name='Resolver').click()
    B.wait_for_selector('[data-testid=conflict-table]')
    B.screenshot(path=f'{OUT}/6-conflicto.png', full_page=True)
    B.get_by_role('button', name='Usar la del servidor').click()
    ok = wait_phase(B, ['sincronizado'], 30)
    open_audit(B)
    shown = items(B).nth(0).get_by_role('radio', name='No cumple', exact=True).get_attribute('aria-checked')
    check('6.4 Resolución manual: B adopta la versión del servidor', ok and shown == 'true', f'fase={phase(B)}')

    # =================================================================== 7. advertencias
    ctxA.set_offline(True); fake.down = True
    open_audit(A); answer(A, 2, 'Cumple'); time.sleep(0.8)
    A.goto(f'{BASE}/perfil'); A.get_by_role('button', name='Cerrar sesión').click()
    try:
        expect(A.get_by_text('Cambios sin sincronizar')).to_be_visible(timeout=5000); ok71 = True
    except Exception: ok71 = False
    check('7.1 Advierte antes de cerrar sesión con datos pendientes', ok71 and idb(A, 'outbox') > 0, f'cola={idb(A, "outbox")}')
    A.keyboard.press('Escape')
    A.goto(f'{BASE}/admin/sync'); A.get_by_role('button', name='Borrar datos de este dispositivo').click()
    try:
        expect(A.get_by_text('se perderán definitivamente')).to_be_visible(timeout=5000); ok72 = True
    except Exception: ok72 = False
    check('7.2 Advierte antes de borrar datos locales con pendientes', ok72, '')
    A.keyboard.press('Escape')
    # 7.3 la advertencia del navegador al cerrar la pestaña con pendientes
    A.goto(f'{BASE}/'); A.wait_for_selector('[data-sync-phase]')
    dialogs = []
    def on_dialog(d):
        dialogs.append(d.type); d.dismiss()     # el usuario elige "quedarse"
    A.on('dialog', on_dialog)
    for _ in range(3):                      # repetido: el aviso debe aparecer siempre
        A.locator('h1').first.click()       # Chrome sólo muestra el aviso si hubo interacción del usuario
        try: A.evaluate("location.href = 'about:blank'")
        except Exception: pass
        time.sleep(1.2)
    stayed = A.url.startswith(BASE)
    check('7.3 Aviso del navegador al salir/cerrar con cambios pendientes (3 de 3) y permite quedarse',
          dialogs.count('beforeunload') == 3 and stayed and idb(A, 'outbox') > 0, f'avisos={dialogs} sigue en la app={stayed}')
    # =================================================================== 8. expiración de la autorización offline
    SET_VALIDATION = """async (daysAgo) => {
      const db = await new Promise(r => { const q = indexedDB.open('hse-audit-manager'); q.onsuccess = () => r(q.result); });
      await new Promise(r => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ key: 'last_server_validation', value: new Date(Date.now() - daysAgo * 864e5).toISOString() }); tx.oncomplete = r; });
      db.close(); }"""
    A = ctxA.new_page()                     # sigue sin conexión, con 1 cambio pendiente del paso 7
    A.goto(f'{BASE}/'); A.wait_for_selector('[data-sync-phase]', timeout=30000)
    pend0 = idb(A, 'outbox'); audits0 = idb(A, 'hse_audits')
    A.evaluate(SET_VALIDATION, 8); A.reload()
    try: expect(A.get_by_text('Se requiere conexión')).to_be_visible(timeout=15000); locked = True
    except Exception: locked = False
    check('8.1 A los 8 días sin revalidar: la app se bloquea y conserva datos y pendientes', locked and idb(A, 'outbox') == pend0 and idb(A, 'hse_audits') == audits0, f'pendientes={idb(A, "outbox")} auditorías locales={idb(A, "hse_audits")}')
    A.screenshot(path=f'{OUT}/8-bloqueo.png', full_page=True)
    A.evaluate(SET_VALIDATION, 31); A.reload()
    try: expect(A.get_by_text('se eliminaron de este dispositivo')).to_be_visible(timeout=15000); wiped_msg = True
    except Exception: wiped_msg = False
    resp_left = idb(A, 'hse_audit_responses'); blobs_left = idb(A, 'blobs')
    check('8.2 A los 31 días: borrado de lo sincronizado, sólo quedan los pendientes', wiped_msg and idb(A, 'outbox') == pend0 and idb(A, 'hse_audits') == 0 and resp_left == pend0 and blobs_left == 0,
          f'pendientes={idb(A, "outbox")} auditorías={idb(A, "hse_audits")} respuestas={resp_left} archivos={blobs_left}')
    fake.down = False; ctxA.set_offline(False)
    A.reload(); time.sleep(2)
    try:
        btn = A.get_by_role('button', name='Revalidar ahora')
        if btn.count(): btn.click()
    except Exception: pass
    ok83 = False
    try: A.wait_for_selector('text=Dashboard', timeout=30000); ok83 = wait_phase(A, ['sincronizado'], 60)
    except Exception: pass
    check('8.3 Al reconectar se revalidan permisos, se envía lo pendiente y se desbloquea', ok83 and idb(A, 'outbox') == 0, f'fase={phase(A) if ok83 else "bloqueada"} cola={idb(A, "outbox")}')
    browser.close()

json.dump(results, open(f'{OUT}/resultados.json', 'w'), ensure_ascii=False, indent=2)
fails = [r for r in results if not r['ok']]
print(f'\n{len(results) - len(fails)}/{len(results)} pruebas OK')
sys.exit(1 if fails else 0)
