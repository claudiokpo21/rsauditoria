"""
Plan de auditoría (aceptación del cliente antes de iniciar) e informe final con el formato
RS Consultora. Chromium escritorio y celular; el servidor Supabase se simula.

Uso: python3 tests/e2e/plan_informe_e2e.py http://localhost:4177 [carpeta_salida]
"""
import json, os, subprocess, sys, uuid
from playwright.sync_api import sync_playwright
from pypdf import PdfReader
from hp_fixture import Fake as HpFake
from fake_supabase import now_iso

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4177'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e-out-plan'
os.makedirs(OUT, exist_ok=True)
SB = 'https://hhwfhearafhmougtfssu.supabase.co'
STORAGE_KEY = 'sb-hhwfhearafhmougtfssu-auth-token'
results = []

def check(name, cond, detail=''):
    results.append({'prueba': name, 'ok': bool(cond), 'detalle': str(detail)[:300]})
    print(('OK   ' if cond else 'FALLA'), name, '-', str(detail)[:200], flush=True)

PNG_SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

class Fake(HpFake):
    def seed(self):
        super().seed()
        A = self.users['A']
        a1 = self.hp_audits[0][0]
        v = self.tables['hse_audits'][a1]['template_version_id']
        items = {sid: ids for sid, _, ids in self.hp_sections}
        base = {'company_id': self.company, 'location_id': None, 'status': 'abierto', 'root_cause': None, 'immediate_action': None, 'detected_at': '2026-05-07T12:00:00Z',
                'due_date': None, 'closed_at': None, 'closed_by': None, 'category': None, 'process_id': None, 'responsible_user_id': None, 'rca_method': None, 'rca_data': None,
                'recurrence_key': None, 'recurrence_of': None, 'recurrence_count': 0, 'verification_notes': None, 'effectiveness': None, 'verified_by': None, 'verified_at': None,
                'legal_reference': None, 'response_id': None, 'severity': 'media'}
        s0, s2 = self.hp_sections[0][2], self.hp_sections[2][2]
        self.put('hse_findings', {**base, 'id': str(uuid.uuid4()), 'audit_id': a1, 'item_id': s0[3][1], 'code': 'HAL-2026-0002', 'finding_type': 'oportunidad_mejora',
            'title': 'Dirección', 'description': 'Se identificó que no se pudo asegurar que los resultados analizados sean **difundidos al personal operativo**.',
            'rationale': 'Una mayor participación del personal fortalecerá la comprensión del proceso.', 'requirement': None})
        self.put('hse_findings', {**base, 'id': str(uuid.uuid4()), 'audit_id': a1, 'item_id': s2[1][1], 'code': 'HAL-2026-0003', 'finding_type': 'observacion',
            'title': 'Durante el recorrido del equipo se observó', 'description': 'Durante el recorrido del equipo se observó que algunas mochilas lavaojos se encontraban sucias.',
            'requirement': 'ISO 45001 8.2 Preparación y respuesta ante emergencias'})
        self.put('hse_audit_signatures', {'id': str(uuid.uuid4()), 'audit_id': a1, 'signer_role': 'auditor_lider', 'signer_name': 'Roberto Seguin', 'signer_position': 'Auditor líder',
            'signer_company': 'RS Consultora', 'agreement': 'conforme', 'observations': None, 'signature_png': PNG_SIG, 'signed_at': '2026-05-07T18:00:00Z', 'created_by': A})
        # auditoría planificada (sin plan)
        self.planned = str(uuid.uuid4())
        self.put('hse_audits', {'id': self.planned, 'template_version_id': v, 'company_id': self.company, 'location_id': None, 'code': 'AUD-2026-0020',
            'title': 'CSMS a segundas partes – TSB', 'audit_type': 'csms', 'status': 'planificada', 'scheduled_date': '2026-04-29', 'lead_auditor_id': A, 'created_by': A,
            'score': None, 'max_score': None, 'compliance_pct': None, 'critical_failures': 0, 'result_band': None, 'summary': None, 'reviewed_by': None, 'reviewed_at': None,
            'review_notes': None, 'closed_by': None, 'completed_at': None, 'section_results': None, 'audit_team': 'Roberto Seguin', 'scope': None, 'report_data': None})
        self.put('hse_audit_participants', {'id': str(uuid.uuid4()), 'audit_id': self.planned, 'user_id': A, 'participant_role': 'lider'})

fake = Fake()

def ctx_for(browser, device):
    ctx = browser.new_context(**{k: v for k, v in device.items() if k != 'default_browser_type'}, service_workers='allow', accept_downloads=True)
    ctx.add_init_script(f"if (!localStorage.getItem('{STORAGE_KEY}')) localStorage.setItem('{STORAGE_KEY}', {json.dumps(json.dumps(fake.session('A')))});")
    ctx.route(f'{SB}/**', fake.handle)
    return ctx

def download(page, click):
    page.on('console', lambda m: print('CONSOLE', m.type, m.text[:300]) if m.type in ('error', 'warning') else None)
    try:
        with page.expect_download(timeout=90000) as d: click()
    except Exception:
        print('TOAST', page.locator('.toast').all_inner_texts()); raise
    p = os.path.join(OUT, d.value.suggested_filename); d.value.save_as(p); return p

def pdf_text(p):
    return norm('\n'.join(pg.extract_text() or '' for pg in PdfReader(p).pages))

def wait_synced(page, ms=2500):
    page.wait_for_timeout(ms)

def wait_until(page, cond, ms=20000):
    for _ in range(ms // 250):
        if cond(): return True
        page.wait_for_timeout(250)
    return cond()

def seen(page, sel, ms=8000):
    try: page.wait_for_selector(sel, timeout=ms); return True
    except Exception: return False

def norm(t):
    import re as _re
    return _re.sub(r'\s+', ' ', t)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    desk = ctx_for(browser, {'viewport': {'width': 1366, 'height': 900}})
    P = desk.new_page()
    pid = fake.planned

    # ---------------------------------------------------------------- 1. auditoría planificada sin plan
    P.goto(f'{BASE}/auditorias/{pid}'); P.wait_for_selector('.plan-gate', timeout=60000); P.wait_for_timeout(500)
    check('1.1 Planificada sin plan: aviso «Primero, el plan de auditoría»', P.locator('.plan-gate').is_visible())
    check('1.2 Sin plan aceptado no aparece «Iniciar»', P.get_by_role('button', name='Iniciar', exact=True).count() == 0)
    opts = P.locator('.opt')
    check('1.3 La lista de verificación está bloqueada (ninguna opción habilitada)', P.locator('.opt:not([disabled])').count() == 0, opts.count())
    P.screenshot(path=f'{OUT}/1-auditoria-sin-plan.png')

    # ---------------------------------------------------------------- 2. armar el plan
    P.locator('.plan-gate').get_by_role('link', name='Ir al plan').click()
    P.wait_for_selector('text=Aceptación del cliente', timeout=30000)
    P.get_by_label('Compañía solicitante').fill('Pampa Energía E&P – Gerencia CSMS')
    P.get_by_label('Empresa contratista').fill('TSB')
    P.get_by_label('Contrato').fill('C5641 Ultima milla de arena')
    P.get_by_label('Fecha de realización').fill('29-04-2026 y 05-05-2026')
    P.get_by_label('Lugares a auditar').fill('Base Añelo (Incluye Operación) – Base Neuquén')
    rows = [('29-04-26', 'Definir', 'Traslado a Añelo', '', '', False),
            ('29-04-26', '09:00', 'Reunión inicio / coordinación', 'Lideres de Proceso presentes', 'Coordinación del día', False),
            ('', '09:15', 'Operación de campo. Operación y Logística', 'Jefe Operaciones', '**Planificación y Organización.** Verificación en Campo.', False),
            ('', '16:30', 'Retorno a Neuquén – Fin primer día', '', '', True),
            ('05-05-26', '08:30', 'Base Neuquén – reunión inicio', 'Lideres de Proceso presentes', 'Coordinación del día', False)]
    for i, (d, t, proc, aud, top, hl) in enumerate(rows):
        P.get_by_role('button', name='Agregar fila').click()
        r = P.locator('.plan-row').nth(i)
        r.get_by_label('Fecha').fill(d); r.get_by_label('Hora').fill(t); r.get_by_label('Proceso a auditar').fill(proc)
        if hl: r.get_by_label('Resaltar').check()
        else: r.get_by_label('Auditados disponibles').fill(aud); r.get_by_label('Temas').fill(top)
    check('2.1 Barra «Hay cambios sin guardar»', P.locator('.savebar').is_visible())
    P.locator('.savebar').get_by_role('button', name='Guardar').click(); wait_synced(P, 1200)
    check('2.2 Guardado: desaparece la barra', P.locator('.savebar').count() == 0)
    P.screenshot(path=f'{OUT}/2-plan-escritorio.png', full_page=True)
    plan_pdf = download(P, lambda: P.get_by_role('button', name='Descargar plan (PDF)').click())
    t = pdf_text(plan_pdf)
    check('2.3 PDF del plan: título «PLAN DE AUDITORIA DE SEGUNDA PARTE»', 'PLAN DE AUDITORIA DE SEGUNDA PARTE' in t)
    check('2.4 PDF del plan: datos generales', 'COMPAÑÍA SOLICITANTE Pampa Energía E&P – Gerencia CSMS' in t and 'CONTRATO C5641 Ultima milla de arena' in t, t[:400])
    check('2.5 PDF del plan: objetivo y criterios por defecto', 'OBJETIVO DE LA AUDITORÍA' in t and 'ISO 45001:2018 Gestión de SST' in t)
    check('2.6 PDF del plan: cronograma con filas y fila resaltada', 'Traslado a Añelo' in t and 'Retorno a Neuquén – Fin primer día' in t and 'Planificación y Organización.' in t)
    check('2.7 PDF del plan: sin secciones del informe final', 'CONCLUSIONES' not in t and 'DECLARACION' not in t)
    subprocess.run(['pdftoppm', '-png', '-r', '60', plan_pdf, f'{OUT}/plan-pag'], check=False)

    # ---------------------------------------------------------------- 3. enviar y registrar la aceptación
    P.get_by_role('button', name='Marcar como enviado').click(); wait_synced(P, 800)
    ok31 = seen(P, 'text=Plan: Enviado al cliente')
    P.screenshot(path=f'{OUT}/2b-plan-enviado.png')
    check('3.1 Estado «Enviado al cliente»', ok31)
    P.get_by_role('button', name='Registrar aceptación del cliente').click()
    P.get_by_label('Aceptado por').fill('Claudio Ciampa, Gerente HSE, Pampa Energía')
    P.get_by_label('Medio o comentario').fill('Correo del 27/04/2026')
    P.locator('.modal').get_by_role('button', name='Registrar aceptación').click(); wait_synced(P, 1500)
    check('3.2 Aceptación registrada', P.locator('text=Plan aceptado por').count() > 0 and P.locator('text=Plan: Aceptado por el cliente').count() > 0)
    wait_until(P, lambda: ((fake.tables['hse_audits'][pid].get('report_data') or {}).get('plan_approval') or {}).get('status') == 'aprobado')
    srv = fake.tables['hse_audits'][pid].get('report_data') or {}
    check('3.3 La aceptación llegó al servidor (report_data.plan_approval)', (srv.get('plan_approval') or {}).get('status') == 'aprobado' and len(srv.get('plan') or []) == 5,
          json.dumps(srv.get('plan_approval'), ensure_ascii=False))
    P.get_by_label('Lugares a auditar').fill('Base Añelo – Base Neuquén – Locación X')
    check('3.4 Cambio después de aceptado: aviso de que difiere', P.locator('text=El plan cambió después de que el cliente lo aceptó').count() > 0)
    P.get_by_label('Lugares a auditar').fill('Base Añelo (Incluye Operación) – Base Neuquén')
    check('3.5 Al volver al texto aceptado desaparece el aviso', P.locator('text=El plan cambió después de que el cliente lo aceptó').count() == 0)

    P.goto(f'{BASE}/auditorias/{pid}'); P.wait_for_selector('text=CSMS a segundas partes – TSB', timeout=30000); P.wait_for_timeout(600)
    check('3.6 Con el plan aceptado: sin aviso y aparece «Iniciar»', P.locator('.plan-gate').count() == 0 and P.get_by_role('button', name='Iniciar', exact=True).count() == 1)
    P.get_by_role('button', name='Iniciar', exact=True).click()
    wait_until(P, lambda: fake.tables['hse_audits'][pid]['status'] == 'en_curso')
    check('3.7 Iniciada: queda en curso', fake.tables['hse_audits'][pid]['status'] == 'en_curso', fake.tables['hse_audits'][pid]['status'])

    # ---------------------------------------------------------------- 4. informe final de la auditoría H&P
    a1 = fake.hp_audits[0][0]
    P.goto(f'{BASE}/auditorias/{a1}/informe'); P.wait_for_selector('text=Título y desarrollo', timeout=60000)
    P.get_by_label('Desarrollo de la auditoría').fill('Durante los días **28 y 29 de mayo de 2026**, y a solicitud de la empresa **Pampa Energía**, se llevó a cabo la auditoría de segunda parte.\n\nEl alcance comprendió:\n- Liderazgo, compromiso y enfoque al Cliente.\n- Gestión de Seguridad y Salud Ocupacional.')
    P.get_by_label('Conclusión general').fill('Como conclusión general, la empresa mantiene un Sistema de Gestión propio. Los hallazgos han sido categorizados como **Fortalezas**, **Oportunidades de Mejora**, **Observaciones** y **No Conformidades**.')
    P.locator('.field', has_text='✓').first.locator('textarea').fill('Políticas de CSMS, Políticas de Alcohol y Drogas.\n- **CSMS:** Cantidad de asistentes de HSE en campo.')
    P.get_by_role('button', name='Agregar fortaleza').click()
    P.get_by_label('Área').fill('Operaciones')
    P.get_by_label('Fortaleza', exact=True).fill('El buen conocimiento técnico en la función de algunos integrantes del equipo de perforación.')
    P.locator('.savebar').get_by_role('button', name='Guardar').click(); wait_synced(P, 1200)
    P.screenshot(path=f'{OUT}/3-informe-escritorio.png', full_page=True)
    fin = download(P, lambda: P.get_by_role('button', name='Descargar informe final (PDF)').click())
    t = pdf_text(fin)
    order = ['01 DATOS GENERALES', 'OBJETIVO DE LA AUDITORÍA', 'CRITERIOS DE AUDITORÍA', 'PLAN DE AUDITORÍA', 'DESARROLLO DE LA AUDITORÍA',
             'CONCLUSIONES DE LA AUDITORÍA', 'FORTALEZAS', 'OPORTUNIDADES DE MEJORA', 'REGISTRO DE OBSERVACIONES', 'REGISTRO DE NO CONFORMIDADES',
             'EVALUACIÓN DEL CONTRATISTA POR LA CONSULTORA', 'ANEXO', 'REGISTRO FOTOGRÁFICO', 'DECLARACIÓN DEL AUDITOR']
    pos = [t.find(s) for s in order]
    check('4.1 Informe final: secciones del modelo en orden', all(p >= 0 for p in pos) and pos == sorted(pos), list(zip(order, pos)))
    check('4.2 Portada y encabezado «INFORME FINAL AUDITORIA DE SEGUNDA PARTE» en cada página',
          all('INFORME FINAL AUDITORIA DE SEGUNDA PARTE' in (pg.extract_text() or '') for pg in PdfReader(fin).pages[1:]) and 'Informe final' in (PdfReader(fin).pages[0].extract_text() or ''), len(PdfReader(fin).pages))
    check('4.3 Fortaleza numerada con su área', 'OPERACIONES: El buen conocimiento técnico' in t)
    check('4.4 Oportunidad de mejora con su fundamento', 'Dirección: Se identificó' in t and 'Una mayor participación del personal' in t)
    check('4.5 Observación con referencia / requisito', 'ISO 45001 8.2 Preparación y respuesta' in t and 'mochilas lavaojos' in t)
    check('4.6 No conformidad registrada', 'Falta registro de capacitación' in t)
    check('4.7 Hallazgos agrupados por requisito (fila gris con el requisito)', t.count('LIDERAZGO, COMPROMISO') >= 2 and 'REFERENCIA / REQUISITO' in t)
    check('4.8 Evaluación: resultado 6,27 con criterio de evaluación', 'RESULTADO FINAL AUDITORÍA A PROVEEDOR' in t and '6,27' in t and 'CRITERIO DE EVALUACIÓN' in t)
    check('4.9 Conformidades por requisito', 'Políticas de CSMS, Políticas de Alcohol y Drogas.' in t and 'CSMS: Cantidad de asistentes' in t)
    check('4.10 Registro fotográfico por hallazgo («No Conformidad N° 1»)', 'No Conformidad N° 1' in t)
    check('4.11 Declaración y firma del auditor', 'no constituyen una garantía absoluta' in t and 'Roberto Seguin' in t)
    check('4.12 Negritas sin asteriscos en el PDF', '**' not in t)
    check('4.13 Usa el plan cargado en la auditoría (sin plan: «Cronograma a definir.»)', 'Cronograma a definir.' in t)
    subprocess.run(['pdftoppm', '-png', '-r', '60', fin, f'{OUT}/informe-pag'], check=False)

    # ---------------------------------------------------------------- 5. fundamento en el formulario de hallazgo
    P.goto(f'{BASE}/hallazgos'); P.wait_for_timeout(800)
    desk.close()

    # ---------------------------------------------------------------- 6. celular
    mob = ctx_for(browser, pw.devices['Pixel 7'])
    M = mob.new_page()
    M.goto(f'{BASE}/auditorias/{pid}/plan'); M.wait_for_selector('text=Cronograma', timeout=60000); M.wait_for_timeout(800)
    check('6.1 Celular: plan sin desplazamiento horizontal', M.evaluate('w => document.documentElement.scrollWidth <= w + 1', M.viewport_size['width']))
    M.screenshot(path=f'{OUT}/4-plan-celular.png', full_page=True)
    M.goto(f'{BASE}/auditorias/{a1}/informe'); M.wait_for_selector('text=Fortalecimiento', timeout=60000); M.wait_for_timeout(800)
    check('6.2 Celular: informe sin desplazamiento horizontal', M.evaluate('w => document.documentElement.scrollWidth <= w + 1', M.viewport_size['width']))
    M.screenshot(path=f'{OUT}/5-informe-celular.png', full_page=True)
    mob.close()
    browser.close()

json.dump(results, open(f'{OUT}/resultados.json', 'w'), ensure_ascii=False, indent=2)
ok = sum(r['ok'] for r in results)
print(f'\n{ok}/{len(results)} pruebas OK')
sys.exit(0 if ok == len(results) else 1)
