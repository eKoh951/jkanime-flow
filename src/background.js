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

// Atajos de teclado. Se pueden reconfigurar en chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await activeJkanimeTab();
  if (!tab) return;

  if (command === 'next-episode') {
    broadcast(tab.id, { type: 'next' });
  } else if (command === 'prev-episode') {
    broadcast(tab.id, { type: 'prev' });
  } else if (command === 'skip-intro') {
    const settings = await jkflowGetSettings();
    const slug = jkflowSeriesSlug(tab.url);
    const seconds = (slug && settings.skipBySeries[slug]) || settings.skipSeconds;
    broadcast(tab.id, { type: 'skip', seconds });
  }
});

// El content script de jkanime pide "activar" los reproductores (al cargar la
// página y al cambiar de servidor). Reenviamos la velocidad a todos los frames.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'activatePlayers' && sender.tab) {
    jkflowGetSettings().then((settings) => {
      broadcast(sender.tab.id, {
        type: 'activate',
        autoSpeed: settings.autoSpeed,
        speed: settings.playbackSpeed,
      });
    });
  }
});
