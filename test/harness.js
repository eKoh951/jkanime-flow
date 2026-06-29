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

const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(__dirname, '.artifacts');
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

const jkHtml = fs.readFileSync(path.join(__dirname, 'mock', 'jkanime.html'), 'utf8');
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
    // 1) Service worker (background) de la extensión.
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes('background.js'),
      { timeout: 15000 },
    );
    const sw = await swTarget.worker();
    const extId = new URL(swTarget.url()).host;
    ok(`service worker activo (${extId})`);

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
      let host = '';
      try {
        host = new URL(req.url()).hostname;
      } catch {
        return req.abort();
      }
      if (host.endsWith('jkanime.net')) {
        return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: jkHtml });
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

    // 5) Asserts de UI: 3 botones + chips de atajo.
    const ui = await provider.evaluate(() => {
      const root = document.getElementById('__jkflow_controls');
      const buttons = [...root.querySelectorAll('button')];
      const chips = buttons
        .map((b) => b.querySelector('span:last-child'))
        .map((c) => (c && c.style.display !== 'none' ? c.textContent : ''));
      return { count: buttons.length, labels: buttons.map((b) => b.textContent), chips };
    });
    assert('hay 3 botones', ui.count === 3, JSON.stringify(ui.labels));
    assert(
      'el botón "Siguiente" existe',
      ui.labels.some((l) => /Siguiente/.test(l)),
      JSON.stringify(ui.labels),
    );
    assert(
      'los botones muestran el atajo (chip)',
      ui.chips.some((c) => c && c.trim().length > 0),
      `chips=${JSON.stringify(ui.chips)}`,
    );

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
