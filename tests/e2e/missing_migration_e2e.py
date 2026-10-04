"""
Compatibilidad: la app publicada contra un servidor SIN la migración 0025 (firmas) debe seguir
sincronizando y mostrar el aviso en lugar del botón de firma.
Uso: python3 tests/e2e/missing_migration_e2e.py http://localhost:4177
"""
import json, sys, time
from playwright.sync_api import sync_playwright
from fake_supabase import FakeSupabase

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4177'
SB = 'https://hhwfhearafhmougtfssu.supabase.co'
KEY = 'sb-hhwfhearafhmougtfssu-auth-token'

class Old(FakeSupabase):
    def handle(self, route):
        if 'hse_audit_signatures' in route.request.url:
            return route.fulfill(status=404, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                                 body=json.dumps({'code': 'PGRST205', 'message': "Could not find the table 'public.hse_audit_signatures' in the schema cache"}))
        return super().handle(route)

fake = Old(); ok = 0
with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1200, 'height': 900})
    ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(fake.session('A')))});")
    ctx.route(f'{SB}/**', fake.handle)
    p = ctx.new_page(); p.goto(f'{BASE}/auditorias/{fake.audit}')
    p.wait_for_selector('text=Reunión de cierre y firmas', timeout=60000)
    t0 = time.time(); phase = ''
    while time.time() - t0 < 40:
        phase = p.locator('[data-sync-phase]').first.get_attribute('data-sync-phase')
        if phase == 'sincronizado': break
        time.sleep(.5)
    r1 = phase == 'sincronizado'; print('OK   ' if r1 else 'FALLA', '1 Sincroniza aunque el servidor no tenga la tabla de firmas -', phase)
    p.wait_for_timeout(800)
    r2 = p.locator('text=migración 0025').count() == 1 and p.get_by_role('button', name='Agregar firma').count() == 0
    print('OK   ' if r2 else 'FALLA', '2 Muestra el aviso y oculta "Agregar firma"')
    ok = r1 + r2; b.close()
print(f'\n{ok}/2 pruebas OK'); sys.exit(0 if ok == 2 else 1)
