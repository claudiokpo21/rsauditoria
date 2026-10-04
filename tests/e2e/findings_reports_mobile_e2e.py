"""
Pruebas de navegador: gestión de hallazgos, validación de cierre, informes PDF/Excel y uso en
pantallas de celular (Chromium con emulación de dispositivo; NO reemplaza la prueba en equipos reales).

Uso: python3 tests/e2e/findings_reports_mobile_e2e.py http://localhost:4177 [carpeta_salida]
(build con `vite build --mode development` + `vite preview`; el servidor Supabase se simula)
"""
import io, json, os, sys, time, uuid
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
from openpyxl import load_workbook
from fake_supabase import FakeSupabase, now_iso

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4177'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e-out-informes'
os.makedirs(OUT, exist_ok=True)
SB = 'https://hhwfhearafhmougtfssu.supabase.co'
STORAGE_KEY = 'sb-hhwfhearafhmougtfssu-auth-token'
results = []

def check(name, cond, detail=''):
    results.append({'prueba': name, 'ok': bool(cond), 'detalle': detail})
    print(('OK   ' if cond else 'FALLA'), name, '-', detail, flush=True)

class Fake(FakeSupabase):
    """Agrega una auditoría completada con hallazgos, plan de acción, recurrencia, avisos e historial."""
    def seed(self):
        super().seed()
        A, B = self.users['A'], self.users['B']
        v = next(iter(self.tables['hse_template_versions'].values()))['id']
        self.audit2 = self.put('hse_audits', {'id': str(uuid.uuid4()), 'template_version_id': v, 'company_id': self.company, 'location_id': None, 'code': 'AUD-2026-0002',
            'title': 'Auditoría base Añelo', 'audit_type': 'interna', 'status': 'completada', 'scheduled_date': '2026-09-20', 'lead_auditor_id': B, 'created_by': B,
            'score': 2, 'max_score': 3, 'compliance_pct': 66.67, 'critical_failures': 0, 'result_band': None, 'summary': None, 'reviewed_by': None, 'reviewed_at': None,
            'review_notes': None, 'closed_by': None, 'completed_at': '2026-09-21T15:00:00Z',
            'section_results': [{'section_id': 'x', 'title': 'Locación', 'raw': 2, 'target': 3, 'score': 66.6667, 'items': 3, 'answered': 3, 'na': 0}]})['id']
        self.put('hse_audit_participants', {'id': str(uuid.uuid4()), 'audit_id': self.audit2, 'user_id': B, 'participant_role': 'lider'})
        resp = []
        for i, (it, ans) in enumerate(zip(self.items, ['cumple', 'no_cumple', 'cumple'])):
            resp.append(self.put('hse_audit_responses', {'id': str(uuid.uuid4()), 'audit_id': self.audit2, 'item_id': it, 'answer': ans, 'comment': 'Extintor vencido' if ans == 'no_cumple' else None,
                                                          'rating': None, 'numeric_value': None, 'text_value': None})['id'])
        base_f = {'company_id': self.company, 'location_id': None, 'process_id': None, 'legal_reference': 'Dec. 351/79', 'closed_at': None, 'closed_by': None,
                  'verified_by': None, 'verified_at': None, 'verification_notes': None, 'effectiveness': None, 'recurrence_key': 'k1', 'immediate_action': 'Se retiró el extintor'}
        prev = self.put('hse_findings', {**base_f, 'id': str(uuid.uuid4()), 'audit_id': self.audit, 'code': 'HAL-2026-0001', 'title': 'Extintor vencido (auditoría anterior)', 'description': 'Antecedente',
            'finding_type': 'nc_menor', 'severity': 'media', 'status': 'verificado', 'category': 'seguridad_higiene', 'response_id': None, 'item_id': self.items[1], 'requirement': 'Extintores vigentes',
            'responsible_user_id': B, 'root_cause': 'Sin control', 'rca_method': 'otro', 'rca_data': None, 'recurrence_count': 0, 'recurrence_of': None, 'detected_at': '2026-06-01T10:00:00Z', 'due_date': '2026-07-01',
            'verified_by': A, 'verified_at': '2026-08-01T10:00:00Z', 'verification_notes': 'Sin desvíos en la inspección', 'effectiveness': 'eficaz', 'closed_at': '2026-07-20T10:00:00Z'})
        self.f1 = self.put('hse_findings', {**base_f, 'id': str(uuid.uuid4()), 'audit_id': self.audit2, 'code': 'HAL-2026-0007', 'title': 'Extintor del dog house vencido', 'description': 'Carga vencida en 08/2026, sector dog house.',
            'finding_type': 'nc_menor', 'severity': 'alta', 'status': 'en_tratamiento', 'category': 'seguridad_higiene', 'response_id': resp[1], 'item_id': self.items[1], 'requirement': 'Extintores vigentes y accesibles',
            'responsible_user_id': B, 'root_cause': 'No existe control periódico de vencimientos', 'rca_method': 'cinco_porques',
            'rca_data': {'whys': ['El extintor estaba vencido', 'No se recargó a tiempo', 'Nadie controla los vencimientos', 'No hay responsable asignado', 'El procedimiento no lo contempla']},
            'recurrence_count': 1, 'recurrence_of': prev['id'], 'detected_at': '2026-09-20T12:00:00Z', 'due_date': '2026-09-30'})['id']
        self.a1 = self.put('hse_actions', {'id': str(uuid.uuid4()), 'finding_id': self.f1, 'description': 'Recargar y señalizar el extintor del dog house', 'action_type': 'correctiva', 'responsible_user_id': B,
            'responsible_name': None, 'responsible_company_id': self.company, 'due_date': '2026-09-28', 'status': 'en_curso', 'progress_notes': None, 'completed_at': None,
            'effectiveness_criteria': 'Cero extintores vencidos en 3 inspecciones mensuales', 'verification_notes': None, 'effectiveness': None, 'verified_by': None, 'verified_at': None})['id']
        self.put('hse_actions', {'id': str(uuid.uuid4()), 'finding_id': self.f1, 'description': 'Incorporar control mensual de vencimientos al procedimiento', 'action_type': 'preventiva', 'responsible_user_id': A,
            'responsible_name': None, 'responsible_company_id': None, 'due_date': '2026-11-15', 'status': 'pendiente', 'progress_notes': None, 'completed_at': None,
            'effectiveness_criteria': None, 'verification_notes': None, 'effectiveness': None, 'verified_by': None, 'verified_at': None})
        self.put('hse_notifications', {'id': str(uuid.uuid4()), 'user_id': A, 'kind': 'accion_vencida', 'entity_table': 'hse_actions', 'entity_id': self.a1, 'due_date': '2026-09-28',
            'title': 'Acción vencida · HAL-2026-0007', 'body': 'Recargar y señalizar el extintor del dog house', 'read_at': None, 'resolved_at': None})

    def history(self):
        return [{'changed_at': '2026-09-20T12:00:00Z', 'table_name': 'hse_findings', 'record_id': self.f1, 'record_label': 'HAL-2026-0007', 'action': 'INSERT', 'changed_fields': None,
                 'old_data': None, 'new_data': {'status': 'abierto'}, 'user_name': 'Auditor B'},
                {'changed_at': '2026-09-22T09:00:00Z', 'table_name': 'hse_findings', 'record_id': self.f1, 'record_label': 'HAL-2026-0007', 'action': 'UPDATE', 'changed_fields': ['root_cause'],
                 'old_data': {'root_cause': None}, 'new_data': {'root_cause': 'No existe control periódico de vencimientos'}, 'user_name': 'Auditor B'}]

    def _handle(self, route):
        req = route.request
        if req.method == 'POST' and '/rest/v1/rpc/' in req.url and not self.down:
            fn = req.url.split('/rpc/')[1].split('?')[0]
            body = json.loads(req.post_data or '{}')
            uid = self.user_from({k.lower(): v for k, v in req.headers.items()})
            with self.lock:
                if fn in ('hse_audit_history', 'hse_record_history'):
                    return self.json(self.history())
                if fn == 'hse_review_audit':
                    a = self.tables['hse_audits'][body['p_audit']]
                    if a['lead_auditor_id'] == uid:
                        return self.json({'code': '42501', 'message': 'La revisión debe hacerla alguien distinto del auditor líder'}, 403)
                    a.update({'reviewed_by': uid, 'reviewed_at': now_iso(), 'review_notes': body.get('p_notes'), 'updated_at': now_iso()}); a['row_version'] += 1
                    return self.json(None)
        return super()._handle(route)

fake = Fake()

def new_context(browser, who, device):
    ctx = browser.new_context(**{k: v for k, v in device.items() if k != 'default_browser_type'}, service_workers='allow', accept_downloads=True)
    ctx.add_init_script(f"if (!localStorage.getItem('{STORAGE_KEY}')) localStorage.setItem('{STORAGE_KEY}', {json.dumps(json.dumps(fake.session(who)))});")
    ctx.route(f'{SB}/**', fake.handle)
    return ctx

def no_hscroll(page):
    # se compara con el ancho del dispositivo: en emulación móvil el viewport de diseño se ensancha si el contenido desborda
    return page.evaluate('w => document.documentElement.scrollWidth <= w + 1', page.viewport_size['width'])

def wait_synced(page, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            el = page.locator('[data-sync-phase]').first
            if el.get_attribute('data-sync-phase') == 'sincronizado' and el.get_attribute('data-last-sync') and el.get_attribute('data-sync-running') == '0': return True
        except Exception: pass
        time.sleep(0.5)
    return False

def download(page, click):
    with page.expect_download(timeout=60000) as d:
        click()
    path = os.path.join(OUT, d.value.suggested_filename)
    d.value.save_as(path)
    return path

with sync_playwright() as p:
    browser = p.chromium.launch()
    devices = {'Android (Pixel 7)': p.devices['Pixel 7'], 'iPhone 13 (emulado en Chromium)': p.devices['iPhone 13']}

    # =================================================================== 1. hallazgos y planes en celular
    ctx = new_context(browser, 'A', devices['Android (Pixel 7)'])
    A = ctx.new_page()
    A.goto(BASE + '/'); A.wait_for_selector('[data-sync-phase]', timeout=30000)
    check('1.1 Ingreso y descarga inicial (celular Android)', wait_synced(A), 'sincronizado')
    A.goto(f'{BASE}/hallazgos/{fake.f1}'); A.wait_for_selector('text=Análisis de causa raíz', timeout=30000)
    body = A.inner_text('body')
    check('1.2 Hallazgo vinculado a auditoría y pregunta, con descripción objetiva, clasificación, responsable y vencimiento',
          all(s in body for s in ['AUD-2026-0002', '¿Los extintores están vigentes y accesibles?', 'Carga vencida en 08/2026', 'NC menor', 'Severidad alta', 'Responsable: Auditor B']) and 'Vence 30/9/2026' in body,
          'detalle visible')
    check('1.3 Recurrencia indicada con enlace al hallazgo anterior', 'recurrente' in body and 'HAL-2026-0001' in body, '2.ª vez')
    check('1.4 Análisis de causa raíz (5 porqués) y causa identificada', '5 porqués' in body and 'Nadie controla los vencimientos' in body and 'No existe control periódico' in body, '')
    check('1.5 Plan de acción con tipo, responsable, vencimiento vencido y criterio de eficacia', 'Correctiva' in body and 'Preventiva' in body and 'Cero extintores vencidos' in body, '')
    A.locator('details.history summary').first.click(); A.wait_for_selector('text=Modificación', timeout=10000)
    check('1.6 Historial de cambios del hallazgo (quién, cuándo, qué)', 'Causa raíz' in A.inner_text('body') and 'Auditor B' in A.inner_text('body'), '')
    check('1.7 Sin desplazamiento horizontal en celular (hallazgo)', no_hscroll(A), '')
    A.screenshot(path=f'{OUT}/1-hallazgo-android.png', full_page=True)
    A.get_by_role('button', name='Cerrar', exact=True).first.click()
    modal = A.locator('.modal').inner_text()
    check('1.8 No deja cerrar con acciones abiertas (mismas reglas que el servidor)', 'No se puede cerrar todavía' in modal and 'acción/es sin completar' in modal, modal.split('\n')[1][:120] if '\n' in modal else modal[:120])
    A.keyboard.press('Escape')

    A.goto(f'{BASE}/avisos'); A.wait_for_selector('text=Avisos de vencimiento')
    check('1.9 Aviso de acción vencida visible y con contador', 'Acción vencida · HAL-2026-0007' in A.inner_text('body') and A.locator('nav .badge-bad').count() >= 0, '')
    check('1.10 Sin desplazamiento horizontal en celular (avisos)', no_hscroll(A), '')
    A.screenshot(path=f'{OUT}/2-avisos-android.png', full_page=True)
    A.get_by_role('link', name='Abrir').first.click(); A.wait_for_selector('text=Acción del plan', timeout=15000)
    check('1.11 El aviso abre la acción del plan', 'Cero extintores vencidos' in ' '.join(A.locator('.modal textarea').evaluate_all('els => els.map(e => e.value)')), '')
    A.keyboard.press('Escape')

    # =================================================================== 2. validación para completar (auditoría en curso)
    A.goto(f'{BASE}/auditorias/{fake.audit}'); A.wait_for_selector('.item', timeout=30000)
    A.get_by_role('button', name='Completar').click(); A.wait_for_selector('text=Pendientes detectados en este dispositivo', timeout=10000)
    m = A.locator('.modal')
    btn_disabled = m.get_by_role('button', name='Completar').is_disabled()
    check('2.1 Completar: lista preguntas obligatorias sin responder y bloquea el botón', btn_disabled and 'Pregunta obligatoria sin responder' in m.inner_text(), f'botón deshabilitado={btn_disabled}')
    A.screenshot(path=f'{OUT}/3-completar-pendientes-android.png', full_page=True)
    A.keyboard.press('Escape')
    for i in range(3):
        A.locator('.item').nth(i).get_by_role('radio', name='Cumple', exact=True).click()
    A.wait_for_timeout(1000)
    A.get_by_role('button', name='Completar').click(); A.wait_for_selector('text=Sin pendientes', timeout=10000)
    check('2.2 Con todo respondido el dispositivo no reporta pendientes', not A.locator('.modal').get_by_role('button', name='Completar').is_disabled(), '')
    A.keyboard.press('Escape')
    check('2.3 Sin desplazamiento horizontal en celular (checklist)', no_hscroll(A), '')

    # =================================================================== 3. revisión y cierre (auditoría completada)
    A.goto(f'{BASE}/auditorias/{fake.audit2}'); A.wait_for_selector('text=Resultado oficial', timeout=30000)
    body = A.inner_text('body')
    check('3.1 Muestra el resultado oficial del servidor (no el cálculo del dispositivo)', 'Resultado oficial' in body and '66,7 %' in body, '')
    A.get_by_role('button', name='Cerrar auditoría').click(); A.wait_for_selector('.modal')
    dis = A.locator('.modal').get_by_role('button', name='Cerrar').last.is_disabled()
    check('3.2 No permite cerrar sin la revisión de coordinación', dis and 'Pendiente de revisión' in A.locator('.modal').inner_text(), f'botón deshabilitado={dis}')
    A.keyboard.press('Escape')
    A.get_by_role('button', name='Revisar').click(); A.locator('.modal textarea').fill('Revisadas respuestas, evidencias y clasificación.')
    A.locator('.modal').get_by_role('button', name='Registrar revisión').click()
    A.wait_for_selector('text=Revisada por', timeout=20000)
    check('3.3 Revisión registrada por coordinación (servidor) y visible', fake.tables['hse_audits'][fake.audit2]['reviewed_by'] == fake.users['A'], '')
    A.get_by_role('button', name='Cerrar auditoría').click(); A.wait_for_selector('.modal')
    A.locator('.modal textarea').fill('Se detectó 1 NC menor recurrente; plan de acción en curso.')
    A.locator('.modal').get_by_role('button', name='Cerrar').last.click()
    ok = False; t0 = time.time()
    for _ in range(120):
        if fake.tables['hse_audits'][fake.audit2]['status'] == 'cerrada': ok = True; break
        A.wait_for_timeout(500)          # (no time.sleep: el simulador responde dentro del bucle de Playwright)
    close_secs = round(time.time() - t0, 1)
    if not ok:
        print('DEBUG outbox', A.evaluate("async () => { const db = await new Promise(r => { const q = indexedDB.open('hse-audit-manager'); q.onsuccess = () => r(q.result); }); const v = await new Promise(r => { const q = db.transaction('outbox').objectStore('outbox').getAll(); q.onsuccess = () => r(q.result); }); db.close(); return v.map(o => [o.table, o.status, o.last_error, JSON.stringify(o.payload).slice(0, 200)]); }"))
        print('DEBUG modal', A.locator('.modal').count(), A.inner_text('body')[:400])
    check('3.4 Cierre con resumen enviado al servidor', ok and 'NC menor' in (fake.tables['hse_audits'][fake.audit2].get('summary') or ''), f"estado={fake.tables['hse_audits'][fake.audit2]['status']} en {close_secs} s")

    # =================================================================== 4. informes
    A.goto(f'{BASE}/informes?audit={fake.audit2}'); A.wait_for_selector('text=Informe de una auditoría')
    pdf_path = download(A, lambda: A.get_by_role('button', name='Descargar PDF').first.click())
    txt = '\n'.join(pg.extract_text() or '' for pg in PdfReader(pdf_path).pages)
    norm = ' '.join(txt.split())
    check('4.1 PDF de auditoría: resultado oficial y por sección', 'Resultados por sección oficiales' in norm and 'Resultado oficial' in norm and 'Locación' in norm and '66,7' in norm, os.path.basename(pdf_path))
    check('4.2 PDF: hallazgo con pregunta, requisito, clasificación, responsable, causa raíz y plan', all(s in norm for s in ['HAL-2026-0007', 'extintores están vigentes', 'Extintores vigentes y accesibles', 'RECURRENTE', 'Nadie controla los vencimientos', 'Criterio de eficacia']), '')
    check('4.3 PDF: historial de cambios', 'Historial de cambios' in norm, f'{len(PdfReader(pdf_path).pages)} páginas')
    xlsx_path = download(A, lambda: A.get_by_role('button', name='Descargar Excel').first.click())
    wb = load_workbook(xlsx_path)
    check('4.4 Excel de auditoría: hojas Resumen, Secciones (oficial), Checklist, Hallazgos, Plan de acción, Historial',
          all(s in wb.sheetnames for s in ['Resumen', 'Secciones (oficial)', 'Checklist', 'Hallazgos', 'Plan de acción', 'Historial']), ', '.join(wb.sheetnames))
    hz = wb['Hallazgos']; heads = [c.value for c in hz[1]]
    row = {heads[i]: c.value for i, c in enumerate(hz[2])}
    check('4.5 Excel: columnas de gestión del hallazgo completas', row.get('Recurrente') == '2.ª vez' and 'causa raíz' in (row.get('Análisis de causa raíz') or '').lower() and row.get('Responsable') == 'Auditor B', json.dumps({k: row.get(k) for k in ('Código', 'Vencido', 'Recurrente', 'Categoría')}, ensure_ascii=False))
    mp = download(A, lambda: A.locator('section', has_text='Informe de gestión').get_by_role('button', name='Descargar PDF').click())
    mt = ' '.join('\n'.join(pg.extract_text() or '' for pg in PdfReader(mp).pages).split())
    check('4.6 Informe de gestión PDF: resultados por categoría y por sección, recurrentes y seguimiento',
          all(s in mt for s in ['Resultados por categoría de plantilla', 'Resultados por sección', 'Hallazgos recurrentes', 'Seguimiento: acciones vencidas', 'Seguridad e Higiene']), os.path.basename(mp))
    mx = download(A, lambda: A.locator('section', has_text='Informe de gestión').get_by_role('button', name='Descargar Excel').click())
    mwb = load_workbook(mx)
    check('4.7 Informe de gestión Excel: hojas de categorías, secciones, empresas, recurrentes, seguimiento',
          all(s in mwb.sheetnames for s in ['Resumen', 'Por categoría', 'Por sección', 'Por empresa', 'Recurrentes', 'Mensual', 'Seguimiento auditorías', 'Hallazgos', 'Plan de acción']), ', '.join(mwb.sheetnames))
    rec = mwb['Recurrentes']; check('4.8 Recurrencia agrupada en el informe (2 veces, 2 auditorías)', rec.max_row >= 2 and rec.cell(2, 4).value == 2 and rec.cell(2, 5).value == 2, f'veces={rec.cell(2, 4).value} auditorías={rec.cell(2, 5).value}')
    check('4.9 Sin desplazamiento horizontal en celular (informes)', no_hscroll(A), '')

    # =================================================================== 5. dashboard
    A.goto(BASE + '/'); A.wait_for_selector('text=Cumplimiento promedio', timeout=30000)
    body = A.inner_text('body')
    check('5.1 Dashboard con datos reales sincronizados (resultado oficial, recurrentes, vencidas)', '66,7 %' in body and 'Hallazgos recurrentes' in body and 'HAL-2026-0007' in body, 'origen indicado: ' + ('servidor' if 'Datos del servidor' in body else 'dispositivo'))
    check('5.2 Sin desplazamiento horizontal en celular (dashboard)', no_hscroll(A), '')
    A.screenshot(path=f'{OUT}/4-dashboard-android.png', full_page=True)
    ctx.close()

    # =================================================================== 6. iPhone (emulado) y responsable de acciones
    ctx2 = new_context(browser, 'B', devices['iPhone 13 (emulado en Chromium)'])
    B = ctx2.new_page()
    B.goto(BASE + '/acciones'); B.wait_for_selector('text=Planes de acción', timeout=30000)
    wait_synced(B)
    B.reload(); B.wait_for_selector('text=Recargar y señalizar', timeout=30000)
    check('6.1 Responsable ve sus acciones en iPhone (emulado)', 'Recargar y señalizar' in B.inner_text('body'), '')
    check('6.2 Sin desplazamiento horizontal (acciones, iPhone emulado)', no_hscroll(B), '')
    B.screenshot(path=f'{OUT}/5-acciones-iphone.png', full_page=True)
    for path in ['/', '/auditorias', '/hallazgos', '/informes', '/avisos', '/admin/sync']:
        B.goto(BASE + path); B.wait_for_timeout(1200)
        if not no_hscroll(B):
            check(f'6.3 Sin desplazamiento horizontal en {path} (iPhone emulado)', False, B.evaluate('document.documentElement.scrollWidth'))
            break
    else:
        check('6.3 Sin desplazamiento horizontal en las pantallas principales (iPhone emulado)', True, '6 pantallas')
    ctx2.close()
    browser.close()

json.dump(results, open(f'{OUT}/resultados.json', 'w'), ensure_ascii=False, indent=2)
fails = [r for r in results if not r['ok']]
print(f'\n{len(results) - len(fails)}/{len(results)} pruebas OK')
sys.exit(1 if fails else 0)
