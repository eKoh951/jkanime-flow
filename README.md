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

## Instalar (modo desarrollador)

1. Abre `chrome://extensions` (o `edge://extensions`).
2. Activa **Modo de desarrollador**.
3. **Cargar descomprimida** → selecciona esta carpeta (`jkanime-flow/`).
4. Abre un capítulo en jkanime y prueba.

## Atajos por defecto

| Acción            | Tecla     |
| ----------------- | --------- |
| Siguiente capítulo| `Alt + .` |
| Capítulo anterior | `Alt + ,` |
| Saltar opening    | `Alt + S` |

Se reconfiguran en `chrome://extensions/shortcuts`.

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

## Roadmap

- [ ] Botón flotante de "Saltar opening" sobre el player (además del atajo).
- [ ] Auto-avanzar al terminar el capítulo.
- [ ] Recordar la velocidad ajustada manualmente y proponerla por serie.
- [ ] Iconos de la extensión.
