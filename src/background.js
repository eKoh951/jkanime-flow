// Service worker: el hub de mensajes de la extensión.
//   - Traduce los atajos de teclado (chrome.commands) en mensajes a la pestaña.
//   - Reenvía los settings al frame del player cuando jkanime lo pide.
// Solo actúa sobre pestañas de jkanime; el resto de la navegación lo ignora.

importScripts('lib/defaults.js');

const isJkanime = (url) => !!url && /:\/\/([^/]+\.)?jkanime\.net\//.test(url);

async function activeJkanimeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && isJkanime(tab.url) ? tab : null;
}

// Manda un mensaje a TODOS los frames de la pestaña: el frame con el <video>
// (o el top frame) actúa, los demás lo ignoran. Silencia el error que lanza
// Chrome cuando ningún frame tiene listener.
function broadcast(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

// Segundos de salto para una serie: override por serie o el global.
function resolveSkipSeconds(settings, url) {
  const slug = jkflowSeriesSlug(url);
  return (slug && settings.skipBySeries[slug]) || settings.skipSeconds;
}

// Ejecuta una acción (de un atajo de teclado o de un botón del player) sobre la
// pestaña de jkanime: la traduce en un mensaje a los frames.
async function runCommand(tab, command) {
  if (!tab) return;

  if (command === 'next-episode') {
    broadcast(tab.id, { type: 'next' });
  } else if (command === 'prev-episode') {
    broadcast(tab.id, { type: 'prev' });
  } else if (command === 'skip-intro') {
    const settings = await jkflowGetSettings();
    broadcast(tab.id, { type: 'skip', seconds: resolveSkipSeconds(settings, tab.url) });
  }
}

// Atajos de teclado. Se pueden reconfigurar en chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener(async (command) => {
  runCommand(await activeJkanimeTab(), command);
});

// Atajos REALES actualmente asignados (respeta lo que el user cambie en
// chrome://extensions/shortcuts). Mapa { 'next-episode': 'Ctrl+Shift+Right', ... }.
function getShortcuts() {
  return new Promise((resolve) => {
    if (!chrome.commands?.getAll) return resolve({});
    chrome.commands.getAll((commands) => {
      const map = {};
      for (const command of commands || []) map[command.name] = command.shortcut || '';
      resolve(map);
    });
  });
}

// Payload de "activate": settings (velocidad, autoplay, auto-skip, fullscreen),
// los segundos de salto resueltos para la serie de `url`, y los atajos actuales.
const activatePayload = (settings, url, shortcuts) => ({
  type: 'activate',
  autoSpeed: settings.autoSpeed,
  speed: settings.playbackSpeed,
  autoplay: settings.autoplay,
  autoSkipIntro: settings.autoSkipIntro,
  autoFullscreen: settings.autoFullscreen,
  skipSeconds: resolveSkipSeconds(settings, url),
  shortcuts: shortcuts || {},
  settings, // settings completos (con defaults) para el panel de ajustes del player
});

// Resuelve settings + atajos en paralelo y arma el payload para `url`.
async function buildActivatePayload(url) {
  const [settings, shortcuts] = await Promise.all([jkflowGetSettings(), getShortcuts()]);
  return activatePayload(settings, url, shortcuts);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;

  // PUSH: el content script de jkanime pide "activar" los reproductores (al
  // cargar la página y al cambiar de servidor). Reenviamos a todos los frames.
  if (message?.type === 'activatePlayers') {
    buildActivatePayload(sender.tab.url).then((payload) => {
      broadcast(sender.tab.id, payload);
    });
    return;
  }

  // PULL: el player.js de un frame pide su config en cuanto carga / aparece un
  // <video>. Esto evita la race condition de que el iframe del proveedor monte
  // después del push. Solo respondemos en pestañas de jkanime.
  if (message?.type === 'requestActivate') {
    if (!isJkanime(sender.tab.url)) {
      sendResponse(null);
      return false;
    }
    buildActivatePayload(sender.tab.url).then(sendResponse);
    return true; // respuesta asíncrona
  }

  // Botones del player (siguiente/anterior/saltar): misma lógica que los atajos.
  if (message?.type === 'command' && isJkanime(sender.tab.url)) {
    runCommand(sender.tab, message.command);
    return;
  }
});

// Cambios en los settings (popup) → aplicar EN VIVO a las pestañas de jkanime
// abiertas, sin recargar. Re-empuja velocidad y autoplay a todos sus frames.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.tabs.query({ url: '*://*.jkanime.net/*' }, async (tabs) => {
    for (const tab of tabs) broadcast(tab.id, await buildActivatePayload(tab.url));
  });
});
