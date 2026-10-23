# M4 — Terminal: diseño

Fecha: 2026-10-23 · Rama: `milestone-4-terminal`

## Objetivo
Pestaña Terminal por proyecto con shells interactivos reales (`node-pty` + `xterm.js`), sin abrir ninguna vía genérica de ejecución de comandos desde el renderer.

## Decisiones acordadas
- Las sesiones **siguen vivas** al cambiar de pestaña o proyecto. Mueren al cerrar la pestaña de la sesión o al salir de la app. No sobreviven a un reinicio.
- Shell **configurable por proyecto** (ejecutable + args). Sin variables de entorno en DB (regla de secretos). Sin config: autodetección (pwsh → powershell → cmd en Windows; `$SHELL` en Unix).
- cwd: el usuario elige un repo del proyecto; main resuelve la ruta. El renderer nunca envía cwd ni comando.
- `executions`: **una fila por sesión** (`kind='local_command'`, `context='local'`). Salida a archivo log con tope; ring en memoria para repintar. Aviso de truncado en la UI.
- Tope de log: 5 MB por sesión. Máximo de sesiones simultáneas: 8. (Constantes en un solo sitio.)

## Alcance fuera de M4
SSH (M5), persistencia tras reinicio, una fila por comando tecleado, env por proyecto, búsqueda dentro del scrollback.

## Riesgo previo: módulo nativo
`node-pty` es nativo. Primera tarea del plan: instalarlo, comprobar que carga bajo Electron 45 en Windows (ConPTY) y configurar el rebuild en `electron-builder` (`asarUnpack` para el binario). Si no carga, se para y se replantea antes de seguir.

## Main — `src/main/services/terminal.service.ts`
Mapa `sessionId → { pty, ring, executionId, logStream, truncated }`.

- **create**(projectId, repositoryId): valida con Zod, resuelve repo y cwd (pasa por `security/` de rutas), resuelve shell (config del proyecto o autodetectado), comprueba el máximo de sesiones, inserta la fila `executions` en `running`, lanza `node-pty.spawn(exe, args, { cwd, cols, rows })`. Ejecutable más array de args, nunca `shell: true`.
- **write**(sessionId, data): reenvía pulsaciones a una sesión existente. No crea procesos.
- **resize**(sessionId, cols, rows): límites enteros acotados.
- **close**(sessionId): mata el árbol de procesos, cierra el log y la fila.
- **attach**(sessionId): devuelve el ring para repintar xterm.
- **list**(projectId): sesiones vivas y muertas aún visibles, con `truncated`.
- Al terminar el proceso: `status` (`succeeded` si exit 0, `failed` si no, `cancelled` si fue `close`), `exit_code`, `duration_ms`, `finished_at`. La sesión queda visible con su exit code hasta cerrarla.
- `before-quit`: mata todas las sesiones y cierra sus filas.
- Salida: cada chunk pasa por `redact()` antes de escribirse al log. Ring en memoria de ~1 MB. Pasado el tope de 5 MB se deja de escribir y se marca `truncated`; el pty sigue vivo y el ring sigue rodando.
- Errores esperados como `StewardServiceError` con código (shell inexistente, límite de sesiones, repo no encontrado). Lo inesperado se registra en main y se devuelve genérico.

## IPC
Cada capacidad = canal en `src/shared/types/ipc.ts` + handler en `src/main/ipc/handlers.ts` + binding en `src/preload/index.ts` + schema en `src/shared/schemas/terminal.ts`.

- Invoke: `terminalCreate`, `terminalWrite`, `terminalResize`, `terminalClose`, `terminalList`, `terminalAttach`, `terminalGetSettings`, `terminalSetSettings`.
- Push main→renderer (primer uso de eventos): `onTerminalData(sessionId, data)` y `onTerminalExit(sessionId, exitCode)`. Canales declarados, el preload devuelve la función de desuscripción y expone solo el callback (nunca el `event` de Electron). Se envía solo a la ventana principal.
- Sin `invoke(channel, payload)` ni `runCommand(string)`.

## Datos — migración nueva (solo hacia adelante)
`project_terminal_settings(project_id PK FK, shell_path TEXT NULL, shell_args_json TEXT NOT NULL DEFAULT '[]', updated_at)`.
`shell_path`: ruta absoluta a un archivo existente; validada en main al guardar y otra vez al lanzar. El `executions.command` guarda el shell usado y `args_json` los args.

## Renderer — `src/renderer/features/terminal/`
- Store Zustand: sesiones por proyecto y sesión activa.
- Sub-pestañas de sesión, botón nueva (con selector de repo), cerrar.
- `xterm.js` + `@xterm/addon-fit`; `ResizeObserver` → `terminalResize`.
- Al montar una sesión viva: `terminalAttach` y se escribe el ring en xterm; después se suscribe a `onTerminalData`.
- Banner de truncado cuando `truncated`. Estado de sesión finalizada con exit code.
- Panel de ajustes del shell por proyecto, con "Restaurar autodetectado".
- La pestaña `terminal` ya existe en `tabKeySchema` y `BUILTIN_TAB_KEYS`; solo hay que conectar la vista.

## Dependencias nuevas
`node-pty`, `@xterm/xterm`, `@xterm/addon-fit`.

## Documentación a actualizar al terminar
`README.md`, `CHANGELOG.md` (Unreleased, etiqueta M4), `vault/steward/{Proyecto,Decisiones,Estado}.md`, grafo (`graphify update .`).

## Verificación
Estática: `npm run check`. Manual (usuario):
1. Abrir shell con el cwd del repo elegido.
2. Redimensionar la ventana y comprobar que el tamaño del terminal cambia (`$Host.UI.RawUI.WindowSize` / `stty size`).
3. Cambiar de pestaña y de proyecto, volver: la sesión sigue viva con su historial.
4. Comando que inunde la salida: la UI avisa del truncado y la memoria no crece sin límite.
5. Cerrar la pestaña de sesión: comprobar por PID que el proceso murió (incluidos hijos).
6. Cambiar el shell del proyecto y abrir sesión nueva con él. Una ruta inválida da error claro.
7. Salir de la app con sesiones abiertas: no quedan procesos huérfanos.
8. Revisar que `window.steward` no expone ningún canal que acepte un comando como string.
