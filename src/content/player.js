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
  let skipSeconds = 0; // segundos del opening (resueltos por serie en el background)
  let currentSettings = {}; // settings completos (para el panel de ajustes del player)
  let activated = false; // ya recibimos config (push o pull) al menos una vez
  // Nota: el auto-fullscreen lo maneja jkanime.js (top frame), que entra a
  // fullscreen sobre el CONTENEDOR del player para que persista entre capítulos.
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
  let panel = null; // panel de ajustes (lazy, dentro de #__jkflow_controls)
  let panelOpen = false;
  const panelInputs = {}; // refs a los controles del panel para sincronizarlos

  const sendCommand = (command) =>
    chrome.runtime.sendMessage({ type: 'command', command }, () => void chrome.runtime.lastError);

  const showControls = () => {
    if (!controls) return;
    controls.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (controls && !panelOpen) controls.style.opacity = '0';
    }, 2500);
  };

  const formatSpeed = (value) => `${Number(value).toFixed(2).replace(/\.?0+$/, '')}×`;

  // Escribe settings (desde el panel) a chrome.storage.sync. Esto dispara el
  // storage.onChanged del background, que re-emite el activate a TODOS los frames
  // → se aplica en vivo (velocidad, etc.) sin recargar.
  const saveSetting = (partial) => {
    try {
      chrome.storage.sync.set(partial, () => void chrome.runtime.lastError);
    } catch {
      /* contexto de extensión invalidado: ignorar */
    }
  };

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

    button.textContent = icon ? `${label} ${icon}` : label;

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

  // --- Panel de ajustes (⚙) -----------------------------------------------
  // Replica los controles clave del popup, dentro del reproductor. Cada cambio
  // se guarda en storage y se aplica en vivo (mismo camino que el popup).
  const panelRow = (labelText, control) => {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:9px 0;';
    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.cssText = 'flex:1;';
    row.append(label, control);
    return row;
  };

  const makeToggle = (key) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.style.cssText = 'width:17px;height:17px;accent-color:#e50914;cursor:pointer;';
    input.addEventListener('change', () => saveSetting({ [key]: input.checked }));
    panelInputs[key] = input;
    return input;
  };

  const togglePanel = () => {
    if (!panel) return;
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) {
      syncPanel();
      showControls();
    }
  };

  const buildPanel = () => {
    const p = document.createElement('div');
    p.id = '__jkflow_panel';
    p.style.cssText =
      'position:fixed;right:2.5%;bottom:18%;z-index:2147483647;width:266px;' +
      'background:rgba(18,18,18,.97);color:#fff;border:1px solid rgba(255,255,255,.12);' +
      'border-radius:12px;padding:13px 16px;box-shadow:0 10px 34px rgba(0,0,0,.6);' +
      'pointer-events:auto;display:none;' +
      "font:500 13px/1.35 'Netflix Sans','Helvetica Neue',Helvetica,Arial,system-ui,sans-serif;";

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;margin:0 0 6px;';
    const title = document.createElement('strong');
    title.textContent = 'Ajustes';
    title.style.cssText = 'font-size:14px;';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.title = 'Cerrar';
    close.style.cssText =
      'all:unset;cursor:pointer;color:rgba(255,255,255,.7);font-size:14px;padding:2px 6px;';
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
    });
    header.append(title, close);
    p.append(header);

    // Velocidad (slider 1×–2×, pasos de 0.05).
    const speedHead = document.createElement('div');
    speedHead.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;margin:10px 0 1px;';
    const speedLabel = document.createElement('span');
    speedLabel.textContent = 'Velocidad';
    const speedVal = document.createElement('span');
    speedVal.style.cssText = 'font-weight:700;font-variant-numeric:tabular-nums;';
    speedHead.append(speedLabel, speedVal);
    const speed = document.createElement('input');
    speed.type = 'range';
    speed.min = '1';
    speed.max = '2';
    speed.step = '0.05';
    speed.style.cssText = 'width:100%;accent-color:#e50914;cursor:pointer;margin:3px 0 6px;';
    speed.addEventListener('input', () => (speedVal.textContent = formatSpeed(speed.value)));
    speed.addEventListener('change', () => saveSetting({ playbackSpeed: Number(speed.value) }));
    panelInputs.playbackSpeed = speed;
    panelInputs.speedVal = speedVal;
    p.append(speedHead, speed);

    // Toggles.
    p.append(
      panelRow('Velocidad automática', makeToggle('autoSpeed')),
      panelRow('Reproducir automáticamente', makeToggle('autoplay')),
      panelRow('Saltar opening al empezar', makeToggle('autoSkipIntro')),
      panelRow('Pantalla completa automática', makeToggle('autoFullscreen')),
    );

    // Segundos de salto del opening.
    const skipNum = document.createElement('input');
    skipNum.type = 'number';
    skipNum.min = '1';
    skipNum.max = '600';
    skipNum.style.cssText = 'width:62px;padding:4px 6px;font:inherit;';
    skipNum.addEventListener('change', () => {
      const value = Number(skipNum.value);
      if (value >= 1) saveSetting({ skipSeconds: value });
    });
    panelInputs.skipSeconds = skipNum;
    p.append(panelRow('Saltar opening (seg)', skipNum));

    return p;
  };

  // Refleja currentSettings en los controles del panel. Setear .value/.checked
  // son props (no atributos) → no disparan el MutationObserver. Igual filtramos.
  const syncPanel = () => {
    if (!panel) return;
    const s = currentSettings;
    // Nunca sobre-escribir el control que el usuario está tocando (ej. el slider
    // mientras lo arrastra): lo dejaría "pegado" y no se movería.
    const busy = (input) => input === document.activeElement;
    const setVal = (input, value) => {
      if (input && !busy(input) && value != null && input.value !== String(value)) {
        input.value = String(value);
      }
    };
    const setChk = (input, value) => {
      if (input && !busy(input) && input.checked !== !!value) input.checked = !!value;
    };
    if (s.playbackSpeed != null) {
      setVal(panelInputs.playbackSpeed, s.playbackSpeed);
      const pretty = formatSpeed(s.playbackSpeed);
      // Guardar: textContent dispara el MutationObserver → escribir siempre = bucle.
      if (panelInputs.speedVal.textContent !== pretty) panelInputs.speedVal.textContent = pretty;
    }
    setChk(panelInputs.autoSpeed, s.autoSpeed);
    setChk(panelInputs.autoplay, s.autoplay);
    setChk(panelInputs.autoSkipIntro, s.autoSkipIntro);
    setChk(panelInputs.autoFullscreen, s.autoFullscreen);
    setVal(panelInputs.skipSeconds, s.skipSeconds);
  };

  // Botón de engranaje que abre/cierra el panel (va encima de "Siguiente").
  const makeGear = () => {
    const gear = document.createElement('button');
    gear.textContent = '⚙';
    gear.title = 'Ajustes';
    gear.style.cssText =
      `${BASE}justify-content:center;font-size:18px;line-height:1;color:#fff;` +
      'background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.25);padding:8px 11px;' +
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
    gear.addEventListener('mouseenter', () => {
      gear.style.background = 'rgba(229,9,20,.9)';
      gear.style.transform = 'scale(1.06)';
    });
    gear.addEventListener('mouseleave', () => {
      gear.style.background = 'rgba(0,0,0,.6)';
      gear.style.transform = 'scale(1)';
    });
    gear.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
    });
    return gear;
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
    // Cluster abajo-derecha: [ Saltar intro ]   [ ⚙ / SIGUIENTE ].
    controls.style.cssText =
      'position:fixed;right:2.5%;bottom:8%;z-index:2147483647;' +
      'display:flex;align-items:flex-end;gap:16px;pointer-events:none;opacity:0;transition:opacity .25s ease;';

    // Columna derecha: el engranaje encima del botón "Siguiente".
    const nextColumn = document.createElement('div');
    nextColumn.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:8px;';
    nextColumn.append(
      makeGear(),
      makeButton({
        icon: '▶',
        label: 'Siguiente',
        command: 'next-episode',
        title: 'Siguiente capítulo',
        primary: true,
      }),
    );

    panel = buildPanel();
    controls.append(
      makeButton({ label: 'Saltar intro', command: 'skip-intro', title: 'Saltar opening' }),
      nextColumn,
      panel,
    );
    placeControls();
    document.addEventListener('mousemove', showControls, true);
    showControls();
  };

  // Al entrar/salir de fullscreen, reubica los botones dentro del elemento
  // fullscreen para que sigan visibles.
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

  // Guarda la config recibida (de push o pull) y la aplica.
  const setConfig = (message) => {
    activated = true;
    desiredSpeed = message.autoSpeed ? message.speed : null;
    autoplay = !!message.autoplay;
    autoSkipIntro = !!message.autoSkipIntro;
    skipSeconds = message.skipSeconds || 0;
    if (message.settings) currentSettings = message.settings;
    apply();
    syncPanel(); // refleja cambios externos en el panel (no en cada mutación: aquí solo en activate)
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
  }, true);
  document.addEventListener('canplay', (event) => {
    tryAutoplay(event.target);
    maybeAutoSkip(event.target);
  }, true);
  document.addEventListener('playing', (event) => maybeAutoSkip(event.target), true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'activate') {
      setConfig(message);
    } else if (message?.type === 'skip') {
      skip(message.seconds);
    }
  });

  // Tecla F: TOGGLE de pantalla completa del reproductor (este frame es el que
  // tiene el foco mientras ves el video, así que aquí captura la F). Cortamos la
  // propagación para que el handler de F NATIVO del proveedor no se dispare y
  // "vuelva a entrar" al salir (por eso antes entraba pero no salía).
  const isTyping = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'f' && event.key !== 'F') return;
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      } else {
        const el = document.documentElement;
        const request = el.requestFullscreen || el.webkitRequestFullscreen;
        if (request) {
          try {
            const result = request.call(el);
            if (result && result.catch) result.catch(() => {});
          } catch {
            /* sin gesto válido */
          }
        }
      }
    },
    true,
  );

  // Arranque: pide la config. Si este frame no tiene video aún, los listeners de
  // arriba la volverán a pedir cuando el reproductor monte.
  requestActivate();
}
