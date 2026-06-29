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
  let autoplay = false; // dar play automático cuando el video esté listo
  let autoSkipIntro = false; // saltar el opening al empezar el capítulo
  let autoFullscreen = false; // entrar a fullscreen en el 1er gesto del capítulo
  let skipSeconds = 0; // segundos del opening (resueltos por serie en el background)
  let shortcuts = {}; // atajos actuales { command: 'Ctrl+Shift+Right' } para los chips
  let activated = false; // ya recibimos config (push o pull) al menos una vez
  let fullscreenArmed = false; // ya armamos el auto-fullscreen en este frame
  let fsIntent = false; // el user ya gesticuló queriendo fullscreen (reintentamos hasta lograrlo)
  const autoStarted = new WeakSet(); // videos a los que ya dimos play (no peleamos con el user)
  const autoSkipped = new WeakSet(); // videos a los que ya les saltamos el intro

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

  // Da play una sola vez por video. Si el navegador bloquea el autoplay con
  // sonido (política sin gesto de usuario), reintenta en silencio para que al
  // menos arranque la reproducción.
  const tryAutoplay = (video) => {
    if (!autoplay || !video || autoStarted.has(video)) return;
    if (!video.paused) return;
    autoStarted.add(video);
    const play = video.play();
    if (play && play.catch) {
      play.catch(() => {
        video.muted = true;
        const retry = video.play();
        if (retry && retry.catch) retry.catch(() => {});
      });
    }
  };

  // --- Botones flotantes sobre el reproductor -----------------------------
  // Solo en el frame que tiene el <video> (quedan justo encima del player).
  // Anterior / Saltar intro / Siguiente. Anterior y Siguiente se delegan al
  // background (la navegación ocurre en el top frame de jkanime).
  let controls = null;
  let hideTimer = null;

  const sendCommand = (command) =>
    chrome.runtime.sendMessage({ type: 'command', command }, () => void chrome.runtime.lastError);

  const showControls = () => {
    if (!controls) return;
    controls.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (controls) controls.style.opacity = '0';
    }, 2500);
  };

  // Atajo "bonito": traduce "Command+Shift+Right" → "⌘ ⇧ →" (y respeta símbolos
  // si Chrome ya los entrega así). Cubre Mac y Windows.
  const KEY_GLYPH = {
    command: '⌘', cmd: '⌘', meta: '⌘', mac: '⌘',
    ctrl: 'Ctrl', control: 'Ctrl',
    alt: '⌥', option: '⌥',
    shift: '⇧',
    right: '→', arrowright: '→',
    left: '←', arrowleft: '←',
    up: '↑', down: '↓',
    space: 'Espacio', period: '.', comma: ',',
  };
  const prettyKey = (raw) =>
    !raw
      ? ''
      : raw
          .split('+')
          .map((token) => KEY_GLYPH[token.trim().toLowerCase()] || token.trim())
          .join(' ')
          // Mac entrega el atajo ya concatenado (ej. "⇧⌘Space"): traducimos restos.
          .replace(/\bspace\b/gi, 'Espacio')
          .replace(/\bright\b/gi, '→')
          .replace(/\bleft\b/gi, '←');

  // Paleta tipo Netflix: primario blanco sólido, secundarios gris translúcido.
  const FONT = "'Netflix Sans','Helvetica Neue',Helvetica,Arial,system-ui,sans-serif";
  const BASE =
    'all:unset;box-sizing:border-box;cursor:pointer;pointer-events:auto;user-select:none;' +
    `white-space:nowrap;display:inline-flex;align-items:center;gap:9px;border-radius:4px;font-family:${FONT};` +
    'transition:background .15s,transform .12s,box-shadow .15s;';
  const PRIMARY_BG = '#ffffff';
  const PRIMARY_HOVER = 'rgba(255,255,255,.78)';
  const SECONDARY_BG = 'rgba(109,109,110,.7)';
  const SECONDARY_HOVER = 'rgba(109,109,110,.45)';

  const shortcutEls = {}; // {command: <kbd>} para refrescar el atajo en vivo

  const makeKbd = (primary) => {
    const kbd = document.createElement('span');
    kbd.style.cssText =
      'display:inline-flex;align-items:center;gap:3px;padding:3px 7px;border-radius:4px;' +
      'font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.3px;' +
      (primary
        ? 'background:rgba(0,0,0,.09);color:rgba(0,0,0,.55);'
        : 'background:rgba(255,255,255,.14);color:rgba(255,255,255,.8);');
    return kbd;
  };

  const makeButton = ({ icon, label, command, title, primary }) => {
    const button = document.createElement('button');
    button.title = title;
    const bg = primary ? PRIMARY_BG : SECONDARY_BG;
    const hover = primary ? PRIMARY_HOVER : SECONDARY_HOVER;
    button.style.cssText = primary
      ? `${BASE}font-weight:700;font-size:16px;color:#000;background:${bg};` +
        'padding:13px 24px;box-shadow:0 2px 14px rgba(0,0,0,.45);'
      : `${BASE}font-weight:600;font-size:14px;color:#fff;background:${bg};` +
        'padding:10px 16px;border:1px solid rgba(255,255,255,.18);' +
        'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';

    const text = document.createElement('span');
    text.style.cssText = 'display:inline-flex;align-items:center;gap:8px;';
    text.textContent = primary ? `${label} ${icon}` : `${icon} ${label}`;

    const kbd = makeKbd(primary);
    shortcutEls[command] = kbd;
    button.append(text, kbd);

    button.addEventListener('mouseenter', () => {
      button.style.background = hover;
      button.style.transform = primary ? 'scale(1.05)' : 'scale(1.03)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = bg;
      button.style.transform = 'scale(1)';
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      sendCommand(command);
      showControls();
    });
    return button;
  };

  // Refresca el texto del atajo en cada botón (y oculta el chip si no hay atajo).
  // Escribe SOLO si cambió: apply() corre dentro del MutationObserver, y escribir
  // el DOM sin condición re-dispararía el observer en bucle infinito (pegue de CPU).
  const updateShortcuts = () => {
    for (const [command, kbd] of Object.entries(shortcutEls)) {
      const pretty = prettyKey(shortcuts[command]);
      const display = pretty ? 'inline-flex' : 'none';
      if (kbd.textContent !== pretty) kbd.textContent = pretty;
      if (kbd.style.display !== display) kbd.style.display = display;
    }
  };

  // En fullscreen solo se renderiza el elemento en pantalla completa y sus
  // descendientes. Por eso colgamos los botones DENTRO del elemento fullscreen
  // (el contenedor del proveedor o nuestro documento); fuera de fullscreen, en
  // el body. Si el elemento fullscreen es el <video> pelado no admite hijos, así
  // que ahí caemos al body (no se verán, pero es un caso que evitamos nosotros).
  const controlsHost = () => {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs && fs.tagName !== 'VIDEO') return fs;
    return document.body || document.documentElement;
  };

  const placeControls = () => {
    if (!controls) return;
    const host = controlsHost();
    if (controls.parentElement !== host) host.append(controls);
  };

  const ensureControls = () => {
    if (controls || !currentVideo()) return;
    controls = document.createElement('div');
    controls.id = '__jkflow_controls';
    // Cluster abajo-derecha: [Anterior · Saltar intro]   [ SIGUIENTE ].
    controls.style.cssText =
      'position:fixed;right:2.5%;bottom:8%;z-index:2147483647;' +
      'display:flex;align-items:center;gap:18px;pointer-events:none;opacity:0;transition:opacity .25s ease;';

    const secondary = document.createElement('div');
    secondary.style.cssText = 'display:flex;align-items:center;gap:10px;';
    secondary.append(
      makeButton({ icon: '⏮', label: 'Anterior', command: 'prev-episode', title: 'Capítulo anterior' }),
      makeButton({ icon: '⏩', label: 'Saltar intro', command: 'skip-intro', title: 'Saltar opening' }),
    );

    const next = makeButton({
      icon: '▶',
      label: 'Siguiente',
      command: 'next-episode',
      title: 'Siguiente capítulo',
      primary: true,
    });

    controls.append(secondary, next);
    updateShortcuts();
    placeControls();
    document.addEventListener('mousemove', showControls, true);
    showControls();
  };

  // Al entrar/salir de fullscreen, reubica los botones dentro del nuevo
  // elemento fullscreen para que sigan visibles.
  const onFullscreenChange = () => {
    placeControls();
    showControls();
  };
  document.addEventListener('fullscreenchange', onFullscreenChange, true);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange, true);

  // Aplica todo sobre lo que haya en el frame ahora mismo.
  const apply = () => {
    enforceSpeed();
    const video = currentVideo();
    tryAutoplay(video);
    maybeAutoSkip(video);
    if (activated) {
      ensureControls();
      updateShortcuts();
      armFullscreen();
    }
  };

  // Salta `seconds` hacia adelante en `video`, sin pasarse del final.
  const skipVideo = (video, seconds) => {
    if (!video) return;
    const target = video.currentTime + seconds;
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(target, video.duration - 1)
      : target;
  };

  const skip = (seconds) => skipVideo(currentVideo(), seconds);

  // Salta el opening automáticamente UNA vez al empezar el capítulo: solo si el
  // video va cerca del inicio (no si retomamos a mitad), para no comernos contenido.
  const maybeAutoSkip = (video) => {
    if (!autoSkipIntro || !skipSeconds || !video || autoSkipped.has(video)) return;
    if (video.currentTime >= skipSeconds) return;
    autoSkipped.add(video);
    skipVideo(video, skipSeconds - video.currentTime);
  };

  // --- Auto pantalla completa ---------------------------------------------
  // El navegador exige un gesto del usuario para entrar a fullscreen. Robusto:
  //   1) Disparamos el botón de fullscreen del PROPIO reproductor del proveedor
  //      (así conserva SU UI; no el player nativo de Chrome).
  //   2) Si no hay botón, requestFullscreen sobre el CONTENEDOR del player (no
  //      sobre el <video> pelado, que mostraría los controles de Chrome).
  //   3) Reintentos: si el video aún no cargó al gesticular, lo volvemos a
  //      intentar en cada evento de carga (la activación del gesto dura ~5 s) y
  //      dejamos el gesto armado para el siguiente clic si se pasó la ventana.
  const isFullscreen = () =>
    !!(document.fullscreenElement || document.webkitFullscreenElement);

  // Selectores comunes del botón de pantalla completa de players HTML5.
  const FS_BUTTON_SELECTORS = [
    '[data-plyr="fullscreen"]',
    '.vjs-fullscreen-control',
    '.jw-icon-fullscreen',
    'button[aria-label*="fullscreen" i]',
    'button[aria-label*="pantalla completa" i]',
    'button[title*="fullscreen" i]',
    '[class*="fullscreen" i][role="button"]',
    '.fullscreen,.btn-fullscreen,.icon-fullscreen,.fullscreen-icon',
  ];

  const findProviderFsButton = () => {
    for (const selector of FS_BUTTON_SELECTORS) {
      let element;
      try {
        element = document.querySelector(selector);
      } catch {
        continue;
      }
      if (element && element.offsetParent !== null) return element; // visible
    }
    return null;
  };

  // Contenedor del player: sube desde el <video> al ancestro más alto que aún
  // tenga ~el tamaño del video (el wrapper con los controles del proveedor).
  const playerContainer = (video) => {
    if (!video) return null;
    let best = video;
    let element = video.parentElement;
    const minW = Math.max(video.clientWidth, 200);
    const minH = Math.max(video.clientHeight, 150);
    while (element && element !== document.body && element !== document.documentElement) {
      const rect = element.getBoundingClientRect();
      if (rect.width >= minW && rect.height >= minH) best = element;
      element = element.parentElement;
    }
    return best;
  };

  const requestFs = (element) => {
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    if (!request) return;
    try {
      const result = request.call(element, { navigationUI: 'hide' });
      if (result && result.catch) result.catch(() => {});
    } catch {
      /* sin gesto válido: reintentamos luego */
    }
  };

  // Un intento de entrar a fullscreen con la mejor estrategia disponible.
  const tryEnterFullscreen = () => {
    if (isFullscreen()) {
      disarmFullscreen();
      return;
    }
    const button = findProviderFsButton();
    if (button) {
      button.click();
    } else {
      const target = playerContainer(currentVideo());
      if (target) requestFs(target);
    }
    // Verifica si funcionó; si sí, desarmamos (no peleamos si el user luego sale).
    setTimeout(() => {
      if (isFullscreen()) disarmFullscreen();
    }, 300);
  };

  let onGesture = null;
  const disarmFullscreen = () => {
    fsIntent = false;
    if (!onGesture) return;
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    onGesture = null;
  };

  const armFullscreen = () => {
    // SOLO en el frame que tiene el <video> (el del proveedor). Si armáramos en
    // el top frame de jkanime, cada clic dispararía tryEnterFullscreen() ahí y
    // secuestraría los clics de toda la página. currentVideo() lo garantiza.
    if (fullscreenArmed || !autoFullscreen || !currentVideo()) return;
    fullscreenArmed = true;
    onGesture = (event) => {
      if (event.target.closest?.('#__jkflow_controls')) return; // no al usar nuestros botones
      if (!currentVideo()) return; // este frame ya no tiene video: no hacemos nada
      fsIntent = true;
      tryEnterFullscreen();
    };
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
  };

  // Reintento al cargar el video: si el user ya gesticuló pero el video todavía
  // no estaba listo, ahora sí lo intentamos (dentro de la ventana de activación).
  const retryFullscreen = () => {
    if (fsIntent && !isFullscreen()) tryEnterFullscreen();
  };

  // Guarda la config recibida (de push o pull) y la aplica.
  const setConfig = (message) => {
    activated = true;
    desiredSpeed = message.autoSpeed ? message.speed : null;
    autoplay = !!message.autoplay;
    autoSkipIntro = !!message.autoSkipIntro;
    autoFullscreen = !!message.autoFullscreen;
    skipSeconds = message.skipSeconds || 0;
    shortcuts = message.shortcuts || {};
    apply();
  };

  // PULL: pedirle la config al background. Resuelve la race de que el iframe del
  // proveedor (Desu, etc.) cargue después del push. El background solo responde
  // en pestañas de jkanime; en cualquier otra página la respuesta es null.
  const requestActivate = () => {
    chrome.runtime.sendMessage({ type: 'requestActivate' }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      setConfig(response);
    });
  };

  // Vuelve a fijar velocidad/autoplay cuando aparece un video nuevo o el player
  // toca la velocidad. Si todavía no estamos activados y aparece un <video>,
  // pedimos la config (el iframe acaba de montar el reproductor).
  new MutationObserver(() => {
    if (!activated && videos().length) requestActivate();
    apply();
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('ratechange', enforceSpeed, true);
  document.addEventListener('loadedmetadata', (event) => {
    if (!activated) requestActivate();
    enforceSpeed();
    tryAutoplay(event.target);
    maybeAutoSkip(event.target);
    retryFullscreen();
  }, true);
  document.addEventListener('canplay', (event) => {
    tryAutoplay(event.target);
    maybeAutoSkip(event.target);
    retryFullscreen();
  }, true);
  document.addEventListener('playing', (event) => {
    maybeAutoSkip(event.target);
    retryFullscreen();
  }, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'activate') {
      setConfig(message);
    } else if (message?.type === 'skip') {
      skip(message.seconds);
    }
  });

  // Arranque: pide la config de una. Si este frame no tiene video aún, los
  // listeners de arriba la volverán a pedir cuando el reproductor monte.
  requestActivate();
}
