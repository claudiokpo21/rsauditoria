"""
Prueba visual de la planilla de resultado H&P (colores de bandas) en pantalla, PDF y Excel,
con la plantilla importada del Excel y las respuestas de la planilla (6,27 – Bueno).
Chromium con escritorio y celular emulado; el servidor Supabase se simula.

Uso: python3 tests/e2e/visual_hp_e2e.py http://localhost:4177 [carpeta_salida]
"""
import json, os, sys, uuid
from playwright.sync_api import sync_playwright
from pypdf import PdfReader
from openpyxl import load_workbook
from fake_supabase import FakeSupabase, now_iso

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4177'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e-out-visual'
os.makedirs(OUT, exist_ok=True)
SB = 'https://hhwfhearafhmougtfssu.supabase.co'
STORAGE_KEY = 'sb-hhwfhearafhmougtfssu-auth-token'
HERE = os.path.dirname(os.path.abspath(__file__))
PAYLOAD = json.load(open(os.path.join(HERE, '..', '..', 'src', 'modules', 'demo', 'hp-payload.json'), encoding='utf-8'))
results = []

def check(name, cond, detail=''):
    results.append({'prueba': name, 'ok': bool(cond), 'detalle': detail})
    print(('OK   ' if cond else 'FALLA'), name, '-', detail, flush=True)

POINTS = {'nc': 0, 'obs': 1, 'opm': 2, 'ok': 3, 'na': 0}
def profile_answer(profile, rn, seed):   # igual que hse_demo_answer (0024)
    k = (rn * 7 + seed) % 10
    if profile == 'muy_bueno': return 'ok' if k < 7 else 'opm' if k < 9 else 'obs'
    if profile == 'regular': return 'ok' if k < 4 else 'opm' if k < 5 else 'obs' if k < 7 else 'nc'
    return 'ok' if k < 2 else 'opm' if k < 3 else 'obs' if k < 5 else 'nc'

def band_of(v):
    for b in PAYLOAD['version']['scoring_config']['bands']:
        if (b['min'] is None or v >= b['min']) and (b['max'] is None or v <= b['max']): return b['label']

class Fake(FakeSupabase):
    def seed(self):
        super().seed()
        A = self.users['A']
        t = self.put('hse_templates', {'id': str(uuid.uuid4()), 'name': PAYLOAD['template']['name'], 'category': 'csms', 'description': None, 'active': True})
        v = self.put('hse_template_versions', {'id': str(uuid.uuid4()), 'template_id': t['id'], 'version_number': 1, 'status': 'publicada',
            'scoring_method': 'situacion_promedio_secciones', 'scoring_config': PAYLOAD['version']['scoring_config'], 'validation_status': 'validada', 'published_at': now_iso()})
        self.hp_sections = []          # (section_id, title, [item ids by key])
        keymap = {}
        for si, s in enumerate(PAYLOAD['sections']):
            sec = self.put('hse_template_sections', {'id': str(uuid.uuid4()), 'version_id': v['id'], 'title': s['title'], 'sort_order': si, 'code': None, 'description': None})
            ids = []
            for ii, it in enumerate(s['items']):
                row = self.put('hse_template_items', {'id': str(uuid.uuid4()), 'version_id': v['id'], 'section_id': sec['id'], 'code': it.get('code'), 'original_number': it.get('original_number'),
                    'question': it['question'], 'response_type': 'situacion', 'weight': 1, 'is_critical': False, 'evidence_required_on_fail': False, 'is_required': True,
                    'sort_order': ii, 'process_id': None, 'review_flags': [], 'guidance': None, 'legal_reference': None, 'source_ref': it.get('source_ref')})
                keymap[it['key']] = row['id']; ids.append((it['key'], row['id']))
            self.hp_sections.append((sec['id'], s['title'], ids))
        excel = PAYLOAD['validation_cases'][0]['answers']
        # caso de validación importado con el Excel (respuestas por ítem), como queda al importar la planilla
        self.hp_template = t['id']
        self.put('hse_template_validation_cases', {'id': str(uuid.uuid4()), 'version_id': v['id'], 'name': 'Resultados de prueba del Excel (planilla H&P)', 'source_ref': None,
            'answers': {keymap[k]: a for k, a in excel.items()}, 'expected': {'sections': {}, 'final': 6.2711}, 'computed': None, 'matches': True, 'max_abs_diff': 0, 'last_run_at': now_iso()})
        rn = {k: n + 1 for n, k in enumerate(k for _, _, ids in self.hp_sections for k, _ in ids)}
        companies = [self.company] + [self.put('hse_companies', {'id': str(uuid.uuid4()), 'name': n, 'company_type': 'contratista', 'csms_status': 'aprobada', 'active': True, 'tax_id': None, 'parent_company_id': None})['id']
                                      for n in ('Transportes Cuenca Neuquina S.R.L.', 'Montajes Industriales del Sur')]
        specs = [('AUD-2026-0010', 'CSMS a segundas partes – Servicios Petroleros del Comahue', companies[0], lambda k: excel[k], '2026-05-07'),
                 ('AUD-2026-0011', 'CSMS a segundas partes – Transportes Cuenca Neuquina', companies[1], lambda k: profile_answer('muy_bueno', rn[k], 3), '2026-07-01'),
                 ('AUD-2026-0012', 'CSMS a segundas partes – Montajes Industriales del Sur', companies[2], lambda k: profile_answer('critico', rn[k], 5), '2026-08-05'),
                 ('AUD-2026-0013', 'Seguimiento CSMS – Servicios Petroleros del Comahue', companies[0], lambda k: profile_answer('regular', rn[k], 1), '2026-09-14')]
        self.hp_audits = []
        for code, title, comp, ans, date in specs:
            aid = str(uuid.uuid4()); secres = []
            for sid, stitle, ids in self.hp_sections:
                raw = sum(POINTS[ans(k)] for k, _ in ids); target = 3 * len(ids)
                secres.append({'section_id': sid, 'title': stitle, 'raw': raw, 'target': target, 'score': round(10 * raw / target, 4), 'items': len(ids), 'answered': len(ids), 'na': 0})
            final = sum(10 * s['raw'] / s['target'] for s in secres) / len(secres)
            self.put('hse_audits', {'id': aid, 'template_version_id': v['id'], 'company_id': comp, 'location_id': None, 'code': code, 'title': title, 'audit_type': 'csms',
                'status': 'completada', 'scheduled_date': date, 'lead_auditor_id': A, 'created_by': A, 'score': round(final, 2), 'max_score': 10, 'compliance_pct': round(final * 10, 2),
                'critical_failures': 0, 'result_band': band_of(round(final, 2)), 'summary': None, 'reviewed_by': None, 'reviewed_at': None, 'review_notes': None, 'closed_by': None,
                'completed_at': date + 'T15:00:00Z', 'section_results': secres})
            self.put('hse_audit_participants', {'id': str(uuid.uuid4()), 'audit_id': aid, 'user_id': A, 'participant_role': 'lider'})
            for k, iid in ((k, i) for _, _, ids in self.hp_sections for k, i in ids):
                self.put('hse_audit_responses', {'id': str(uuid.uuid5(uuid.UUID('6f1c0d5e-2b7a-4f0e-9a61-3c2d8e4b7a10'), f'{aid}:{iid}')), 'audit_id': aid, 'item_id': iid, 'answer': ans(k), 'comment': None, 'rating': None, 'numeric_value': None, 'text_value': None})
            self.hp_audits.append((aid, round(final, 2), band_of(round(final, 2))))
        # fotos de la primera auditoría: una del requisito 1 y otra de un hallazgo del requisito 2
        import io
        from PIL import Image
        a1 = self.hp_audits[0][0]
        resp = {r['item_id']: r for r in self.tables['hse_audit_responses'].values() if r['audit_id'] == a1}
        i1, i2 = self.hp_sections[0][2][0][1], self.hp_sections[0][2][1][1]
        fid = str(uuid.uuid4())
        self.put('hse_findings', {'id': fid, 'audit_id': a1, 'response_id': resp[i2]['id'], 'item_id': i2, 'company_id': companies[0], 'location_id': None, 'code': 'HAL-2026-0001',
            'title': 'Falta registro de capacitación', 'description': 'Sin constancias.', 'finding_type': 'nc_menor', 'severity': 'media', 'status': 'abierto', 'root_cause': None,
            'immediate_action': None, 'legal_reference': None, 'detected_at': '2026-05-07T12:00:00Z', 'due_date': '2026-06-07', 'closed_at': None, 'closed_by': None, 'requirement': None,
            'category': None, 'process_id': None, 'responsible_user_id': None, 'rca_method': None, 'rca_data': None, 'recurrence_key': None, 'recurrence_of': None, 'recurrence_count': 0,
            'verification_notes': None, 'effectiveness': None, 'verified_by': None, 'verified_at': None})
        for n, (color, cap, rid, f) in enumerate([((200, 40, 40), 'Extintor sin tarjeta', resp[i1]['id'], None), ((40, 90, 200), 'Planilla de capacitación vacía', None, fid)]):
            buf = io.BytesIO(); Image.new('RGB', (640, 480), color).save(buf, 'JPEG'); path = f'org/{a1}/foto{n}.jpg'
            self.files[path] = (buf.getvalue(), 'image/jpeg'); self.objects[path] = len(buf.getvalue())
            self.put('hse_evidences', {'id': str(uuid.uuid4()), 'audit_id': a1, 'response_id': rid, 'finding_id': f, 'action_id': None, 'storage_path': path, 'file_name': f'foto{n}.jpg',
                'mime_type': 'image/jpeg', 'size_bytes': len(buf.getvalue()), 'caption': cap, 'taken_at': f'2026-05-07T1{n}:00:00Z', 'latitude': None, 'longitude': None, 'uploaded_by': A})

fake = Fake()

def ctx_for(browser, device):
    ctx = browser.new_context(**{k: v for k, v in device.items() if k != 'default_browser_type'}, service_workers='allow', accept_downloads=True)
    ctx.add_init_script(f"if (!localStorage.getItem('{STORAGE_KEY}')) localStorage.setItem('{STORAGE_KEY}', {json.dumps(json.dumps(fake.session('A')))});")
    ctx.route(f'{SB}/**', fake.handle)
    return ctx

def bg(page, sel):
    return page.eval_on_selector(sel, 'e => getComputedStyle(e).backgroundColor')

def download(page, click):
    with page.expect_download(timeout=60000) as d: click()
    p = os.path.join(OUT, d.value.suggested_filename); d.value.save_as(p); return p

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    a1, f1, b1 = fake.hp_audits[0]
    check('0.1 Datos de prueba: auditoría con las respuestas de la planilla = 6,27 Bueno', f1 == 6.27 and b1 == 'Bueno', f'{f1} {b1}')
    desk = ctx_for(browser, {'viewport': {'width': 1366, 'height': 900}})
    P = desk.new_page()
    P.goto(f'{BASE}/auditorias/{a1}'); P.wait_for_selector('.sheet-table', timeout=60000)
    body = P.inner_text('body')
    check('1.1 Planilla de resultado: 6,27 Bueno, oficial', '6,27' in body and 'Bueno' in body and 'Resultado oficial' in body)
    rows = P.eval_on_selector_all('.sheet-table tbody tr', 'rs => rs.map(r => [...r.cells].map(c => c.innerText.trim()))')
    exp = [('16', '24', '6,67'), ('63', '90', '7,00'), ('65', '84', '7,74'), ('4', '12', '3,33'), ('5', '9', '5,56'), ('22', '30', '7,33')]
    check('1.2 Requisitos con puntaje alcanzado, objetivo y evaluación iguales a la planilla', [tuple(r[1:4]) for r in rows[:6]] == exp, json.dumps(rows[:6], ensure_ascii=False)[:300])
    check('1.3 Fila de resultado final 175 / 249 / 6,27', rows[6][:4] == ['Resultado final', '175', '249', '6,27'], json.dumps(rows[6], ensure_ascii=False))
    colors = P.eval_on_selector_all('.sheet-table tbody td.eval', 'cs => cs.map(c => getComputedStyle(c).backgroundColor)')
    want = ['rgb(146, 208, 80)', 'rgb(146, 208, 80)', 'rgb(146, 208, 80)', 'rgb(226, 107, 10)', 'rgb(255, 255, 0)', 'rgb(146, 208, 80)', 'rgb(146, 208, 80)']
    check('1.4 Colores de evaluación por sección como la planilla (verde, naranja, amarillo)', colors == want, json.dumps(colors))
    crit = P.inner_text('.criteria')
    check('1.5 Cuadro "Criterio de evaluación" con rangos y bandas', all(s in crit for s in ['8,01 - 10', 'Muy Bueno', '6,01 - 8', 'Bueno', '4,01 - 6', 'Regular', '0 - 4', 'Crítico']), crit.replace('\n', ' '))
    check('1.6 Recuadro del resultado con el color de la banda', bg(P, '.verdict') == 'rgb(146, 208, 80)', bg(P, '.verdict'))
    P.screenshot(path=f'{OUT}/1-planilla-escritorio.png', full_page=False)

    P.goto(f'{BASE}/'); P.wait_for_selector('text=Últimos resultados', timeout=60000); P.wait_for_timeout(800)
    chips = P.eval_on_selector_all('.sheet-table .band-chip', 'cs => cs.map(c => [c.innerText, getComputedStyle(c).backgroundColor])')
    labels = {c[0] for c in chips}
    check('2.1 Dashboard: últimos resultados con las cuatro bandas en color', {'Muy Bueno', 'Bueno', 'Regular', 'Crítico'} <= labels, json.dumps(chips, ensure_ascii=False)[:300])
    P.screenshot(path=f'{OUT}/2-dashboard.png', full_page=True)
    P.goto(f'{BASE}/auditorias'); P.wait_for_selector('text=AUD-2026-0012'); P.wait_for_timeout(500)
    P.screenshot(path=f'{OUT}/3-auditorias.png', full_page=False)

    # ---- comparación con la auditoría anterior (seguimiento de la misma empresa y plantilla)
    a4, f4, b4 = fake.hp_audits[3]
    P.goto(f'{BASE}/auditorias/{a4}'); P.wait_for_selector('.sheet-table', timeout=60000); P.wait_for_timeout(500)
    heads = P.eval_on_selector_all('.sheet-table thead th', 'hs => hs.map(h => h.innerText.trim())')
    tot = P.eval_on_selector_all('.sheet-table tr.total td', 'cs => cs.map(c => c.innerText.trim())')
    foot = P.inner_text('.sheet')
    check('6.1 Seguimiento: columnas Anterior y Variación con la auditoría previa de la misma empresa', 'Anterior' in heads and 'Variación' in heads and 'AUD-2026-0010' in foot, json.dumps(heads, ensure_ascii=False))
    check('6.2 Variación del resultado final (5,29 vs 6,27 → ▼ -0,98, en rojo)', tot[4] == '6,27' and '▼' in tot[5] and '-0,98' in tot[5] and P.eval_on_selector('.sheet-table tr.total .delta', 'e => getComputedStyle(e).color') == 'rgb(180, 35, 24)', json.dumps(tot, ensure_ascii=False))
    P.screenshot(path=f'{OUT}/7-comparacion.png', full_page=False)

    # ---- acta de reunión de cierre y firma en campo
    P.goto(f'{BASE}/auditorias/{a1}'); P.wait_for_selector('text=Reunión de cierre y firmas', timeout=60000)
    P.get_by_role('button', name='Expandir todo').click()
    P.wait_for_selector('.thumb .photo-num', timeout=30000)
    tags = P.eval_on_selector_all('.thumb .photo-num', 'xs => xs.map(x => x.innerText.trim())')
    check('3.8 Pantalla: la foto del requisito muestra su número ("Foto 1")', 'Foto 1' in tags, json.dumps(tags, ensure_ascii=False))
    P.locator('.thumb').first.scroll_into_view_if_needed(); P.screenshot(path=f'{OUT}/11-foto-numerada.png', full_page=False)
    P.get_by_label('Fecha de la reunión').fill('2026-05-07')
    P.get_by_label('Asistentes').fill('Juan Pérez (Contratista Patagonia SA, Jefe HSE); Auditor A')
    P.get_by_label('Acuerdos y compromisos').fill('Presentar el plan de acción en 15 días.')
    P.get_by_role('button', name='Guardar acta').click(); P.wait_for_timeout(400)
    for who, name in (('auditor', 'Auditor A'), ('contratista', 'Juan Pérez')):
        P.get_by_role('button', name='Agregar firma').click()
        if who == 'contratista':
            P.get_by_label('Nombre y apellido').fill(name)
            P.get_by_role('radio', name='Con observaciones').click(); P.get_by_label('Observaciones del firmante').fill('Pedimos 30 días para residuos.')
        pad = P.locator('canvas.sigpad'); bb = pad.bounding_box()
        P.mouse.move(bb['x'] + 30, bb['y'] + 120); P.mouse.down()
        for i in range(1, 12): P.mouse.move(bb['x'] + 30 + i * 25, bb['y'] + 120 - (40 if i % 2 else 0), steps=3)
        P.mouse.up()
        P.get_by_role('button', name='Guardar firma').click(); P.wait_for_timeout(500)
    figs = P.eval_on_selector_all('.sig figcaption strong', 'xs => xs.map(x => x.innerText)')
    check('7.1 Acta y dos firmas capturadas en el dispositivo (auditor y contratista)', figs == ['Auditor A', 'Juan Pérez'], json.dumps(figs, ensure_ascii=False))
    P.wait_for_timeout(2500)
    srv = [r for r in fake.tables['hse_audit_signatures'].values() if r.get('audit_id') == a1]
    check('7.2 Firmas sincronizadas como imagen PNG', len(srv) == 2 and all((r.get('signature_png') or '').startswith('data:image/png;base64,') for r in srv), f'{len(srv)} en el servidor')
    P.screenshot(path=f'{OUT}/8-firmas.png', full_page=False)

    P.goto(f'{BASE}/informes?audit={a1}'); P.wait_for_selector('text=Informe de una auditoría')
    P.wait_for_timeout(2500)
    pdf = download(P, lambda: P.get_by_role('button', name='Descargar PDF').first.click())
    txt = ' '.join(' '.join((pg.extract_text() or '').split()) for pg in PdfReader(pdf).pages)
    check('3.4 PDF: acta de reunión de cierre con firmas y conformidad', all(x in txt for x in ['Acta de reunión de cierre', 'Juan Pérez', 'Con observaciones', 'Presentar el plan de acción en 15 días']), '')
    check('3.0 PDF: carátula de RS Consultora, índice y sin historial de cambios', all(s in txt for s in ['RS CONSULTORA', 'Informe de auditoría', 'Índice', '1. Datos generales', 'Resumen ejecutivo', 'Página 3 de']) and 'Historial de cambios' not in txt, '')
    check('3.6 PDF: fotos numeradas, agrupadas por requisito y citadas en la lista de verificación', all(x in txt for x in ['Registro fotográfico', 'Foto 1 · Extintor sin tarjeta', 'Req. 1 ', '» Foto 1', 'Hallazgo HAL-2026-0001', 'Foto 2 (ver registro fotográfico)']), '')
    check('3.1 PDF: tabla de requisitos, resultado final y criterio de evaluación', all(s in txt for s in ['Requisitos del sistema de gestión', 'Puntaje alcanzado', 'RESULTADO FINAL 175 249 6,27', 'Criterio de evaluación', '8,01 - 10 Muy Bueno']), os.path.basename(pdf))
    xlsx = download(P, lambda: P.get_by_role('button', name='Descargar Excel').first.click())
    wbx = load_workbook(xlsx)
    ckr = [[c.value for c in row] for row in wbx['Checklist'].iter_rows(min_row=1)]
    check('3.7 Excel: columna "Fotos N.º" con los números de foto', ckr[0][6] == 'Fotos N.º' and any(r[6] == '1' for r in ckr[1:]), json.dumps([r[6] for r in ckr[1:4]], ensure_ascii=False))
    check('3.5 Excel: hoja "Acta y firmas"', 'Acta y firmas' in wbx.sheetnames and any(c.value == 'Juan Pérez' for c in wbx['Acta y firmas']['A']), ', '.join(wbx.sheetnames))
    ws = wbx['Secciones (oficial)']
    fills = [ws.cell(r, 4).fill.fgColor.rgb for r in range(2, 9)]
    check('3.2 Excel: evaluación coloreada por banda y fila de resultado final', fills == ['FF92D050', 'FF92D050', 'FF92D050', 'FFE26B0A', 'FFFFFF00', 'FF92D050', 'FF92D050'] and ws.cell(8, 1).value == 'Resultado final' and ws.cell(8, 1).fill.fgColor.rgb == 'FFD8E4BC', json.dumps(fills))
    check('3.3 Excel: encabezado con el color de la planilla', ws.cell(1, 1).fill.fgColor.rgb == 'FFFAC090', ws.cell(1, 1).fill.fgColor.rgb)
    # auditoría creada con las respuestas de la planilla importada
    P.goto(f'{BASE}/plantillas/{fake.hp_template}'); P.wait_for_selector('text=Crear auditoría con las respuestas de la planilla', timeout=60000)
    P.get_by_role('button', name='Crear auditoría con las respuestas de la planilla').click()
    P.get_by_label('Título').fill('CSMS a segundas partes – Contratista real')
    P.locator('.modal').get_by_role('button', name='Crear auditoría').click()
    P.wait_for_selector('.audit-bar', timeout=60000); P.wait_for_timeout(800)
    bar = P.locator('.audit-bar').inner_text().replace('\n', ' ')
    check('8.1 Auditoría creada con las 83 respuestas de la planilla y resultado parcial 6,27', '83/83' in bar and '6,27' in bar, bar)
    P.wait_for_timeout(3000)
    newa = [a for a in fake.tables['hse_audits'].values() if a.get('title') == 'CSMS a segundas partes – Contratista real']
    nresp = len([r for r in fake.tables['hse_audit_responses'].values() if newa and r.get('audit_id') == newa[0]['id']])
    check('8.2 Se sincroniza al servidor (auditoría en curso + 83 respuestas)', len(newa) == 1 and newa[0].get('status') == 'en_curso' and nresp == 83, f'{len(newa)} auditoría, {nresp} respuestas')
    # lo mismo desde Auditorías › Nueva auditoría (opción marcada por defecto)
    P.goto(f'{BASE}/auditorias'); P.wait_for_selector('text=Nueva auditoría', timeout=30000)
    P.get_by_role('button', name='Nueva auditoría').click()
    P.locator('.modal select').first.select_option(index=1)
    P.wait_for_selector('.sheet-opt', timeout=10000)
    P.get_by_label('Título').fill('CSMS desde Nueva auditoría')
    P.screenshot(path=f'{OUT}/9-nueva-con-planilla.png')
    P.locator('.modal').get_by_role('button', name='Crear', exact=True).click()
    P.wait_for_selector('.audit-bar', timeout=60000); P.wait_for_timeout(800)
    bar2 = P.locator('.audit-bar').inner_text().replace('\n', ' ')
    check('8.3 Nueva auditoría: opción "Cargar las respuestas de la planilla importada" (83/83, 6,27)', '83/83' in bar2 and '6,27' in bar2, bar2)
    desk.close()

    mob = ctx_for(browser, pw.devices['Pixel 7'])
    M = mob.new_page()
    M.goto(f'{BASE}/auditorias/{a1}'); M.wait_for_selector('.sheet-table', timeout=60000); M.wait_for_timeout(500)
    check('4.1 Celular: planilla sin desplazamiento horizontal de la página', M.evaluate('w => document.documentElement.scrollWidth <= w + 1', M.viewport_size['width']))
    M.screenshot(path=f'{OUT}/4-planilla-celular.png', full_page=False)
    M.goto(f'{BASE}/'); M.wait_for_selector('text=Últimos resultados', timeout=60000); M.wait_for_timeout(500)
    check('4.2 Celular: dashboard sin desplazamiento horizontal', M.evaluate('w => document.documentElement.scrollWidth <= w + 1', M.viewport_size['width']))
    M.screenshot(path=f'{OUT}/5-dashboard-celular.png', full_page=True)
    mob.close()

    out = browser.new_context(viewport={'width': 1200, 'height': 800})
    L = out.new_page(); L.goto(f'{BASE}/'); L.wait_for_selector('text=Iniciar sesión', timeout=30000); L.wait_for_timeout(500)
    check('5.1 Pantalla de ingreso con la tipografía nueva', L.evaluate("() => document.fonts.check('16px \"Archivo Variable\"')"))
    L.screenshot(path=f'{OUT}/6-ingreso.png')
    browser.close()

json.dump(results, open(f'{OUT}/resultados.json', 'w'), ensure_ascii=False, indent=2)
ok = sum(r['ok'] for r in results)
print(f'\n{ok}/{len(results)} pruebas OK')
sys.exit(0 if ok == len(results) else 1)
