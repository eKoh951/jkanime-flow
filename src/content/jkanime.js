// Content script del TOP frame de jkanime.net. Responsabilidades:
//   1. Selecciona el servidor preferido al cargar.
//   2. Navega a sig/ant capítulo SIN recargar la página ("in-place"): trae el
//      HTML del capítulo, extrae el token del player y cambia el src del MISMO
//      iframe. Como el iframe no se destruye, el fullscreen del contenedor NO se
//      pierde → auto-fullscreen real entre capítulos.
//   3. Fullscreen sobre el CONTENEDOR del player (no el iframe pelado), que
//      sobrevive al cambio de src. Se entra con el primer clic del usuario.
//   4. Avisa al background para aplicar velocidad/ajustes en el frame del player.

if (window.top === window) {
  (async () => {
    const settings = await jkflowGetSettings();
    const PLAYER = 'iframe.player_conte';

    let nextHref = null;
    let prevHref = null;
    let autoFsDone = false;
    let shim = null;

    const playerIframe = () => document.querySelector(PLAYER);
    const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

    // --- Servidores ---------------------------------------------------------
    const serverTabs = () => [...document.querySelectorAll('a.servers')];
    const selectServer = (name) => {
      const target = serverTabs().find(
        (tab) => tab.textContent.trim().toLowerCase() === name.toLowerCase(),
      );
      if (target && !target.classList.contains('active')) target.click();
    };

    // Índice del servidor preferido (para elegir video[idx] del HTML traído).
    const preferredServerIndex = (doc) => {
      if (!settings.autoSelectServer || !settings.preferredServer) return 0;
      const tabs = [...doc.querySelectorAll('a.servers')];
      const tab = tabs.find(
        (t) => t.textContent.trim().toLowerCase() === settings.preferredServer.toLowerCase(),
      );
      const id = tab && tab.getAttribute('data-id');
      return id != null ? Number(id) : 0;
    };

    // --- Navegación in-place ------------------------------------------------
    const findNavHref = (root, regex) => {
      const link = [...root.querySelectorAll('a')].find((a) => regex.test(a.textContent || ''));
      return link ? link.getAttribute('href') : null;
    };
    const refreshNavFrom = (root) => {
      nextHref = findNavHref(root, /siguiente/i) || nextHref;
      prevHref = findNavHref(root, /anterior/i) || prevHref;
    };

    // Extrae el src del player del servidor `idx` del HTML (array video[] en un
    // <script>). Cae a video[0] si no encuentra el preferido.
    const extractPlayerSrc = (html, idx) => {
      const at = (i) => {
        const m = html.match(new RegExp(`video\\[${i}\\]\\s*=\\s*'[^']*?src="([^"]+)"`));
        return m ? m[1] : null;
      };
      return at(idx) || at(0);
    };

    const activatePlayers = () => chrome.runtime.sendMessage({ type: 'activatePlayers' });

    // Carga un capítulo SIN recargar: trae su HTML, cambia el src del mismo iframe
    // (mantiene el fullscreen) y actualiza la URL. Si algo falla, navegación normal.
    const navigateInPlace = async (href) => {
      const iframe = playerIframe();
      if (!iframe || !href) return false;
      try {
        const res = await fetch(href, { credentials: 'include' });
        if (!res.ok) return false;
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const src = extractPlayerSrc(html, preferredServerIndex(doc));
        if (!src) return false;
        iframe.src = src;
        history.pushState({}, '', href);
        refreshNavFrom(doc);
        if (doc.title) document.title = doc.title;
        setTimeout(activatePlayers, 1500);
        return true;
      } catch {
        return false;
      }
    };

    const goNext = async () => {
      if (!(await navigateInPlace(nextHref)) && nextHref) window.location.href = nextHref;
    };
    const goPrev = async () => {
      if (!(await navigateInPlace(prevHref)) && prevHref) window.location.href = prevHref;
    };

    // --- Fullscreen del IFRAME del player (no su contenedor) ----------------
    // Llevar a fullscreen el iframe hace que su CONTENIDO (el player) llene la
    // pantalla. Antes usábamos el contenedor padre, que se hacía fullscreen pero
    // dejaba el player chico dentro. El iframe persiste al cambiar de capítulo.
    const enterFullscreen = () => {
      const iframe = playerIframe();
      if (!iframe || isFullscreen()) return;
      const request = iframe.requestFullscreen || iframe.webkitRequestFullscreen;
      if (!request) return;
      try {
        const result = request.call(iframe, { navigationUI: 'hide' });
        if (result && result.catch) result.catch(() => {});
      } catch {
        /* sin gesto válido */
      }
    };

    // Mantener el reproductor "seleccionado": al enfocar el iframe, las teclas
    // (la F) van al frame del player, no al top frame de jkanime.
    const focusPlayer = () => {
      const iframe = playerIframe();
      if (iframe) {
        try {
          iframe.focus({ preventScroll: true });
        } catch {
          /* noop */
        }
      }
    };

    // Capa transparente sobre el player que captura el PRIMER clic (gesto válido
    // del TOP frame, lo único que puede llevar el CONTENEDOR a fullscreen) y se
    // quita. Solo con auto-fullscreen activo; el autoplay igual reproduce el video.
    const positionShim = () => {
      const iframe = playerIframe();
      if (!shim || !iframe) return;
      const r = iframe.getBoundingClientRect();
      shim.style.left = `${r.left}px`;
      shim.style.top = `${r.top}px`;
      shim.style.width = `${r.width}px`;
      shim.style.height = `${r.height}px`;
    };
    const removeShim = () => {
      if (shim) shim.remove();
      shim = null;
    };
    const armFullscreenShim = () => {
      if (autoFsDone || shim || !settings.autoFullscreen || !playerIframe()) return;
      shim = document.createElement('div');
      shim.id = '__jkflow_fsshim';
      shim.style.cssText =
        'position:fixed;z-index:2147483646;cursor:pointer;background:transparent;';
      positionShim();
      shim.addEventListener('click', () => {
        autoFsDone = true;
        enterFullscreen();
        removeShim();
      });
      document.body.appendChild(shim);
      window.addEventListener('scroll', positionShim, true);
      window.addEventListener('resize', positionShim, true);
      setInterval(positionShim, 1000);
    };

    document.addEventListener('fullscreenchange', () => {
      if (isFullscreen()) autoFsDone = true;
    });

    // Tecla F desde el top frame (cuando el foco no está en el iframe del video):
    // TOGGLE de fullscreen del contenedor (el que persiste entre capítulos).
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'f' && event.key !== 'F') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const t = event.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (isFullscreen()) {
          (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
        } else {
          autoFsDone = true;
          enterFullscreen();
        }
      },
      true,
    );

    // --- Mensajes (atajos + botones del player) -----------------------------
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'next') goNext();
      else if (message?.type === 'prev') goPrev();
    });

    document.addEventListener('click', (event) => {
      const target = event.target;
      // Cambiar de servidor recarga el iframe interno: re-aplica ajustes.
      if (target.closest('a.servers')) setTimeout(activatePlayers, 1500);
      // Tras clickear FUERA del player (links, fondo, etc.), devolvemos el foco al
      // reproductor para que la tecla F siga yendo al player y no al top frame.
      // Excepto si clickeaste un campo de texto, donde sí quieres escribir.
      if (!target.closest('input,textarea,select,[contenteditable="true"]')) {
        setTimeout(focusPlayer, 0);
      }
    });

    // --- Init ---------------------------------------------------------------
    refreshNavFrom(document);
    if (settings.autoSelectServer && settings.preferredServer) selectServer(settings.preferredServer);
    armFullscreenShim();
    setTimeout(activatePlayers, 1500);

    // Enfoca el player en cuanto exista (jkanime lo crea con JS), para que la
    // tecla F funcione desde el principio sin tener que clickear el video.
    const focusTries = setInterval(() => {
      if (playerIframe()) {
        focusPlayer();
        clearInterval(focusTries);
      }
    }, 400);
    setTimeout(() => clearInterval(focusTries), 10000);
  })();
}
