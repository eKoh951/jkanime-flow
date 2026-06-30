// Valores por defecto y helpers compartidos entre el background, el popup y el
// content script de jkanime. Módulo ES: cada contexto lo importa (Vite/CRXJS
// lo bundlea donde se use, sin duplicar código ni depender de scripts clásicos).

export const JKFLOW_DEFAULTS = {
  autoSelectServer: true,
  preferredServer: 'Streamwish',
  autoSpeed: true,
  playbackSpeed: 1.25,
  autoplay: true, // dar play en cuanto el reproductor tenga el video listo
  autoSkipIntro: false, // saltar el opening solo al empezar el capítulo
  autoFullscreen: false, // entrar a pantalla completa en el 1er gesto del capítulo
  skipSeconds: 85, // duración típica de un opening (~1:25)
  skipBySeries: {}, // override por serie: { pokemon: 80 }
};

// Servidores que ofrece jkanime, en el orden de sus pestañas.
export const JKFLOW_SERVERS = [
  'Desu', 'Magi', 'Desuka', 'Mega', 'Streamwish', 'VOE',
  'Vidhide', 'Mixdrop', 'Mp4upload', 'Streamtape', 'Doodstream',
];

// Slug de la serie a partir de la URL del capítulo: /pokemon/38/ -> "pokemon".
export function jkflowSeriesSlug(url) {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments[0] || null;
  } catch {
    return null;
  }
}

// Lee los settings combinando lo guardado con los defaults. Devuelve una promesa.
export function jkflowGetSettings() {
  return chrome.storage.sync.get(JKFLOW_DEFAULTS);
}
