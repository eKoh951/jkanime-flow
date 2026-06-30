// Harness de pruebas agéntico para la extensión JKAnime Flow.
//
// Carga la extensión REAL en Brave (sin descargar navegador: usa el instalado)
// y sirve una página mock de jkanime por intercepción de red, de modo que la URL
// sea https://jkanime.net/... y los content scripts se inyecten de verdad. Desde
// ahí hace clics, lee consolas, corre asserts y saca un screenshot.
//
// Uso:
//   node test/harness.js            (headless)
//   HEADED=1 node test/harness.js   (con ventana visible)

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', 'dist');
const ARTIFACTS = path.join(__dirname, '.artifacts');
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

const jk37Html = fs.readFileSync(path.join(__dirname, 'mock', 'jkanime.html'), 'utf8');
const jk38Html = fs.readFileSync(path.join(__dirname, 'mock', 'jkanime38.html'), 'utf8');
const providerHtml = fs.readFileSync(path.join(__dirname, 'mock', 'provider.html'), 'utf8');

const results = [];
const ok = (name) => results.push({ name, pass: true });
const fail = (name, detail) => results.push({ name, pass: false, detail });
const assert = (name, cond, detail) => (cond ? ok(name) : fail(name, detail));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFrame(page, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = page.frames().find(predicate);
    if (frame) return frame;
    await sleep(150);
  }
  throw new Error('frame no encontrado a tiempo');
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: BRAVE,
    headless: process.env.HEADED ? false : 'new',
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DialMediaRouteProvider',
    ],
  });

  const logs = [];
  try {
    // 1) Service worker (background) de la extensión. CRXJS bundlea el background
    // real con un hash, pero siempre genera este loader con nombre fijo.
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes('service-worker-loader.js'),
      { timeout: 15000 },
    );
    const sw = await swTarget.worker();
    const extId = new URL(swTarget.url()).host;
    ok(`service worker activo (${extId})`);

    // El worker tarda un poco en tener las bindings de chrome.* listas justo
    // después de que CDP ve aparecer el target (carrera, no pasa con la
    // extensión sin bundlear). Esperamos a que chrome.storage exista de verdad.
    for (let i = 0; i < 20 && (await sw.evaluate(() => typeof chrome?.storage)) !== 'object'; i++) {
      await sleep(100);
    }

    // 2) Pre-configura settings: auto-fullscreen ON para reproducir el bug de clics.
    await sw.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.sync.set(
            {
              autoSelectServer: false,
              autoSpeed: true,
              playbackSpeed: 1.5,
              autoplay: false,
              autoSkipIntro: false,
              autoFullscreen: true,
            },
            resolve,
          ),
        ),
    );
    ok('settings de prueba aplicados (autoFullscreen=ON)');

    // 3) Página con intercepción → sirve el mock bajo jkanime.net / provider.local.
    const page = await browser.newPage();
    page.on('console', (m) => logs.push(`[page.${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      // CRXJS bundlea los content scripts en chunks separados que se cargan con
      // un `import()` dinámico desde un loader (chrome-extension://...): dejarlos
      // pasar, si no el loader nunca consigue el chunk real y el script no corre.
      if (req.url().startsWith('chrome-extension://')) return req.continue();
      let host = '';
      try {
        host = new URL(req.url()).hostname;
      } catch {
        return req.abort();
      }
      if (host.endsWith('jkanime.net')) {
        const body = /\/38\//.test(new URL(req.url()).pathname) ? jk38Html : jk37Html;
        return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
      }
      if (host === 'provider.local') {
        return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: providerHtml });
      }
      return req.abort();
    });

    await page.goto('https://jkanime.net/pokemon/37/', { waitUntil: 'domcontentloaded' });

    // 4) Espera el iframe del proveedor y que monten los botones.
    const provider = await waitForFrame(page, (f) => f.url().includes('provider.local'));
    await provider.waitForSelector('#__jkflow_controls', { timeout: 10000 });
    ok('botones montados en el frame del proveedor');

    // 5) Asserts de UI: botones de acción, engranaje, panel. Sin chips ni iconos.
    const ui = await provider.evaluate(() => {
      const root = document.getElementById('__jkflow_controls');
      const text = root.innerText || '';
      const buttons = [...root.querySelectorAll('button')];
      const saltar = buttons.find((b) => /Saltar intro/.test(b.textContent));
      return {
        hasSiguiente: /Siguiente/.test(text),
        hasSaltar: /Saltar intro/.test(text),
        hasAnterior: /Anterior/.test(text),
        hasGear: buttons.some((b) => b.textContent.includes('⚙')),
        hasPanel: !!root.querySelector('#__jkflow_panel'),
        saltarText: saltar ? saltar.textContent.trim() : '',
        hasChips: /[⌘⇧]|Espacio/.test(text),
      };
    });
    assert('botón "Siguiente" existe', ui.hasSiguiente, JSON.stringify(ui));
    assert('botón "Saltar intro" existe', ui.hasSaltar, JSON.stringify(ui));
    assert('ya NO existe "Anterior"', !ui.hasAnterior, JSON.stringify(ui));
    assert('existe el engranaje de ajustes (⚙)', ui.hasGear, JSON.stringify(ui));
    assert('ya NO hay chips de atajo', !ui.hasChips, JSON.stringify(ui));
    assert('"Saltar intro" sin icono', ui.saltarText === 'Saltar intro', `text="${ui.saltarText}"`);

    // 5b) El panel de ajustes abre con ⚙ y sus cambios persisten en storage.
    const panelDisplay = await provider.evaluate(() => {
      const gear = [...document.querySelectorAll('#__jkflow_controls button')].find((b) =>
        b.textContent.includes('⚙'),
      );
      gear.click();
      return getComputedStyle(document.getElementById('__jkflow_panel')).display;
    });
    assert('el panel de ajustes abre con ⚙', panelDisplay !== 'none', panelDisplay);

    await provider.evaluate(() => {
      const slider = document.querySelector('#__jkflow_panel input[type="range"]');
      slider.value = '1.75';
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);
    const storedSpeed = await sw.evaluate(
      () => new Promise((r) => chrome.storage.sync.get({ playbackSpeed: null }, (x) => r(x.playbackSpeed))),
    );
    assert('cambiar velocidad en el panel persiste (1.75)', storedSpeed === 1.75, `stored=${storedSpeed}`);

    // 5c) REGRESIÓN: el slider NO debe resetearse cuando el DOM muta (el player
    //     real muta constante). Antes apply()→syncPanel() lo reseteaba y "no se movía".
    const sliderAfter = await provider.evaluate(async () => {
      const slider = document.querySelector('#__jkflow_panel input[type="range"]');
      slider.focus();
      slider.value = '1.2'; // simula que el usuario lo arrastró a 1.2
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      document.body.appendChild(document.createElement('span')); // dispara el MutationObserver
      await new Promise((r) => setTimeout(r, 150));
      return Number(slider.value);
    });
    assert(
      'el slider no se resetea con mutaciones del DOM (se puede mover)',
      sliderAfter === 1.2,
      `val=${sliderAfter}`,
    );

    // 5c-bis) La tecla F la maneja el content script (hace preventDefault para
    //         entrar/salir de fullscreen). El fullscreen real no es fiable en
    //         headless, así que verificamos que el handler corrió.
    const fHandled = await provider.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert('la tecla F está enganchada (fullscreen)', fHandled, 'la F no fue manejada');

    // 5d) NAVEGACIÓN IN-PLACE: "Siguiente" carga el cap 38 en el MISMO iframe sin
    //     recargar la página (clave para que el fullscreen persista entre caps).
    await page.evaluate(() => (window.__jkProbe = 'kept')); // se borraría con una recarga real
    await provider.evaluate(() => {
      const btn = [...document.querySelectorAll('#__jkflow_controls button')].find((b) =>
        /Siguiente/.test(b.textContent),
      );
      btn.click();
    });
    await sleep(1200);
    const navState = await page.evaluate(() => ({
      probe: window.__jkProbe,
      url: location.href,
      iframeSrc: document.querySelector('iframe.player_conte')?.src || '',
    }));
    assert('"Siguiente" NO recarga la página (carga in-place)', navState.probe === 'kept', `probe=${navState.probe}`);
    assert('la URL cambió al cap 38', /pokemon\/38\//.test(navState.url), navState.url);
    assert('el player cambió al cap 38 (mismo iframe)', /ep=38/.test(navState.iframeSrc), navState.iframeSrc);

    // 6) REGRESIÓN del bug: con autoFullscreen ON, un clic en el TOP frame NO debe
    //    ser secuestrado hacia el botón "fullscreen" de la página.
    await page.click('#topBtn');
    await sleep(200);
    const clickState = await page.evaluate(() => ({
      top: window.__topClicked,
      fs: window.__fsClicked,
    }));
    assert('el clic normal del top frame funciona', clickState.top === true, JSON.stringify(clickState));
    assert(
      'el clic NO fue secuestrado a fullscreen (bug arreglado)',
      clickState.fs === false,
      JSON.stringify(clickState),
    );

    // 7) Screenshot de evidencia.
    const shot = path.join(ARTIFACTS, 'run.png');
    await page.screenshot({ path: shot });
    ok(`screenshot guardado: ${shot}`);
  } catch (err) {
    fail('harness', err.message);
  } finally {
    await browser.close();
  }

  // --- Reporte ---
  console.log('\n=== Resultados ===');
  let failed = 0;
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.detail ? `  → ${r.detail}` : ''}`);
    if (!r.pass) failed++;
  }
  if (logs.length) {
    console.log('\n=== Consola de la página ===');
    for (const l of logs) console.log(l);
  }
  console.log(`\n${failed ? `${failed} fallo(s)` : 'Todo OK'}`);
  process.exit(failed ? 1 : 0);
}

main();
