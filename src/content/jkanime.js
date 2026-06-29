// Content script del TOP frame de jkanime.net. Tres responsabilidades:
//   1. Seleccionar el servidor preferido al cargar (ej. Streamwish).
//   2. Navegar a siguiente/anterior capítulo (atajos enrutados por el background).
//   3. Avisar al background para que aplique la velocidad en el frame del player.
//
// Se restringe al top frame: el frame del jkplayer comparte origen (jkanime.net)
// y dispararía esta lógica de más sin necesidad.

if (window.top === window) {
  (async () => {
    const settings = await jkflowGetSettings();

    // --- Servidores ---------------------------------------------------------
    const serverTabs = () => [...document.querySelectorAll('a.servers.btn-show')];

    const selectServer = (name) => {
      const target = serverTabs().find(
        (tab) => tab.textContent.trim().toLowerCase() === name.toLowerCase(),
      );
      if (target && !target.classList.contains('active')) target.click();
    };

    // --- Navegación entre capítulos ----------------------------------------
    // jkanime ya pinta links "Siguiente"/"Anterior"; clickearlos respeta los
    // huecos de numeración mejor que construir la URL a mano.
    const navLink = (regex) =>
      [...document.querySelectorAll('a')].find((link) => regex.test(link.textContent));

    const goNext = () => navLink(/siguiente/i)?.click();
    const goPrev = () => navLink(/anterior/i)?.click();

    // --- Activar la velocidad en el frame del player -----------------------
    const activatePlayers = () => chrome.runtime.sendMessage({ type: 'activatePlayers' });

    // Atajos que llegan del background.
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'next') goNext();
      else if (message?.type === 'prev') goPrev();
    });

    // Cambiar de servidor (auto o manual) carga un iframe nuevo: re-aplica la
    // velocidad un momento después de que el nuevo player monte.
    document.addEventListener('click', (event) => {
      if (event.target.closest('a.servers.btn-show')) setTimeout(activatePlayers, 1500);
    });

    if (settings.autoSelectServer && settings.preferredServer) {
      selectServer(settings.preferredServer);
    }
    // Aplica la velocidad al servidor que haya quedado activo (el preferido o,
    // si autoSelect está apagado, el que jkanime trae por defecto).
    setTimeout(activatePlayers, 1500);
  })();
}
