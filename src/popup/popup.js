// UI de preferencias. Auto-guarda al cambiar cualquier campo. Detecta la serie
// de la pestaña activa para permitir un salto de opening propio por serie.

const fields = {
  autoSelectServer: document.getElementById('autoSelectServer'),
  preferredServer: document.getElementById('preferredServer'),
  autoSpeed: document.getElementById('autoSpeed'),
  playbackSpeed: document.getElementById('playbackSpeed'),
  autoplay: document.getElementById('autoplay'),
  skipSeconds: document.getElementById('skipSeconds'),
  autoSkipIntro: document.getElementById('autoSkipIntro'),
  autoFullscreen: document.getElementById('autoFullscreen'),
};
const skipSeriesInput = document.getElementById('skipSeries');
const seriesRow = document.getElementById('seriesRow');
const seriesName = document.getElementById('seriesName');
const speedValue = document.getElementById('speedValue');
const status = document.getElementById('status');

let currentSlug = null;

// "1.5" en vez de "1.50"; "1" en vez de "1.00". Añade el signo ×.
function formatSpeed(value) {
  return `${Number(value).toFixed(2).replace(/\.?0+$/, '')}×`;
}

function updateSpeedLabel() {
  speedValue.textContent = formatSpeed(fields.playbackSpeed.value);
}

function fillServerOptions() {
  for (const name of JKFLOW_SERVERS) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    fields.preferredServer.append(option);
  }
}

function showSaved() {
  status.textContent = 'Guardado ✓';
  setTimeout(() => (status.textContent = ''), 1200);
}

// Si la pestaña activa es un capítulo de jkanime, muestra el campo de salto por serie.
async function detectSeries() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onJkanime = tab && /jkanime\.net/.test(tab.url || '');
  currentSlug = onJkanime ? jkflowSeriesSlug(tab.url) : null;
  if (currentSlug) {
    seriesName.textContent = currentSlug;
    seriesRow.hidden = false;
  }
}

async function load() {
  fillServerOptions();

  const settings = await jkflowGetSettings();
  fields.autoSelectServer.checked = settings.autoSelectServer;
  fields.preferredServer.value = settings.preferredServer;
  fields.autoSpeed.checked = settings.autoSpeed;
  fields.playbackSpeed.value = String(settings.playbackSpeed);
  updateSpeedLabel();
  fields.autoplay.checked = settings.autoplay;
  fields.skipSeconds.value = settings.skipSeconds;
  fields.autoSkipIntro.checked = settings.autoSkipIntro;
  fields.autoFullscreen.checked = settings.autoFullscreen;

  await detectSeries();
  if (currentSlug && settings.skipBySeries[currentSlug] != null) {
    skipSeriesInput.value = settings.skipBySeries[currentSlug];
  }
}

async function saveGlobal() {
  await chrome.storage.sync.set({
    autoSelectServer: fields.autoSelectServer.checked,
    preferredServer: fields.preferredServer.value,
    autoSpeed: fields.autoSpeed.checked,
    playbackSpeed: Number(fields.playbackSpeed.value),
    autoplay: fields.autoplay.checked,
    skipSeconds: Number(fields.skipSeconds.value),
    autoSkipIntro: fields.autoSkipIntro.checked,
    autoFullscreen: fields.autoFullscreen.checked,
  });
  showSaved();
}

// Guarda (o borra, si se deja vacío) el override de salto para la serie actual.
async function saveSeries() {
  if (!currentSlug) return;
  const settings = await jkflowGetSettings();
  const skipBySeries = { ...settings.skipBySeries };
  if (skipSeriesInput.value === '') delete skipBySeries[currentSlug];
  else skipBySeries[currentSlug] = Number(skipSeriesInput.value);
  await chrome.storage.sync.set({ skipBySeries });
  showSaved();
}

for (const field of Object.values(fields)) {
  field.addEventListener('change', saveGlobal);
}
// El slider: muestra el valor en vivo al arrastrar; guarda al soltar (evita
// saturar chrome.storage con escrituras durante el arrastre).
fields.playbackSpeed.addEventListener('input', updateSpeedLabel);
skipSeriesInput.addEventListener('change', saveSeries);

load();
