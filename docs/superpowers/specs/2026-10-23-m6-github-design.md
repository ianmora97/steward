# M6 — GitHub: conexión y Pull Requests: diseño

## Objetivo

Dentro de un proyecto, una pestaña **GitHub** para conectar una cuenta con un token personal (PAT), ver los Pull Requests de los repositorios del proyecto cuyo remote sea `github.com` y crear PRs. Actions (workflows, runs, logs) queda para **M6.5**, en su propia rama.

## Decisiones acordadas

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | Auth con **PAT propio** cifrado con `safeStorage`; importar desde `gh auth token` solo por acción explícita y etiquetada | Plan §6; Steward no depende de `gh` instalado |
| 2 | **Un token por proyecto** (integración `github` por proyecto, sin entidad "cuenta") | Encaja con `integrations(project_id, kind)`; cuentas/scopes distintos por proyecto |
| 3 | **M6 = conexión + PRs; M6.5 = Actions** | PRs más pequeños y revisables |
| 4 | API vía **`fetch` nativo + Zod**, sin Octokit | ~5 endpoints; Zod valida igual; control de redacción, timeout y rate-limit |

## Alcance fuera de M6

Workflows, runs y logs (M6.5); `workflow_dispatch` y deploys (M7); GitHub Enterprise; OAuth device flow; comentar, mergear o cerrar PRs; fallback de cifrado sin `safeStorage`.

## Datos y secreto

**Migración 10 (solo hacia adelante):**
`integrations(id, project_id, kind, connection_status, connection_checked_at, last_error, config_json, created_at, updated_at)` con `UNIQUE(project_id, kind)`.

- `connection_status`: `unconfigured | connected | auth_error | unreachable`. El estado operativo no entra hasta M6.5.
- `config_json`: solo datos no secretos (`login`, `scopes` para mostrar, `apiBase` fijo `https://api.github.com`).
- **Token**: cifrado con `safeStorage` en `userData/secrets/<integrationId>.bin`. Nunca en SQLite. Si `safeStorage.isEncryptionAvailable()` es falso, se rechaza guardar y la UI lo explica.
- **Pestaña**: clave nueva `github` en `tabKeySchema`. Al conectar se inserta la fila en `workspace_tabs` con `source='integration'` e `integration_id`; al desconectar se oculta. La clave `actions` (ya existente) la usará M6.5.

## Main

### `github-api.ts` (único punto con red)
- `fetch` a `api.github.com`; cabeceras fijas (`Authorization`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version`); timeout 15 s con `AbortController`.
- Cada respuesta pasa por un schema Zod. Si no valida: error genérico al renderer, detalle registrado en main.
- Errores → `StewardServiceError`: 401 → `auth_error` (y actualiza la integración); 403 con `x-ratelimit-remaining: 0` → `RATE_LIMITED` con hora de reset; 404 → "no existe o el token no tiene acceso"; red caída → `unreachable`.
- Todo texto de error pasa por `redactSecrets()`; el token nunca va en URLs ni logs. Añadir patrones `ghp_`, `github_pat_`, `gho_` si faltan.
- Endpoints: `GET /user` (valida token; scopes desde `x-oauth-scopes`), `GET /repos/{o}/{r}`, `GET /repos/{o}/{r}/pulls`, `POST /repos/{o}/{r}/pulls`, `GET /repos/{o}/{r}/branches`.

### Detección de repo
Función pura que parsea `repositories.remote_url` (https y ssh, con y sin `.git`) a `{owner, name}`. Solo host `github.com`; otros remotes se muestran como "no es GitHub" sin error. Se usa la URL ya guardada; no se ejecuta git extra.

### `github-integration.service.ts`
`connect` (valida con `GET /user`, cifra y guarda, inserta pestaña), `importFromGh` (ejecuta `gh auth token` por `src/main/exec/run.ts`, array de args; error claro si `gh` no existe), `disconnect` (borra secreto, oculta pestaña), `status`.

### `github-pulls.service.ts`
- `listPulls({projectId, repositoryId, state, page})`: `state` = open | closed | all; `per_page=30`, paginación por cabecera `Link`.
- `listBranches({projectId, repositoryId})`.
- `createPull({projectId, repositoryId, base, head, title, body, draft, confirmed})`: Zod valida longitudes y `base != head`; exige `confirmed: true`. Registra una fila en `executions` (contexto API, sin token).
- Owner/repo siempre se derivan del remote guardado del `repositoryId`; nunca los envía el renderer.
- `openUrl`: `shell.openExternal` solo con URLs `https://github.com/...` validadas en main.

## IPC (8 canales con nombre)
`github:connect`, `github:importFromGh`, `github:disconnect`, `github:status`, `github:listPulls`, `github:listBranches`, `github:createPull`, `github:openUrl`. Cada uno: canal en `src/shared/types/ipc.ts` + handler en `src/main/ipc/handlers.ts` + binding en `src/preload/index.ts` + schema en `src/shared/schemas/github.ts`. El token entra una vez por `connect` y nunca vuelve al renderer.

## Renderer — `src/renderer/src/features/github/`
- `GithubPanel`: sin integración → formulario de conexión (pegar token o "Importar desde gh"). Conectada → login, scopes, desconectar.
- Selector de repositorio (solo los con remote GitHub) + lista de PRs con filtro de estado y "cargar más".
- Diálogo "Crear PR": base, head, título, cuerpo, draft, resumen y confirmación explícita.
- Estados explícitos: sin token, `auth_error` (botón reconectar), rate limit (hora de reset), repo sin remote GitHub.

## Seguridad (invariantes)
- Token solo en main; jamás en SQLite, logs, `executions` ni estado del renderer.
- Sin canal genérico; solo los 8 canales con schema Zod.
- `gh` solo por `run.ts`, sin shell, solo por acción explícita.
- Owner/repo derivados del remote guardado; URLs externas validadas.
- Salida y errores por `redactSecrets()`.

## Verificación

Estática: `npm run check`. Sin tests automatizados. Pruebas manuales del usuario:
1. Conectar con PAT válido → pestaña GitHub con login y scopes; tras reiniciar sigue conectado.
2. Token inválido → error claro; revocar el token en GitHub → al refrescar pide reconectar (`auth_error`).
3. "Importar desde gh" funciona con `gh` logueado y falla limpio sin él.
4. Listar PRs del repo con filtro open/closed y "cargar más".
5. Crear PR (incluido draft) con confirmación; cancelar no crea nada.
6. Repo sin remote GitHub → mensaje "no es GitHub", sin error.
7. Desconectar → pestaña oculta y archivo de secreto borrado.

## Documentación a actualizar al terminar
README, CHANGELOG (`Added`, etiqueta M6), `vault/steward/` (`Estado.md`, `Decisiones.md`, `Proyecto.md`), `graphify update .`.
