"""
Dictado por voz (Chromium real con un reconocimiento de voz simulado: el navegador de prueba no tiene micrófono).
Comprueba: botón en los campos de texto, comandos ("punto", "punto y aparte"), mayúsculas, guardado y
sincronización del comentario de la lista de verificación y del acta, mensaje de permiso denegado y
que el botón no aparece en navegadores sin reconocimiento de voz.

Uso: python3 tests/e2e/dictation_e2e.py http://localhost:4177 [carpeta_salida]
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

# Reconocimiento simulado: lo que "se dice" se toma de window.__say (frases finales) o window.__srError.
FAKE_SR = """
class FakeSR {
  constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.onresult = null; this.onerror = null; this.onend = null; this._t = []; }
  start() {
    window.__srLang = this.lang;
    const err = window.__srError, says = window.__say || [];
    if (err) { this._t.push(setTimeout(() => { this.onerror && this.onerror({ error: err }); this.onend && this.onend(); }, 50)); return; }
    let acc = [];
    says.forEach((s, i) => this._t.push(setTimeout(() => {
      // primero un resultado parcial, después el final
      this.onresult && this.onresult({ resultIndex: acc.length, results: [...acc, { isFinal: false, 0: { transcript: s.slice(0, 6) } }] });
      acc = [...acc, { isFinal: true, 0: { transcript: s } }];
      this.onresult && this.onresult({ resultIndex: acc.length - 1, results: acc });
    }, 150 + i * 250)));
  }
  stop() { this._t.forEach(clearTimeout); setTimeout(() => this.onend && this.onend(), 30); }
  abort() { this.stop(); }
}
if (!window.__noSR) { window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR; } else { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; }
"""

def ctx_for(browser, no_sr=False):
    ctx = browser.new_context(viewport={'width': 412, 'height': 915}, service_workers='allow')
    ctx.add_init_script(f"if (!localStorage.getItem('{STORAGE_KEY}')) localStorage.setItem('{STORAGE_KEY}', {json.dumps(json.dumps(fake.session('A')))});")
    if no_sr: ctx.add_init_script('window.__noSR = true;')
    ctx.add_init_script(FAKE_SR)
    ctx.route(f'{SB}/**', fake.handle)
    return ctx

def wait_until(page, fn, timeout=40):
    # page.wait_for_timeout (no time.sleep): deja que Playwright atienda las rutas del servidor simulado
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if fn(): return True
        except Exception: pass
        page.wait_for_timeout(400)
    return False

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = ctx_for(browser); P = ctx.new_page()
    P.goto(f'{BASE}/auditorias/{fake.audit}'); P.wait_for_selector('.item', timeout=60000)
    item = P.locator('.item').nth(1)
    btn = item.locator('.dictate-btn')
    check('1.1 Botón de micrófono en el comentario de cada requisito', btn.count() == 1 and btn.get_attribute('aria-label') == 'Dictar por voz', '')

    P.evaluate("window.__say = ['extintor del sector de carga vencido punto falta la tarjeta de control', 'punto y aparte se informa al supervisor punto']")
    btn.click(); P.wait_for_timeout(120)
    live = item.locator('.dictate-live').inner_text() if item.locator('.dictate-live').count() else ''
    check('1.2 Mientras escucha: botón en rojo de detener y aviso "Escuchando"', item.locator('.dictate.is-on').count() == 1 and 'Escuchando' in live, live)
    P.wait_for_timeout(900)
    item.locator('.dictate-btn').click(); P.wait_for_timeout(600)
    val = item.locator('textarea').input_value()
    want = 'Extintor del sector de carga vencido. Falta la tarjeta de control.\nSe informa al supervisor.'
    check('1.3 Texto dictado con puntos, punto y aparte y mayúsculas', val == want, json.dumps(val, ensure_ascii=False))
    check('1.4 Idioma del reconocimiento: español (Argentina)', P.evaluate('window.__srLang') == 'es-AR', P.evaluate('window.__srLang'))
    ok = wait_until(P, lambda: any(r.get('comment') == want for r in fake.tables['hse_audit_responses'].values() if r.get('audit_id') == fake.audit))
    check('1.5 El comentario dictado se guarda y se sincroniza sin tocar otro campo', ok, '')

    P.evaluate("window.__say = ['punto de encuentro señalizado']")
    item.locator('.dictate-btn').click(); P.wait_for_timeout(700); item.locator('.dictate-btn').click(); P.wait_for_timeout(500)
    val2 = item.locator('textarea').input_value()
    check('1.6 "Punto de encuentro" no se convierte en signo y se agrega al final', val2.endswith('supervisor.\nPunto de encuentro señalizado') or val2.endswith('supervisor. Punto de encuentro señalizado'), json.dumps(val2[-60:], ensure_ascii=False))
    P.screenshot(path=f'{OUT}/dictado-requisito.png')

    # campo controlado: acuerdos del acta de cierre
    P.wait_for_selector('text=Reunión de cierre y firmas', timeout=30000)
    ag = P.locator('.dictate', has=P.get_by_label('Acuerdos y compromisos'))
    P.evaluate("window.__say = ['presentar el plan de acción en quince días']")
    ag.locator('.dictate-btn').click(); P.wait_for_timeout(600); ag.locator('.dictate-btn').click(); P.wait_for_timeout(300)
    P.get_by_role('button', name='Guardar acta').click()
    ok = wait_until(P, lambda: (fake.tables['hse_audits'][fake.audit].get('closing_agreements') or '') == 'Presentar el plan de acción en quince días')
    check('2.1 Dictado en un campo de formulario (acuerdos del acta) y guardado', ok, fake.tables['hse_audits'][fake.audit].get('closing_agreements') or '')
    check('2.2 get_by_label sigue encontrando el campo (el botón no roba la etiqueta)', P.get_by_label('Acuerdos y compromisos').count() == 1, '')

    # permiso denegado
    P.evaluate("window.__srError = 'not-allowed'")
    item.locator('.dictate-btn').click(); P.wait_for_timeout(400)
    m = item.locator('.dictate-msg').inner_text() if item.locator('.dictate-msg').count() else ''
    check('3.1 Sin permiso de micrófono: mensaje claro y el texto queda intacto', 'permiso' in m and item.locator('textarea').input_value() == val2, m)
    P.evaluate("window.__srError = 'network'")
    item.locator('.dictate-btn').click(); P.wait_for_timeout(400)
    m = item.locator('.dictate-msg').inner_text() if item.locator('.dictate-msg').count() else ''
    check('3.2 Sin servicio de reconocimiento (red): sugiere el micrófono del teclado', 'teclado' in m, m)
    ctx.close()

    ctx2 = ctx_for(browser, no_sr=True); Q = ctx2.new_page()
    Q.goto(f'{BASE}/auditorias/{fake.audit}'); Q.wait_for_selector('.item', timeout=60000)
    check('4.1 Navegador sin reconocimiento de voz: no se muestra el botón y el campo funciona igual', Q.locator('.dictate-btn').count() == 0 and Q.locator('.item textarea').count() >= 3, '')
    ctx2.close(); browser.close()

ok = sum(r['ok'] for r in results)
print(f'\n{ok}/{len(results)} pruebas OK')
json.dump(results, open(os.path.join(OUT, 'resultados.json'), 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if ok == len(results) else 1)
