// Content script que corre en TODOS los frames de TODAS las páginas, pero queda
// INERTE hasta que el background lo "activa" (cosa que solo ocurre en pestañas de
// jkanime). Una vez activo, controla el <video> de su frame: fija la velocidad y
// ejecuta el salto de opening.
//
// Vive en todos los frames porque el video está en un iframe de dominio rotativo
// (Streamwish/sfastwish/VOE/...) que no podemos enumerar de antemano. El frame
// sin video simplemente nunca hace nada.

if (!window.__jkflowPlayer) {
  window.__jkflowPlayer = true;

  let desiredSpeed = null; // null = no activado todavía, o autoSpeed apagado

  const videos = () => [...document.querySelectorAll('video')];

  // El video relevante del frame: el que se está reproduciendo, o el único que haya.
  const currentVideo = () => videos().find((video) => !video.paused) || videos()[0] || null;

  // Re-aplica la velocidad deseada (los players la resetean al cargar fuente).
  const enforceSpeed = () => {
    if (desiredSpeed == null) return;
    for (const video of videos()) {
      if (video.playbackRate !== desiredSpeed) video.playbackRate = desiredSpeed;
    }
  };

  // Salta `seconds` hacia adelante desde donde va el video, sin pasarse del final.
  const skip = (seconds) => {
    const video = currentVideo();
    if (!video) return;
    const target = video.currentTime + seconds;
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(target, video.duration - 1)
      : target;
  };

  // Vuelve a fijar la velocidad cuando aparece un video nuevo o el player la cambia.
  new MutationObserver(enforceSpeed).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener('ratechange', enforceSpeed, true);
  document.addEventListener('loadedmetadata', enforceSpeed, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'activate') {
      desiredSpeed = message.autoSpeed ? message.speed : null;
      enforceSpeed();
    } else if (message?.type === 'skip') {
      skip(message.seconds);
    }
  });
}
