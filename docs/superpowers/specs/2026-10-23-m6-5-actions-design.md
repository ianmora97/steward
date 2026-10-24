# M6.5 — GitHub Actions: workflows, runs y logs: diseño

## Objetivo

En la pestaña **GitHub** de un proyecto conectado, una sub-vista **Actions** para ver los workflows de un repositorio con remote `github.com`, el historial de runs con estado y conclusión, los jobs y steps de cada run y el log de un job. Solo lectura. Sigue a [M6](2026-10-23-m6-github-design.md) y reutiliza sus decisiones.

## Decisiones acordadas

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | **Lectura en vivo**, sin tabla `workflow_runs` ni migración; el estado operativo se calcula | GitHub no es fuente de verdad; M7 añade la tabla si `deployments` necesita la FK |
| 2 | Logs **por job, texto plano, a demanda**; últimos ~200 KB, sin dependencias nuevas | El plan pide "log retrieval within API limits"; evita leer zips |
| 3 | UI como **sub-vista dentro de la pestaña GitHub** (*Pull requests \| Actions*) | Comparte conexión y selector de repositorio; sin migración ni segunda pantalla de "no conectado" |
| — | Heredado de M6: PAT por proyecto en `safeStorage`, `fetch` + Zod, owner/repo derivados del remote guardado, errores 401/403/404/rate-limit con estado propio | No se reabre |

## Alcance fuera de M6.5

Relanzar o cancelar runs, `workflow_dispatch` y deploys (M7), artefactos, anotaciones, logs de run completo (zip), auto-refresco, guardar runs en SQLite.

## Main

### `github-api.ts` (métodos nuevos, mismo `request()` y mismo mapeo de errores)
- `listWorkflows(token, owner, name)`: `GET /repos/{o}/{r}/actions/workflows?per_page=100` → `{id, name, path, state}[]`.
- `listRuns(token, owner, name, { workflowId: number | null, page })`: `GET …/actions/runs` o `…/actions/workflows/{id}/runs`, `per_page=30`, `hasNext` por cabecera `Link`. Cada run: `id`, `runNumber`, `title` (`display_title`), `workflowId`, `workflowName`, `status` (`queued | in_progress | completed | …`), `conclusion` (`success | failure | cancelled | skipped | timed_out | neutral | action_required | stale | startup_failure | null`), `event`, `branch`, `sha` (completo), `actor` (nullable), `url`, `createdAt`, `startedAt`, `updatedAt`. Tolerante a nulos como `listPulls`.
- `listJobs(token, owner, name, runId)`: `GET …/actions/runs/{id}/jobs?per_page=100` → jobs `{id, name, status, conclusion, startedAt, completedAt, url, steps: {number, name, status, conclusion}[]}`.
- `getJobLog(token, owner, name, jobId)`: `GET …/actions/jobs/{id}/logs`. GitHub responde 302 a una URL firmada de otro origen (`fetch` no reenvía `Authorization` entre orígenes). Se lee el cuerpo en streaming con tope de **20 MB**: si lo supera se devuelve `{ text: '', truncated: true, tooLarge: true }`. Si no, se conservan los **últimos 200 KB**, `truncated` indica si se cortó. Un 404 (logs expiran a los 90 días) se mapea a `GITHUB_NOT_FOUND` con mensaje de "log no disponible".
- El texto del log se limpia en el servicio, no en la API: se quitan secuencias ANSI y pasa por `redactSecrets`.

### Estado operativo (calculado, no guardado)
`getHealth` pide la primera página de runs sin filtro (30) y toma, por workflow, el último run *completado*. Resultado:
- `failing`: el run completado más reciente (en total) tiene conclusión `failure`, `timed_out` o `startup_failure`.
- `degraded`: ese run pasó (`success`), pero el último completado de otro workflow falló.
- `healthy`: todos los últimos completados pasaron.
- `unknown`: no hay runs completados que cuenten. `cancelled`, `skipped`, `neutral`, `stale` y `action_required` no cuentan como éxito ni fallo.
Devuelve `{ status, basedOnRuns: number, failingWorkflows: string[] }`.

### `github-actions.service.ts`
Reutiliza el patrón de `github-pulls.service.ts`: `resolveRepo` (el `repositoryId` debe pertenecer al `projectId`; owner/repo del remote guardado) y `github.withToken`. Métodos: `listWorkflows`, `listRuns`, `listJobs`, `getJobLog`, `getHealth`. Solo lectura: no escribe en `executions` ni en la base.

### IPC (5 canales nuevos)
`github:listWorkflows`, `github:listRuns`, `github:listJobs`, `github:getJobLog`, `github:getHealth`. Cada uno: canal en `src/shared/types/ipc.ts` + handler en `src/main/ipc/handlers.ts` + binding en `src/preload/index.ts` + schema en `src/shared/schemas/github.ts`. Entradas: `projectId`, `repositoryId` (+ `workflowId` entero ≥ 1 opcional, `page` ≥ 1, `runId`/`jobId` enteros ≥ 1).

### Limpieza
Se retira la clave de pestaña `actions` de `tabKeySchema`, su etiqueta e icono en `TabBar.tsx` y su placeholder en `App.tsx` (nunca se sembró en ningún proyecto).

## Renderer — `src/renderer/src/features/github/`
- `GithubPanel`: control *Pull requests | Actions* bajo el selector de repositorio; el repo elegido se comparte. Repos sin remote GitHub siguen marcados "not on GitHub".
- `ActionsView`: cabecera con dos chips separados (*Connection: connected* y *Workflows: healthy/degraded/failing/unknown*, con la nota "según los últimos 30 runs"), botón *Refresh*, filtro *All workflows* + workflows del repo (los no activos marcados "disabled"), `RunList` con *Load more*.
- `RunList`: chip de estado/conclusión, título, workflow, `#run_number`, rama, evento, sha corto, actor, fecha y duración. Clic despliega `RunDetail`.
- `RunDetail`: jobs con chip y duración, steps anidados con su conclusión, *View log* por job y *Open on GitHub* (vía `github:openUrl`).
- `JobLogModal` (sobre `Modal`): texto monoespaciado con scroll; aviso de truncado ("mostrando los últimos 200 KB"); mensaje claro si el log expiró o es demasiado grande. El log se pinta siempre como texto, nunca como HTML.
- Estados explícitos: sin workflows, sin runs, rate limit con hora de reset, 403 con pista ("los tokens fine-grained necesitan *Actions: Read*; los clásicos, `repo`"). `auth_error` y `unreachable` los gestiona el panel padre.
- Sin auto-refresco: recarga al abrir la vista, al cambiar de repo o workflow y con *Refresh*. Las respuestas de una vista abandonada se descartan (contador de peticiones, como en PRs).
- `github.store.ts`: `view`, `workflows`, `workflowId`, `runs`, `runsPage`, `runsHasNext`, `health`, `jobsByRun`, `loadingRuns`; acciones `loadActions`, `setWorkflow`, `loadMoreRuns`, `refresh`, `loadJobs`, `fetchJobLog`.

## Seguridad (invariantes)
- Solo lectura; mismo token y mismo `withToken` que M6 (401 → `auth_error`; 403 y rate limit no cambian la conexión).
- `runId`/`jobId`/`workflowId` son enteros validados y van en la ruta con `encodeURIComponent`; owner/repo salen del remote guardado del repositorio del proyecto.
- Los logs son datos no confiables: texto sin HTML, sin ANSI, con `redactSecrets`; tope de descarga (20 MB) y de salida (200 KB).
- Enlaces externos solo por `github:openUrl` (`https://github.com/…`).

## Verificación

Estática: `npm run check`. Sin tests automatizados. Pruebas manuales del usuario:
1. GitHub → *Actions* en este repo: runs reales con estado y conclusión; el chip *Connection: connected* convive con *Workflows* `failing/healthy` según los últimos runs.
2. Filtrar por workflow cambia la lista; *Load more* solo si hay más de 30.
3. Desplegar un run: jobs y steps con su conclusión; *View log* muestra el texto del job, sin colores ni secretos, y avisa si se truncó.
4. Un run en curso aparece *in progress*; *Refresh* lo actualiza al terminar.
5. Repo sin runs o sin workflows → mensaje vacío, no error. Repo sin remote GitHub → "not on GitHub".
6. Token sin permiso de Actions → 403 con la pista; token revocado → pide reconectar.
7. Log de un run de más de 90 días o inexistente → "log no disponible".
8. La pestaña `actions` ya no existe; las demás pestañas siguen igual.

## Documentación a actualizar al terminar
README, CHANGELOG (`Added` / `Removed`, etiqueta M6.5), `vault/steward/` (`Estado.md`, `Decisiones.md`, `Proyecto.md`), `graphify update .`.
