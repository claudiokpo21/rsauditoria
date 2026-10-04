"""
Panel de usuarios y permisos + pantallas rediseñadas (Chromium real contra el servidor simulado).

Uso: python3 tests/e2e/admin_redesign_e2e.py http://localhost:4177 [carpeta_salida]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright
from fake_supabase import FakeSupabase

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4177'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e-out'
os.makedirs(OUT, exist_ok=True)
SB = 'https://hhwfhearafhmougtfssu.supabase.co'
STORAGE_KEY = 'sb-hhwfhearafhmougtfssu-auth-token'
fake = FakeSupabase()
results = []

def check(name, cond, detail=''):
    results.append({'prueba': name, 'ok': bool(cond), 'detalle': detail})
    print(('OK   ' if cond else 'FALLA'), name, '-', detail, flush=True)

def ctx_for(browser, who, viewport, mobile=False, session=True):
    ctx = browser.new_context(viewport=viewport, service_workers='allow', is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
    if session:
        ctx.add_init_script(f"if (!localStorage.getItem('{STORAGE_KEY}')) localStorage.setItem('{STORAGE_KEY}', {json.dumps(json.dumps(fake.session(who)))});")
    ctx.route(f'{SB}/**', fake.handle)
    return ctx

def wait_until(page, fn, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if fn(): return True
        except Exception: pass
        page.wait_for_timeout(300)
    return False

def no_hscroll(p):
    return p.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1')

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    A = ctx_for(browser, 'A', {'width': 1366, 'height': 900}).new_page()
    A.goto(f'{BASE}/admin/miembros'); A.wait_for_selector('text=Usuarios y permisos', timeout=60000)
    A.wait_for_selector('.users-t tbody tr', timeout=30000)
    rows = A.eval_on_selector_all('.users-t tbody tr', 'rs => rs.map(r => r.innerText.replace(/\\s+/g, " "))')
    check('1.1 Panel: lista de usuarios con correo, rol y último ingreso', len(rows) == 2 and any('a@test.local' in r and 'Hoy' in r for r in rows) and any('Nunca ingresó' in r for r in rows), json.dumps(rows, ensure_ascii=False)[:300])
    stats = A.eval_on_selector_all('.mini-stat', 'xs => xs.map(x => x.innerText.replace(/\\s+/g, " "))')
    check('1.2 Indicadores: activos, invitaciones, nunca ingresaron', 'Usuarios activos 2' in stats[0] and 'Nunca ingresaron 1' in stats[2], json.dumps(stats, ensure_ascii=False))
    A.fill('input[aria-label="Buscar usuarios"]', 'b@test')
    check('1.3 Búsqueda por correo', A.locator('.users-t tbody tr').count() == 1, '')
    A.fill('input[aria-label="Buscar usuarios"]', '')
    A.screenshot(path=f'{OUT}/13-panel-usuarios.png')

    # invitar dos usuarios
    A.get_by_role('button', name='Invitar usuarios').click()
    A.locator('.modal textarea').fill('ana.perez@contratista.com, juan.gomez@contratista.com')
    A.locator('.role-card', has_text='Coordinador HSE').click()
    A.screenshot(path=f'{OUT}/14-invitar.png')
    A.locator('.modal').get_by_role('button', name='Invitar', exact=True).click()
    A.wait_for_selector('text=Invitaciones enviadas', timeout=20000)
    msgs = A.eval_on_selector_all('.msg-box', 'xs => xs.map(x => x.innerText)')
    check('2.1 Invitación múltiple con rol elegido', len([i for i in fake.tables['hse_invitations'].values() if i['role'] == 'supervisor']) == 2, '')
    check('2.2 Mensaje listo para WhatsApp/correo con enlace de invitación', len(msgs) == 2 and '/?invitacion=ana.perez%40contratista.com' in msgs[0] and 'Coordinador HSE' in msgs[0]
          and A.locator('a[href^="https://wa.me/?text="]').count() == 2, msgs[0][:160] if msgs else '')
    A.get_by_role('button', name='Listo').click()
    A.get_by_role('tab', name='Invitaciones (2)').click()
    A.locator('.inv-list li', has_text='juan.gomez').get_by_role('button', name='Revocar').click()
    ok = wait_until(A, lambda: A.get_by_role('tab', name='Invitaciones (1)').count() == 1)
    check('2.3 Revocar invitación', ok and len(fake.tables['hse_invitations']) == 1, '')

    # editar al usuario B
    A.get_by_role('tab', name='Usuarios').click()
    A.locator('.users-t tbody tr', has_text='b@test.local').click()
    A.wait_for_selector('.role-card', timeout=10000)
    check('3.1 Ficha del usuario: auditorías asignadas', wait_until(A, lambda: 'AUD-2026-0001' in A.locator('.modal').inner_text(), 15), '')
    A.locator('.modal .role-card', has_text='Coordinador HSE').click()
    A.screenshot(path=f'{OUT}/15-ficha-usuario.png')
    A.get_by_role('button', name='Guardar cambios').click()
    ok = wait_until(A, lambda: any(m['user_id'] == fake.users['B'] and m['role'] == 'supervisor' for m in fake.tables['hse_memberships'].values()))
    check('3.2 Cambio de rol guardado en el servidor', ok, '')
    A.locator('.users-t tbody tr', has_text='b@test.local').click()
    A.wait_for_selector('.switch-row input', timeout=10000)
    A.locator('.switch-row input').uncheck()
    A.get_by_role('button', name='Guardar cambios').click()
    ok = wait_until(A, lambda: any(m['user_id'] == fake.users['B'] and m['active'] is False for m in fake.tables['hse_memberships'].values()))
    check('3.3 Desactivar acceso', ok, '')
    A.get_by_role('tab', name='Permisos por rol').click()
    heads = A.eval_on_selector_all('.perm-t thead th', 'xs => xs.map(x => x.innerText)')
    check('4.1 Matriz de permisos por rol', len(heads) == 8 and A.locator('.perm-t tbody tr').count() >= 10, json.dumps(heads, ensure_ascii=False))
    A.screenshot(path=f'{OUT}/16-permisos.png')

    # rediseño: escritorio
    A.goto(f'{BASE}/'); A.wait_for_selector('.gauge-card', timeout=60000); A.wait_for_timeout(600)
    check('5.1 Dashboard nuevo: indicador, tarjeta "Continuar auditoría" y menú con íconos', A.locator('.continue-card').count() == 1 and A.locator('.nav a svg').count() >= 8, '')
    A.screenshot(path=f'{OUT}/17-dashboard-escritorio.png')
    A.context.close()

    # rediseño: celular (auditor B, ya reactivado no importa: el simulador no corta el acceso)
    for m in fake.tables['hse_memberships'].values(): m['active'] = True
    M = ctx_for(browser, 'A', {'width': 390, 'height': 844}, mobile=True).new_page()
    M.goto(f'{BASE}/'); M.wait_for_selector('.gauge-card', timeout=60000); M.wait_for_timeout(600)
    check('6.1 Celular: barra inferior de accesos', M.locator('.tabbar .tabbar-item').count() == 5 and M.locator('.tabbar').is_visible(), '')
    check('6.2 Celular: dashboard sin desplazamiento horizontal', no_hscroll(M), '')
    M.screenshot(path=f'{OUT}/18-inicio-celular.png')
    M.goto(f'{BASE}/auditorias/{fake.audit}'); M.wait_for_selector('.audit-bar', timeout=60000); M.wait_for_timeout(500)
    M.locator('.item').nth(0).get_by_role('radio', name='Cumple', exact=True).click(); M.wait_for_timeout(300)
    bar = M.locator('.audit-bar').inner_text()
    check('6.3 Celular: barra de avance fija con respondidas', '1/3' in bar, bar.replace('\n', ' '))
    M.get_by_role('button', name='Siguiente sin responder').click(); M.wait_for_timeout(700)
    vis = M.evaluate("() => { const r = document.querySelectorAll('.item')[1].getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }")
    check('6.4 "Siguiente sin responder" lleva al próximo requisito', vis, '')
    check('6.5 Celular: auditoría sin desplazamiento horizontal', no_hscroll(M), '')
    M.screenshot(path=f'{OUT}/19-auditoria-celular.png')
    M.goto(f'{BASE}/admin/miembros'); M.wait_for_selector('.users-t', timeout=30000); M.wait_for_timeout(400)
    check('6.6 Celular: panel de usuarios sin desplazamiento horizontal', no_hscroll(M), '')
    M.context.close()

    # invitado: el enlace abre "Crear cuenta" con el correo cargado
    G = ctx_for(browser, 'A', {'width': 390, 'height': 844}, mobile=True, session=False).new_page()
    G.goto(f'{BASE}/?invitacion=ana.perez%40contratista.com'); G.wait_for_selector('text=Crear cuenta', timeout=30000)
    em = G.locator('input[type=email]').input_value()
    check('7.1 Enlace de invitación: crear cuenta con el correo cargado', em == 'ana.perez@contratista.com' and G.locator('text=Lo invitaron').count() == 1, em)
    G.screenshot(path=f'{OUT}/20-invitado.png')
    G.context.close()

    # un auditor no ve el panel
    Bp = ctx_for(browser, 'B', {'width': 1280, 'height': 800}).new_page()
    Bp.goto(f'{BASE}/admin/miembros'); Bp.wait_for_selector('text=Sólo propietarios', timeout=60000)
    check('8.1 Un auditor no accede al panel ni lo ve en el menú', Bp.locator('.nav a', has_text='Usuarios y permisos').count() == 0, '')
    browser.close()

ok = sum(r['ok'] for r in results)
print(f'\n{ok}/{len(results)} pruebas OK')
json.dump(results, open(os.path.join(OUT, 'resultados.json'), 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if ok == len(results) else 1)
