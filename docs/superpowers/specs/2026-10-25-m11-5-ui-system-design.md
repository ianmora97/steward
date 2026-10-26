# Sistema de UI estándar (M11.5): diseño

Rama `milestone-11-5-ui-system`. Va entre M11 (Redis, ya mergeado en #13) y M12 (observabilidad); no renumera la hoja de ruta. Sin pruebas automatizadas; cada paso termina con `npm run check`.

## Objetivo

La UI es CSS plano repartido en 14 hojas, cada feature con su propio prefijo (`dp*`, `rd*`, `mg*`, `dk*`, `ssh*`…) y los mismos patrones repetidos. No hay estándar de espaciado, tamaños, nombres de badge ni feedback. Este milestone crea **un sistema de diseño propio, sin framework**, y migra todas las pantallas a él **sin cambiar su estructura ni su comportamiento**.

Éxito = (1) un único vocabulario de tokens y componentes; (2) toda acción da feedback (loader, toast); (3) toda carga de vista muestra skeleton; (4) transiciones limpias entre interacciones y pantallas; (5) la app se reescala a gusto del usuario y sigue usable en ventana estrecha; (6) Recent activity muestra 5 y el resto va en un modal.

## Estado de partida (medido)

- 6.5k líneas de CSS, 24 variables en `:root`, 106 colores hex sueltos, 1244 valores en `px`, 3 `@media` por ancho de ventana, 4 bloques `prefers-reduced-motion` repetidos.
- 312 `<button>` sin componente; texto de carga suelto ("Saving…" ~32 veces, "Loading…" ~30); sin spinner, skeleton ni toast; 94 setters locales de `busy`/`saving`/`loading`; un "Working…" global en la cabecera.
- Badges con 7 nombres: `status-pill`, `pill`/`pill--dim`, `chip` (14 usos), `svcpill`, `mgtypechip`, `sshitem__badge`, `rdchip__badge`.
- Ya existen y se conservan: `Pill` (pasa a `Badge`), `Modal`, `ConfirmDialog`, `EmptyState`, `ErrorBanner`, `Icon`, `useExitAnimation`, `DateTimePicker`.
- Keyframes solo en `shell.css`.

## Decisiones tomadas con el usuario

| Tema | Decisión |
| --- | --- |
| Framework | Ninguno. CSS propio con tokens (descartados Tailwind, MUI, Bootstrap). |
| Alcance | Toda la UI, pantalla por pantalla, un commit por paso. |
| Estructura | Se mantiene la de cada pantalla; solo se estandarizan elementos y se reutilizan componentes. |
| Nombre de badges | `Badge` (no interactivo: tono + icono opcional). `Chip` solo para filtros seleccionables o removibles. Desaparecen `pill`, `status-pill`, `svcpill` y el resto. |
| Barras de cabecera | La barra de conexión Redis (dot de estado, host en mono, meta tenue, badge, iconos de acción a la derecha) es la **referencia** y pasa a `ConnectionBar`. |
| Recent activity | 5 últimas entradas; "View all (N)" abre un `Modal` con la lista completa. |
| Escalado | Zoom de Electron (80–150 %), no reescritura masiva de `px`. |

## 1. Cimientos (`src/renderer/src/styles/`)

Se importan una sola vez desde `main.tsx`.

- **`tokens.css`**, única fuente de verdad:
  - Colores: los actuales más un set semántico por tono (`success`, `warning`, `danger`, `info`, `merged`, `neutral`), cada uno con fondo, borde y texto.
  - Espaciado de 4 px: `--space-1…8` = 4, 8, 12, 16, 20, 24, 32, 48. Separación estándar: `--space-3` (12) dentro de una fila, `--space-4` (16) entre bloques.
  - Radios: `--radius-sm 5`, `--radius-md 8`, `--radius-lg 12`, `--radius-pill`.
  - Tipografía: tamaños `xs…xl`, pesos y una fuente mono única.
  - Controles: altura `sm 28`, `md 32`, `lg 38`; tamaños de icono.
  - Capas: z-index con nombre (`dropdown`, `modal`, `toast`).
  - Movimiento: `--dur-fast 120ms`, `--dur-base 180ms`, `--dur-slow 240ms`, `--ease-out`, `--ease-in-out`.
- **`base.css`**: reset, tipografía, scrollbars, anillo de foco y **un único** bloque `prefers-reduced-motion` que pone los `--dur-*` a 0 y deja los shimmers estáticos.
- **`motion.css`**: todos los keyframes (`fade`, `slide`, `dialog`, `spin`, `shimmer`, `toast-in/out`) y la clase `.enter`.
- Durante la migración, `tokens.css` mantiene **alias** de las variables viejas (`--bg-raised`, `--radius`…); se borran en el paso final.
- Los `px` sueltos pasan a tokens al migrar cada pantalla, no en una conversión masiva.

## 2. Componentes (`src/renderer/src/components/`, `.tsx` + `.css` cada uno)

| Componente | Reemplaza | API |
| --- | --- | --- |
| `Button` | los 312 `<button>` con `button button--*` | `variant` (`default`/`primary`/`danger`/`ghost`), `size` (`sm`/`md`), `loading`, `loadingLabel`, `icon`. Con `loading` se desactiva, muestra spinner y cambia el texto. |
| `IconButton` | `.iconbutton` y sus variantes | `icon`, `label` (obligatorio → `aria-label` y `title`), `tone`. |
| `Badge` | `Pill`, `.chip`, `.pill`, `svcpill`, `mgtypechip`, `sshitem__badge`, `rdchip__badge` | `tone`, `icon`, `size`. Solo informa. |
| `Chip` | filtros y pestañas pequeñas | `selected`, `onRemove` opcional. |
| `Spinner` | el `pill-spin` suelto | `size`. |
| `Skeleton` | los textos "Loading…" | `line`, `block`, `row`, `card`, con shimmer. |
| `Card` | `.panel`, `.dpsection`, `.dpsummary`, tarjetas de Overview | `Card`, `Card.Header`, `Card.Body`, `Card.Footer`. |
| `PageHeader` | `workspace__header`, `dppage__head`, `sshpage__tag` | `title`, `subtitle`, `actions`. |
| `ConnectionBar` | la barra repetida en Redis (`rdconn`), Mongo (`mgconnbar`) y Docker (`dkbar`) | `status`, `title` (mono), `meta`, `badges`, `actions`. |
| `ListRow` | `dpitem`, `dkrow`, `activity__item`, `sshitem` | icono, título, meta, badges y acciones, con altura estándar. |
| `Field` | `.field`, `.field__label`, `.field__input` | `label`, `hint`, `error`, `required`; el control va de hijo. |
| `Toolbar` | filas de botones con `flex-wrap` | espaciado y alineación estándar. |
| `EmptyState` | (existe) | se amplía con `icon` y `action`. |

`Modal`, `ConfirmDialog`, `ErrorBanner`, `Icon` y `DateTimePicker` se mantienen y se re-estilan con tokens.

Reglas fijas: control `md` = 32 px y `sm` = 28 px; la etiqueta de un botón nunca se parte (`nowrap`): si no cabe, pasa a `IconButton` con tooltip; las notas (`card__hint`) en filas centradas llevan `margin: 0`; todo campo de fecha/hora sigue usando `DateTimePicker`.

## 3. Feedback al usuario

**Toasts** (`stores/toast.store.ts` + `<ToastViewport />` montado una vez en `App.tsx`)
- `toast.success('Connection saved')`, `toast.error(…)`, `toast.info(…)`.
- Abajo a la derecha, hasta 4 apilados. Éxito 3 s, información 4 s, error persistente hasta cerrar. Pausa al pasar el ratón, `aria-live`, entrada/salida con tokens.
- Texto: objeto + verbo en pasado ("Connection saved", "Key deleted", "Collection added", "Copied").
- Disparan toast las acciones con efecto persistente o remoto: guardar, añadir, borrar, renombrar, conectar, desconectar, importar, exportar, desplegar, acciones de Docker. No lo disparan las de alta frecuencia que ya se ven (stage/unstage, refrescar, seleccionar).

**`useAction`** (`components/useAction.ts`)
```ts
const save = useAction(saveConnection, { success: 'Connection saved' });
<Button loading={save.pending} loadingLabel="Saving…" onClick={save.run}>Save</Button>
```
Maneja `StewardResult`: en fallo muestra toast de error (o `ErrorBanner` en línea si el formulario lo pide); evita el doble clic; reemplaza los setters locales pantalla por pantalla. El "Working…" global pasa a una barra indeterminada de 2 px bajo la cabecera.

**Tres niveles de carga**
1. Primera carga de una vista: `Skeleton` con la forma del contenido; solo si tarda más de 150 ms (sin parpadeo).
2. Refresco con datos visibles: el contenido no se toca y el icono de refrescar gira.
3. Acción del usuario: `Button` con spinner y texto ("Saving…", "Deleting…", "Connecting…").

## 4. Transiciones

- Cambio de pestaña: `.enter` = fade + deslizamiento de 8 px en `--dur-base`.
- Hover/press de botones, filas y badges: `--dur-fast`; el press hace `scale(.98)`.
- Modales y menús: entrada y salida con tokens; `EXIT_MS` se alinea con `--dur-base` (hoy 160 ms) y lo documenta.
- Secciones plegables: `grid-template-rows 0fr → 1fr`, sin medir alturas con JS.
- Filas nuevas en listas y toasts: fade.
- `prefers-reduced-motion`: un solo bloque (ver §1).

## 5. Responsive y zoom

- El cuerpo del workspace es contenedor (`container-type: inline-size`). Tres estados por ancho de contenedor: compacto (< 720 px), normal (720–1100), ancho (> 1100); reemplazan los 3 `@media` actuales. Los valores van fijos y documentados (un `@container` no admite variables CSS).
- La ventana mínima es 940×600 (`src/main/index.ts`); con zoom 150 % son ~627 px CSS, así que la vista compacta debe funcionar **desde ~620 px**.
- Rejillas con `repeat(auto-fit, minmax(…, 1fr))` donde se pueda; filas de acciones con `flex-wrap`.
- **Zoom**:
  - Canal nuevo `ui:setZoom` (schema Zod con enum 80/90/100/110/125/150; handler en main; binding en el preload; los tres o no existe) y lectura del valor actual.
  - Main aplica `webContents.setZoomFactor`, lo guarda en SQLite (preferencia local, sin secretos; tabla `app_settings` que ya existe, clave `ui.zoom`; sin migración nueva) y lo restaura al crear la ventana.
  - Ctrl `+` / `−` / `0` se capturan en main. Settings → General gana un selector segmentado con los mismos valores.
  - El terminal (xterm) se reajusta con el resize que dispara el zoom; se comprueba en la migración de Terminal.

## 6. Overview

- Dos columnas (proyectos + actividad) solo en ancho normal o mayor; una columna en compacto. Se corrige el solapamiento visto en la captura (la columna de actividad pisa las tarjetas); la causa se localiza al implementar.
- **Recent activity**: 5 últimas entradas con `ListRow`; botón **"View all (N)"** bajo la lista abre un `Modal` con la lista completa y scroll. Clic en una entrada abre su pestaña y cierra el modal. Cargando → `Skeleton`; sin datos → `EmptyState`. El límite de 5 es del cliente; el servicio `overview.activity()` ya devuelve la lista completa.
- Tarjetas de proyecto y de estadísticas con `Card`, misma altura y espaciado; los servicios son `Badge`; "Nothing configured yet" pasa a texto de estado vacío sin borde.

## 7. Orden de migración

Un commit por paso (Conventional Commits, CHANGELOG bajo `Unreleased` con etiqueta del milestone, `npm run check` verde antes de cada uno):

1. Tokens, base, motion y alias.
2. Primitivas, `ToastViewport`, `useAction`, barra de progreso global y canal de zoom.
3. Overview.
4. Shell: sidebar, barra de pestañas, cabecera de workspace y Settings (con selector de zoom).
5. Git y GitHub.
6. Terminal y SSH.
7. Deployments.
8. Docker.
9. MongoDB.
10. Redis.
11. Limpieza: borrar alias, CSS muerto y `reduced-motion` duplicados; buscar nombres de clase viejos; `graphify update .`; notas del vault; README y CHANGELOG al día; push y PR hacia `master`.

## Seguridad y límites

- Solo cambia el renderer, salvo el canal de zoom y su preferencia guardada. Sin secretos nuevos, sin red, sin procesos hijos.
- `ui:setZoom` valida con Zod un enum cerrado; ningún valor libre llega a `setZoomFactor`.
- Fuera de alcance: tema claro, funciones nuevas, cambios de comportamiento, tests automatizados.
- Riesgo principal: regresiones visuales al migrar 14 hojas. Se mitiga con migración por capas, alias temporales y un commit por pantalla para poder localizar y revertir.

## Pruebas manuales (las hace el usuario; se copian a `vault/steward/Estado.md`)

1. Ctrl `+` / `−` / `0` y el selector de Settings → General cambian el zoom; sobrevive a reiniciar; el terminal sigue ajustado.
2. Reducir la ventana a 940 px (y con zoom 150 %): ninguna pantalla desborda ni corta botones; las filas de acciones hacen wrap.
3. Guardar, añadir, borrar, conectar y desplegar muestran toast; un error queda hasta cerrarlo.
4. En una acción lenta, el botón muestra spinner y su texto ("Saving…", "Deleting…"), y no admite doble clic.
5. Recargar una vista muestra skeleton (no texto "Loading…"); un refresco con datos no vacía la vista.
6. Overview: 5 entradas en Recent activity, "View all" abre el modal con todas, clic en una abre su pestaña; sin solapamientos a ningún ancho.
7. Cambiar de pestaña y abrir/cerrar modales y toasts se ve suave; con "Animation effects" desactivado en Windows no hay movimiento.
8. Recorrer Git, Terminal, SSH, Deployments, Docker, MongoDB y Redis: mismos espaciados, alturas de control y badges en todas.
