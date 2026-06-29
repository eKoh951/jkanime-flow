# JKAnime Flow

Extensión de navegador (Manifest V3) que le da atajos estilo Netflix a
[jkanime.net](https://jkanime.net):

- **Servidor por defecto** — al abrir un capítulo selecciona tu servidor preferido
  (ej. Streamwish) automáticamente.
- **Siguiente / anterior capítulo** con atajo de teclado.
- **Saltar opening** — salta una duración fija hacia adelante (el opening puede
  empezar en distinto minuto, pero su duración es constante). Configurable global
  y por serie.
- **Velocidad automática** — fija tu velocidad preferida (ej. 1.25x) en cada
  capítulo, sin tener que ponerla a mano.
- **Autoplay** — da play en cuanto el reproductor tiene el video listo. Si el
  navegador bloquea el autoplay con sonido, arranca en silencio.
- **Saltar opening automático** (opcional) — salta el opening solo al empezar el
  capítulo, sin pulsar nada.
- **Pantalla completa automática** (opcional) — entra a fullscreen en tu primer
  clic/tecla sobre el capítulo. (Los navegadores no permiten fullscreen sin un
  gesto del usuario, por eso se arma al primer toque.)

## Instalar (modo desarrollador)

1. Abre `chrome://extensions` (o `edge://extensions`).
2. Activa **Modo de desarrollador**.
3. **Cargar descomprimida** → selecciona esta carpeta (`jkanime-flow/`).
4. Abre un capítulo en jkanime y prueba.

## Atajos por defecto

| Acción            | Windows / Linux       | macOS         |
| ----------------- | --------------------- | ------------- |
| Siguiente capítulo| `Ctrl + ⇧ + →`        | `⌘ + ⇧ + →`   |
| Capítulo anterior | `Ctrl + ⇧ + ←`        | `⌘ + ⇧ + ←`   |
| Saltar opening    | `Ctrl + ⇧ + Espacio`  | `⌘ + ⇧ + Espacio` |

También hay **botones flotantes** sobre el reproductor (Anterior · Saltar intro ·
Siguiente) que aparecen al mover el mouse.

Se reconfiguran en `chrome://extensions/shortcuts` (en Brave,
`brave://extensions/shortcuts`). Si un atajo aparece vacío tras instalar,
asígnalo ahí manualmente.

## Cómo está armado

| Pieza                     | Rol                                                                    |
| ------------------------- | --------------------------------------------------------------------- |
| `src/content/jkanime.js`  | Top frame de jkanime: elige servidor, navega capítulos.               |
| `src/content/player.js`   | Corre en todos los frames; controla el `<video>` (velocidad y salto). |
| `src/background.js`       | Traduce atajos en mensajes y reenvía los settings al player.          |
| `src/popup/`              | UI de preferencias (auto-guarda).                                     |
| `src/lib/defaults.js`     | Defaults y helpers compartidos.                                       |

### Por qué `player.js` corre en `<all_urls>`

El `<video>` no está en la página de jkanime: vive en un iframe anidado de un
proveedor con **dominio rotativo** (`sfastwish.com`, etc.), imposible de enumerar
de antemano. Por eso `player.js` se inyecta en todos los frames, pero queda
**inerte** hasta que el background lo activa, cosa que solo ocurre en pestañas de
jkanime. En cualquier otra página no hace nada.

## Pruebas (harness agéntico)

Hay un harness que carga la extensión **real** en Brave y sirve una página
*mock* de jkanime por intercepción de red (para que la URL sea `jkanime.net` y
se inyecten los content scripts). Hace clics, lee consolas, corre asserts y saca
un screenshot — sin depender del sitio real ni descargar navegador.

```bash
npm install        # una vez (instala puppeteer-core; usa tu Brave instalado)
npm test           # corre test/harness.js (headless)
HEADED=1 npm test  # con ventana visible
```

- Mocks: `test/mock/` · screenshot de evidencia: `test/.artifacts/run.png`.
- Cubre, entre otros, una **regresión**: que con auto-fullscreen ON, un clic en
  el top frame no sea secuestrado (bug que tenía la barra de botones).

## Roadmap

- [ ] Botón flotante de "Saltar opening" sobre el player (además del atajo).
- [ ] Auto-avanzar al terminar el capítulo.
- [ ] Recordar la velocidad ajustada manualmente y proponerla por serie.
- [ ] Iconos de la extensión.
