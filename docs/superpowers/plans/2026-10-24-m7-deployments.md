# M7 — Deployments: plan de implementación

> **Para quien ejecute:** usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`. Los pasos usan casillas (`- [ ]`).
> **Este repo no tiene tests automáticos y no se crean** (regla del proyecto, `CLAUDE.md`). Donde el flujo normal pondría un test, aquí hay `npm run check` más una **prueba manual que hace el usuario**.

**Objetivo:** lanzar deploys por comando SSH o `workflow_dispatch` de GitHub Actions contra entornos reales, con confirmación reforzada en entornos protegidos, historial y logs, y sin marcar nunca éxito sin evidencia.

**Arquitectura:** `deployment.service` orquesta y es la única máquina de estados; un runner por tipo de target (`deployment-ssh`, `deployment-dispatch`) ejecuta y notifica. Capas: datos → entornos → targets → deploy SSH → deploy dispatch → docs. Patrón existente: canal en `src/shared/types/ipc.ts` + handler en `src/main/ipc/handlers.ts` + binding en `src/preload/index.ts` + schema Zod, los cuatro o no existe.

**Stack:** Electron, TypeScript estricto, React, Zod 4, `node:sqlite`, `yaml` (dependencia nueva, solo para leer `on.workflow_dispatch.inputs`).

**Spec:** `docs/superpowers/specs/2026-10-24-m7-deployments-design.md`

## Restricciones globales

- Rama `milestone-7-deployments`. Commits solo cuando el usuario lo pida, en Conventional Commits; **cada commit lleva su línea en `CHANGELOG.md` bajo `Unreleased` con etiqueta `**M7**`**, escrita para un usuario. `vault/` y `graphify-out/` nunca se commitean.
- Después de cada tarea: `npm run check` en verde (typecheck + lint) y `graphify update .`. No decir "listo" con el check roto.
- `noUncheckedIndexedAccess`; imports de tipos con `import { type X }`; sin `eslint-disable` ni `@ts-ignore` sin razón escrita en el mismo comentario.
- Migraciones solo hacia adelante: nunca editar m001–m011; añadir m012–m014 en `src/main/db/migrations/index.ts`.
- Procesos hijos solo vía `src/main/exec/run.ts` (el runner SSH usa `ssh.service`, que ya lo cumple). Sin `shell: true`.
- Secretos fuera de la base de datos, logs y renderer. Toda salida de comando o de GitHub pasa por `redact()` / `redactSecrets` antes de salir de main. El token de GitHub solo se toca con `github.withToken(projectId, fn)`.
- Errores esperados: `StewardServiceError(code, message, details?)`. Texto de UI en inglés, como el resto de la app.
- **Regla de evidencia:** `succeeded` solo con exit code 0 del comando remoto (`status_source = 'exit_code'`) o `conclusion = 'success'` de GitHub (`'provider'`). Tras lanzar el deploy, cualquier fallo de red, token o desaparición del run deja `unknown`, nunca `failed` ni `succeeded`.

## Ajustes al spec que decide este plan

1. La config SSH de un target añade `timeoutSeconds` (defecto 120, máximo 300): el defecto de 30 s de `ssh:runCommand` corta deploys reales.
2. `deployments` guarda `target_name` (copia) y `deploy_target_id` es `NULL`able con `ON DELETE SET NULL`: borrar un target conserva su historial. `deployments.environment_id` no lleva `ON DELETE` (NO ACTION); el servicio rechaza borrar entornos en uso.
3. El backfill de m012 usa `key = lower(trim(texto))` (no slug) para que dos textos distintos nunca choquen y la migración no pueda fallar.
4. `deployments:start` es asíncrona: valida y devuelve tras iniciar; el runner sigue en segundo plano.
5. Quitar la protección a un entorno exige `confirmed: true`, aplicado en main (no solo en la UI).

## Review Focus

Entradas que el spec implica y ninguna prueba cubre; cada una tiene su comprobación manual en la tarea dueña.

1. Servidores con entorno "Prod", "prod" y "prod " (casing y espacios) → un solo entorno tras m012; ningún servidor pierde su entorno; la migración no revienta. (T1)
2. Entorno protegido: nombre tecleado con otra mayúscula o con espacios sobrantes → `CONFIRMATION_MISMATCH`; coincide solo el nombre exacto. (T6)
3. `remoteDir` o comando con comillas simples, espacios, `$` o `;` → el directorio llega entrecomillado y el comando intacto. (T6)
4. Workflow sin `workflow_dispatch`, con `on:` como texto o lista, YAML mal formado o enorme → `WORKFLOW_NOT_DISPATCHABLE` o error claro, sin romper el modal. (T8)
5. Red caída, token revocado o app cerrada mientras se sondea el run → `unknown` (y reanuda si había `run_id`), nunca `failed`. (T9)

---

## Mapa de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `src/main/db/migrations/index.ts` | m012 entornos, m013 targets y deployments, m014 pestaña |
| `src/shared/schemas/{environments,deploy-targets,deployments}.ts` | Schemas Zod y tipos compartidos |
| `src/shared/git-ref.ts` | `isValidGitRefName(name): boolean` (reutilizar la validación existente de refs si ya hay una) |
| `src/main/db/{environment,deploy-target,deployment}.repo.ts` | SQL |
| `src/main/services/{environment,deploy-target}.service.ts` | CRUD, estilo funciones con `db` como `tab.service.ts` |
| `src/main/services/deployment.service.ts` | Orquestador y máquina de estados |
| `src/main/services/deployment-ssh.ts`, `deployment-dispatch.ts` | Runners |
| `src/main/services/workflow-inputs.ts` | Leer y validar inputs de `workflow_dispatch` |
| `src/renderer/src/features/deployments/` | `DeploymentsPanel`, `EnvironmentsView`, `EnvironmentEditor`, `TargetsView`, `TargetEditor`, `DeployModal`, `InputsForm`, `HistoryView`, `deployment-meta.ts`, `deployments.css` |

---

### Tarea 1: Migraciones, códigos de error y pestaña

**Files:**
- Modify: `src/main/db/migrations/index.ts` (añadir m012–m014 y a `MIGRATIONS`)
- Modify: `src/shared/types/result.ts` (`STEWARD_ERROR_CODES`)
- Modify: `src/main/services/tab.service.ts` (`DEFAULT_TABS`)

**Interfaces:**
- Produces: tablas `environments`, `deploy_targets`, `deployments`; columnas `ssh_hosts.environment_id`, `executions.environment_id`, `executions.deploy_target_id`; códigos `ENVIRONMENT_IN_USE`, `TARGET_BUSY`, `TARGET_BROKEN`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_MISMATCH`, `WORKFLOW_NOT_DISPATCHABLE`, `INPUT_INVALID`; `LATEST_SCHEMA_VERSION = 14`.

- [ ] **Step 1: m012 `environments`.** Tabla `environments(id, project_id → projects ON DELETE CASCADE, key, name, kind CHECK IN ('development','staging','production','custom'), rank INTEGER, is_protected CHECK IN (0,1), created_at, updated_at, UNIQUE(project_id, key))`. Backfill en SQL desde `ssh_hosts.environment` (no vacío): agrupar por `(project_id, lower(trim(environment)))`; `name` = el primer texto original; `key` = `lower(trim(...))`; `kind` por `CASE` sobre la clave (`prod%`/`live` → production; `stage%`/`staging`/`preprod`/`pre-prod` → staging; `dev%` → development; resto custom); `is_protected = 1` solo para production; `rank` production 0, staging 1, qa/test/uat 2, development 3, resto 4 (los empates se ordenan por nombre al leer). Id con la expresión `randomblob` de m006/m011. Después `ALTER TABLE ssh_hosts ADD COLUMN environment_id TEXT REFERENCES environments (id) ON DELETE SET NULL` y `UPDATE` que lo rellena casando `lower(trim(ssh_hosts.environment))` con `key`. La columna de texto vieja **no se toca**.
- [ ] **Step 2: m013.** `deploy_targets(id, project_id CASCADE, environment_id → environments (NO ACTION), name, kind CHECK IN ('ssh_command','github_workflow_dispatch'), ssh_host_id → ssh_hosts ON DELETE SET NULL, repository_id → repositories ON DELETE SET NULL, config_json, requires_confirmation CHECK IN (0,1), created_at, updated_at, UNIQUE(project_id, name))`; `deployments(id, project_id CASCADE, environment_id → environments (NO ACTION), deploy_target_id → deploy_targets ON DELETE SET NULL, target_name, execution_id → executions ON DELETE SET NULL, ref, commit_sha, status CHECK IN ('requested','in_progress','succeeded','failed','cancelled','unknown'), status_source CHECK IN ('provider','exit_code') NULL, run_id INTEGER, run_url, requested_at, finished_at, notes)`; `ALTER TABLE executions ADD COLUMN environment_id` y `deploy_target_id` (TEXT, FK `ON DELETE SET NULL`); índices por `(project_id)` en targets y `(project_id, requested_at)` y `(deploy_target_id, requested_at)` en deployments.
- [ ] **Step 3: m014.** Inserta la pestaña `deployments` a los proyectos que no la tienen, copiando el SQL de m011 (`source 'builtin'`, después de la última posición). Registrar m012–m014 en `MIGRATIONS`.
- [ ] **Step 4: códigos de error** nuevos en `STEWARD_ERROR_CODES`; **`DEFAULT_TABS`** gana `{ tabKey: 'deployments', pinned: false }` justo antes de `settings`.
- [ ] **Step 5: `npm run check`** → sin errores. Corregir cualquier `switch` exhaustivo sobre códigos que se rompa.
- [ ] **Step 6: prueba manual (usuario).** Copiar la base antes (ruta en el pie de la app o `AppInfo.databasePath`). `npm run dev` (cerrar otras instancias): el pie dice schema v14, la app abre, y los servidores con "Prod"/"prod "/"Stage" siguen intactos (Review Focus 1: comprobar después en T3 que aparecen como entornos).

---

### Tarea 2: Entornos en main y servidores SSH con `environmentId`

**Files:**
- Create: `src/shared/schemas/environments.ts`, `src/main/db/environment.repo.ts`, `src/main/services/environment.service.ts`
- Modify: `src/shared/schemas/ssh.ts`, `src/main/db/ssh-host.repo.ts`, `src/main/services/ssh.service.ts`, `src/shared/types/ipc.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`

**Interfaces:**
- Produces (schemas): `environmentKindSchema`; `Environment = { id, projectId, key, name, kind, rank, isProtected, createdAt, updatedAt }`; `EnvironmentCreateInput = { projectId, name, kind, isProtected }`; `EnvironmentUpdateInput = { id, name, kind, isProtected, confirmed: boolean }`; `EnvironmentReorderInput = { projectId, orderedIds: string[] }`; `EnvironmentIdInput = { id }`.
- Produces (service, funciones con `db`): `listEnvironments(db, projectId): Environment[]`, `createEnvironment(db, input): Environment`, `updateEnvironment(db, input): Environment`, `reorderEnvironments(db, input): Environment[]`, `deleteEnvironment(db, input): { id: string }`.
- Produces (IPC): canales `environments:list|create|update|reorder|delete` y `window.steward.environments.{list,create,update,reorder,remove}`.
- Changes: `SshHost` gana `environmentId: string | null` y mantiene `environment: string | null` como **nombre resuelto de solo lectura**; los inputs de create/update de SSH reciben `environmentId` en lugar del texto `environment`.

- [ ] **Step 1: schemas de entornos** con `name` vía `displayNameSchema`.
- [ ] **Step 2: repo.** `listEnvironments` ordena por `rank, name COLLATE NOCASE`; más `findEnvironment`, `insertEnvironment`, `updateEnvironment`, `deleteEnvironment`, `setEnvironmentRanks(db, orderedIds)` y `countEnvironmentUsage(db, id): { targets: number; deployments: number }`.
- [ ] **Step 3: servicio.** `key` = `slugify(name)` (de `@shared/schemas/common`) con sufijo `-2`, `-3`… hasta ser libre; nombre único por proyecto sin distinguir mayúsculas (`CONFLICT`); `rank` = máximo + 1. `updateEnvironment` lanza `CONFIRMATION_REQUIRED` si baja `isProtected` de 1 a 0 sin `confirmed: true`. `reorderEnvironments` exige la lista completa del proyecto (como `reorderTabs`). `deleteEnvironment` lanza `ENVIRONMENT_IN_USE` con los conteos en `details` si hay targets o deployments; los servidores quedan sin entorno por el `SET NULL`.
- [ ] **Step 4: SSH.** En `schemas/ssh.ts` sustituir `environment: optionalText(40)` por `environmentId: idSchema.nullable()` y añadir a `sshHostSchema` `environment: z.string().nullable()`. En `ssh-host.repo.ts` leer con `LEFT JOIN environments` (`environment_name`) y escribir `environment_id`; `SshHostRecord` cambia `environment` por `environmentId` más `environmentName`. En `ssh.service.ts`, `create`/`update` validan que el entorno pertenezca al mismo proyecto (`NOT_FOUND` "that environment no longer exists") y `toView` rellena ambos campos.
- [ ] **Step 5: IPC.** Canales en `IPC_CHANNELS`, interfaz `StewardApi.environments`, cinco handlers con su schema en `buildHandlerDefinitions`, bindings en el preload.
- [ ] **Step 6: `npm run check`.** Los errores de tipo que queden en `ConnectionEditor.tsx` y `SshPanel.tsx` se arreglan en T3; si bloquean el check, hacer T2 y T3 seguidas antes de verificar.

---

### Tarea 3: Pestaña Deployments (shell), vista Environments y selector en SSH

**Files:**
- Create: `src/renderer/src/features/deployments/{DeploymentsPanel,EnvironmentsView,EnvironmentEditor}.tsx`, `deployments.css`
- Modify: `src/renderer/src/App.tsx` (caso `deployments`), `src/renderer/src/features/ssh/{ConnectionEditor,SshPanel}.tsx`, `src/renderer/src/features/ssh/ssh-meta.ts` si hace falta

**Interfaces:**
- Consumes: `window.steward.environments.*` (T2).
- Produces: `EnvironmentEditor({ environment: Environment | null, projectId, onSaved(env: Environment), onClose })` (modal reutilizable); `DeploymentsPanel()` sin props, lee `selectedProjectId` de `useAppStore`.

- [ ] **Step 1: `EnvironmentsView`.** Lista con nombre, pill de `kind`, pill "Protected" con icono `shield`, flechas arriba/abajo (reorder), editar y borrar. Estado local con `useState`/`useEffect` como `SshPanel`. Quitar la protección y borrar usan `ConfirmDialog` (el primero reenvía `confirmed: true`). Vacío: invitación a crear el primero.
- [ ] **Step 2: `EnvironmentEditor`.** Modal con nombre, `kind` y casilla *Protected*; al elegir `production` en un entorno nuevo la casilla se marca sola.
- [ ] **Step 3: `DeploymentsPanel`** renderiza solo `EnvironmentsView` por ahora (T5 añade el segmentado). En `App.tsx`, el caso `deployments` devuelve `<DeploymentsPanel />`; si `PendingPanel` queda sin uso, borrarlo.
- [ ] **Step 4: SSH.** `SshPanel` carga `window.steward.environments.list({ projectId })` y pasa `environments: Environment[]` a `ConnectionEditor`; el campo pasa de `<input list>` a `<select>` con "No environment", los entornos y "+ New environment…" (abre `EnvironmentEditor`; al guardar selecciona el nuevo). `draft.environment` pasa a `draft.environmentId`; el aviso de producción usa `kind === 'production'` del entorno elegido. `groupByEnvironment` sigue agrupando por `host.environment` (nombre resuelto).
- [ ] **Step 5: `npm run check`** → verde.
- [ ] **Step 6: prueba manual (usuario).** Deployments muestra tus entornos migrados (Prod protegido). Crear, editar, reordenar y borrar uno; quitar protección pide confirmación; en SSH el selector lista los entornos, "+ New environment…" crea y selecciona, y la vista Servers sigue agrupando igual.

---

### Tarea 4: Deploy targets en main

**Files:**
- Create: `src/shared/git-ref.ts`, `src/shared/schemas/deploy-targets.ts`, `src/main/db/deploy-target.repo.ts`, `src/main/services/deploy-target.service.ts`
- Modify: `src/shared/types/ipc.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`

**Interfaces:**
- Produces (schemas): `gitRefNameSchema` (usa `isValidGitRefName`: rechaza vacío, que empiece por `-` o termine en `/` o `.lock`, `..`, `@{`, `//`, espacios, caracteres de control y `~^:?*[\`); `DeployTargetKind = 'ssh_command' | 'github_workflow_dispatch'`; `SshTargetConfig = { command: string (1..SSH_COMMAND_MAX_CHARS), remoteDir: string | null (≤500, sin NUL), timeoutSeconds: number (1..300, defecto 120) }`; `DispatchTargetConfig = { workflowId: number, workflowPath: string (≤300), defaultRef: string (gitRefNameSchema) }`.
- Produces: `DeployTarget = { id, projectId, environmentId, name, requiresConfirmation, broken: boolean, createdAt, updatedAt } & ({ kind: 'ssh_command', sshHostId: string | null, config: SshTargetConfig } | { kind: 'github_workflow_dispatch', repositoryId: string | null, config: DispatchTargetConfig })`; inputs de create (`+ projectId`) y update (`+ id`, el `kind` no puede cambiar) como unión discriminada por `kind` con `environmentId, name, requiresConfirmation` y `sshHostId` o `repositoryId` obligatorios.
- Produces (servicio): `listDeployTargets(db, projectId)`, `createDeployTarget(db, input)`, `updateDeployTarget(db, input)`, `deleteDeployTarget(db, input: { id }): { id }`; canales `deployTargets:list|create|update|delete` y `window.steward.deployTargets.{list,create,update,remove}`.

- [ ] **Step 1: `git-ref.ts` y schemas.** Buscar primero (`graphify query`) si ya existe validación de refs (`GIT_INVALID_REF` en `git-ops`) y reutilizarla si encaja.
- [ ] **Step 2: repo** con `config_json` parseado contra el schema de su `kind` al leer; una fila corrupta no debe romper el listado (omitirla y `console.error` sin el contenido).
- [ ] **Step 3: servicio.** Validar que entorno, servidor y repositorio pertenezcan al proyecto (`NOT_FOUND`); que el repositorio tenga remote de `github.com` (como `resolveGithubRepo`); nombre único por proyecto (`CONFLICT`); `requiresConfirmation` se fuerza a `true` si el entorno es protegido. `broken` = servidor o repositorio `NULL`. Borrar un target conserva su historial.
- [ ] **Step 4: IPC** (canales, `StewardApi.deployTargets`, handlers, preload).
- [ ] **Step 5: `npm run check`** → verde.

---

### Tarea 5: Vista Targets y su editor

**Files:**
- Create: `src/renderer/src/features/deployments/{TargetsView,TargetEditor}.tsx`
- Modify: `DeploymentsPanel.tsx` (segmentado), `deployments.css`

**Interfaces:**
- Consumes: `window.steward.deployTargets.*`, `.environments.list`, `.ssh.list`, `.repositories.list`, `.github.listWorkflows`, `.github.listBranches`.
- Produces: `DeploymentsPanel` con segmentado `Targets · History · Environments` (History llega en T7; hasta entonces solo se muestran las vistas existentes); `TargetsView({ onDeploy?(target: DeployTarget): void })`.

- [ ] **Step 1: segmentado** en `DeploymentsPanel`; vista por defecto Targets (si no hay entornos, mostrar la invitación a crear uno y enlazar a Environments).
- [ ] **Step 2: `TargetsView`.** Columnas por entorno ordenadas por `rank`; tarjeta con icono por tipo, destino (servidor, o repo + workflow) y marca "broken" sin botones de acción cuando `broken`. *Add target* y editar abren `TargetEditor`; borrar con `ConfirmDialog` que dice que el historial se conserva.
- [ ] **Step 3: `TargetEditor`.** Común: nombre, entorno, *Ask for confirmation* (marcada y bloqueada si el entorno es protegido). SSH: servidor, comando (textarea), directorio remoto opcional, timeout, aviso fijo "Don't put secrets in the command; it is stored as plain text". Dispatch: repositorio (solo con remote GitHub), workflow (de `listWorkflows`), rama por defecto (de `listBranches`); un `GITHUB_NOT_CONNECTED` muestra una pista que lleva a la pestaña GitHub.
- [ ] **Step 4: `npm run check`** → verde.
- [ ] **Step 5: prueba manual (usuario).** Crear un target SSH y uno dispatch en entornos distintos; el de Prod fuerza confirmación; borrar el servidor o el repositorio deja el target "broken"; sin GitHub conectado, el editor dispatch lo explica.

---

### Tarea 6: Servicio de deploy y runner SSH en main

**Files:**
- Create: `src/shared/schemas/deployments.ts`, `src/main/db/deployment.repo.ts`, `src/main/services/deployment.service.ts`, `src/main/services/deployment-ssh.ts`
- Modify: `src/main/services/ssh.service.ts`, `src/main/index.ts`, `src/shared/types/ipc.ts`, `src/main/ipc/handlers.ts` (`IpcContext.deployments`), `src/preload/index.ts`

**Interfaces:**
- Produces (schemas): `DeploymentStatus`, `DeploymentSource = 'provider' | 'exit_code'`; `Deployment = { id, projectId, environmentId, environmentName, deployTargetId: string | null, targetName, targetKind, executionId: string | null, ref: string | null, commitSha: string | null, status, statusSource: DeploymentSource | null, runId: number | null, runUrl: string | null, requestedAt, finishedAt: string | null, notes: string | null }`; `DeploymentStartInput = { targetId, ref: string | null, inputs: Record<string, string>, confirmed: boolean, confirmation: { environmentName: string } | null }`; `DeploymentListInput = { projectId, limit (1..200, defecto 50) }`; `DeploymentIdInput = { id }`; `DeploymentLog = { text: string, truncated: boolean }`.
- Produces (SSH): `SshService.runDeploy(input: { hostId: string; command: string; timeoutSeconds: number }): Promise<SshDeployOutcome>` con `SshDeployOutcome = { executionId: string; exitCode: number | null; timedOut: boolean; failureCode: StewardErrorCode | null; failureMessage: string | null }`; reutiliza `runRemote` con `kind = 'deploy'`, así hereda log, redacción y la fila de `executions`.
- Produces (servicio): `createDeploymentService(deps: { db, ssh, github, api }): DeploymentService` con `start(input): Promise<Deployment>`, `list(input): Deployment[]`, `get(input): Deployment`, `readLog(input): Promise<DeploymentLog>`, `resumeOnStartup(): void`; `DeploymentRunner { prepare(target, input): Promise<PreparedDeploy>; execute(prepared, ctx): Promise<void>; resume?(deployment, ctx): Promise<void> }` (los runners **no lanzan**: lo inesperado lo captura el servicio y deja `unknown`); `settleDeployment(db, id, outcome)` única vía para cerrar un deploy: `succeeded` exige `source` y `failed|cancelled|unknown` pueden no tenerla.
- Produces (IPC): `deployments:start|list|get|log`; `window.steward.deployments.{start,list,get,log}`.

- [ ] **Step 1: schemas y repo** (`insertDeployment`, `updateDeployment(db, id, patch)`, `findDeployment`, `listDeployments(db, projectId, limit)`, `findActiveDeploymentForTarget`, `linkExecutionToDeploy(db, executionId, environmentId, targetId)`, `settleDeployment`).
- [ ] **Step 2: `ssh.service.runDeploy`** y `composeRemoteCommand(command, remoteDir): string` en `deployment-ssh.ts`: sin `remoteDir` el comando va tal cual; con él, `cd '<dir con \' escapado como '\\''>' && <command>`.
- [ ] **Step 3: `start`.** Orden fijo: (1) cargar target y entorno (`NOT_FOUND`; `broken` → `TARGET_BROKEN`); (2) confirmación en main: si el entorno es protegido, `confirmation.environmentName` debe ser **idéntico** al nombre del entorno (`CONFIRMATION_MISMATCH`, `CONFIRMATION_REQUIRED` si falta); si no, y el target pide confirmación, `confirmed === true`; (3) `runner.prepare` (puede lanzar `INPUT_INVALID`, etc.; aún no hay fila); (4) en un bloque síncrono, comprobar `findActiveDeploymentForTarget` (`TARGET_BUSY`) e insertar el deploy en `requested`; (5) lanzar `runner.execute` sin esperar y devolver el `Deployment`. Un `kind` sin runner lanza `VALIDATION_FAILED` "that kind of target cannot be deployed yet" (T9 añade dispatch).
- [ ] **Step 4: runner SSH.** Marca `in_progress`, llama `ssh.runDeploy`, enlaza `execution_id` con `linkExecutionToDeploy`; exit 0 → `succeeded` (`exit_code`); `timedOut` → `unknown` con nota "the command may still be running on the server"; fallo de ssh o exit ≠ 0 → `failed` con el mensaje.
- [ ] **Step 5: `readLog`** (solo SSH): lee `executions.log_path` de la fila enlazada, cola de 200 KB, `truncated` si se cortó; una ruta ausente devuelve texto vacío. Nunca acepta una ruta del renderer.
- [ ] **Step 6: `resumeOnStartup`** (aún solo SSH): deploys `requested`/`in_progress` de targets SSH → `unknown` con nota "Steward closed before the command finished". Cablear en `main/index.ts` tras crear el servicio.
- [ ] **Step 7: IPC** completo (canales, `StewardApi.deployments`, handlers, preload) y `deployments` en `IpcContext`.
- [ ] **Step 8: `npm run check`** → verde.

---

### Tarea 7: Modal Deploy, History y último estado en las tarjetas (SSH)

**Files:**
- Create: `src/renderer/src/features/deployments/{DeployModal,HistoryView,deployment-meta}.tsx|ts`
- Modify: `DeploymentsPanel.tsx`, `TargetsView.tsx`, `deployments.css`

**Interfaces:**
- Produces: `deploymentChip(status): { tone: PillTone; icon: IconName; label: string }` (requested → neutral/`clock`, in_progress → running/`loader`, succeeded → success/`check`, failed → failure/`x`, cancelled → neutral/`x`, unknown → warning/`alert`); `sourceLabel(source): string` ("confirmed by exit code" / "confirmed by GitHub"); `UNKNOWN_HINT = "Steward can't confirm the result. Check the server or GitHub."`; `DeployModal({ target, environment, projectId, onClose, onStarted(d: Deployment) })`.

- [ ] **Step 1: `DeploymentsPanel`** carga `deployments.list`, comparte la lista con Targets e History y la refresca cada 3 s solo mientras alguna esté en `requested`/`in_progress`.
- [ ] **Step 2: `DeployModal`.** Resumen con entorno, target y comando exacto (más directorio remoto). Entorno protegido: campo para teclear el nombre y botón desactivado hasta que coincida **exactamente**; no protegido con confirmación: casilla. Envía `deployments.start`; un error se muestra con `ErrorBanner` sin cerrar el modal.
- [ ] **Step 3: tarjetas.** Botón *Deploy* en cada target no roto y pill del último deploy (`deploymentChip`).
- [ ] **Step 4: `HistoryView`.** Fila con pill, entorno, target (`targetName`), ref, tiempo relativo y duración (reutilizar `relativeTime`/`durationLabel` de `ssh-meta`), `sourceLabel`, y `UNKNOWN_HINT` si `unknown`. Fila desplegable con `deployments.log` (texto plano en `<pre>`, nunca HTML); notas visibles.
- [ ] **Step 5: `npm run check`** → verde.
- [ ] **Step 6: prueba manual (usuario).** Con un servidor real: deploy a un entorno no protegido (`uptime`) → `succeeded` "confirmed by exit code" y log; un comando que sale con 2 → `failed`; `sleep 20` con timeout 10 → `unknown`; protegido: con "prod" o "Prod " no se activa el botón; con el nombre exacto sí; dos deploys seguidos al mismo target → `TARGET_BUSY`; `remoteDir` con espacios y un comando con `'` y `$HOME` (Review Focus 3).

---

### Tarea 8: GitHub API para dispatch y lectura de inputs

**Files:**
- Create: `src/main/services/workflow-inputs.ts`
- Modify: `src/main/services/github-api.ts`, `src/shared/schemas/deployments.ts`, `src/main/services/deployment.service.ts`, `src/shared/types/ipc.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `package.json`

**Interfaces:**
- Produces (schemas): `WorkflowInputSpec = { name: string; description: string | null; required: boolean; type: 'string' | 'boolean' | 'choice' | 'number' | 'environment'; default: string | null; options: string[] }`; `DeploymentWorkflowInputsInput = { projectId, repositoryId, workflowPath: string, ref: string (gitRefNameSchema) }`.
- Produces (`GithubApi`): `dispatchWorkflow(token, owner, name, body: { workflowId: number; ref: string; inputs: Record<string, string> }): Promise<void>` (POST `/actions/workflows/{id}/dispatches`, 204); `getWorkflowFile(token, owner, name, path: string, ref: string): Promise<string>` (GET contents, decodifica base64, cada segmento de la ruta con `encodeURIComponent`, rechaza más de 256 KB con `GITHUB_FAILED`); `getRun(token, owner, name, runId: number): Promise<GithubRun>`; `listRuns` acepta `query.event?: string` y `query.branch?: string` opcionales. La conversión de run de la API a `GithubRun` se extrae a una función compartida con `listRuns`.
- Produces (`workflow-inputs.ts`): `parseWorkflowInputs(yamlText: string): WorkflowInputSpec[]` y `validateWorkflowInputs(specs: WorkflowInputSpec[], values: Record<string, string>): Record<string, string>`.
- Produces (servicio): `DeploymentService.listWorkflowInputs(input): Promise<WorkflowInputSpec[]>`; canal `deployments:workflowInputs`; `window.steward.deployments.workflowInputs`.

- [ ] **Step 1: dependencia.** `npm install --save-exact yaml`. Es la única dependencia nueva de M7.
- [ ] **Step 2: `parseWorkflowInputs`.** Acepta `on:` como texto, lista o mapa, con `workflow_dispatch:` vacío (sin inputs → `[]`); si el trigger falta, `StewardServiceError('WORKFLOW_NOT_DISPATCHABLE', …)`; YAML inválido → mismo código con mensaje claro; sin volcar el contenido al error. Tipos desconocidos se tratan como `string`.
- [ ] **Step 3: `validateWorkflowInputs`.** Rechaza (`INPUT_INVALID`, nombrando el input) nombres no declarados, más de 25 valores, falta de un `required` sin `default`, booleano distinto de `'true'|'false'`, número no numérico, `choice` fuera de `options`, y valores de más de 2000 caracteres. Rellena los `default` que falten.
- [ ] **Step 4: `GithubApi`** (los cuatro cambios de arriba; `send`/`request` ya soportan POST y cuerpos 204 sin JSON).
- [ ] **Step 5: `listWorkflowInputs`** en el servicio (`resolveGithubRepo` + `github.withToken` + `getWorkflowFile` + `parseWorkflowInputs`) y su canal.
- [ ] **Step 6: `npm run check`** → verde.

---

### Tarea 9: Runner dispatch y reanudación

**Files:**
- Create: `src/main/services/deployment-dispatch.ts`
- Modify: `src/main/services/deployment.service.ts`, `src/main/db/deployment.repo.ts` si falta algo

**Interfaces:**
- Consumes: `GithubApi` (T8), `validateWorkflowInputs`, `DeploymentRunner` y `settleDeployment` (T6), `insertExecution`/`updateExecutionFinish` de `execution.repo.ts`.
- Produces: `createDispatchRunner(deps: { db, github, api }): DeploymentRunner` registrado para `github_workflow_dispatch`.

- [ ] **Step 1: `prepare`.** Resolver repo (`resolveGithubRepo`), `ref` = `input.ref ?? config.defaultRef`, releer el `.yml` y validar `inputs` con `validateWorkflowInputs`; devuelve `{ ref, payload: { inputs, owner, name } }`.
- [ ] **Step 2: `execute`.** (a) fila de `executions` (`kind 'workflow_dispatch'`, `context 'remote'`, `command 'github:workflow_dispatch'`, args `[workflowPath, ref]`) enlazada con `linkExecutionToDeploy`; (b) línea base = mayor `id` de `listRuns({ workflowId, event: 'workflow_dispatch', branch: ref, page: 1 })` (0 si no hay); (c) `dispatchWorkflow`; un rechazo **antes** de ejecutar nada (422, 404, permisos, auth) → `failed` con el mensaje, sin tocar `unknown`; (d) buscar cada 3 s, hasta 45 s, un run con `id` mayor que la línea base; si no aparece → `unknown` con enlace a Actions; (e) al encontrarlo guardar `runId`, `runUrl`, `commitSha` y pasar a `in_progress`; (f) consultar `getRun` cada 10 s hasta `status === 'completed'`; (g) `conclusion`: `success` → `succeeded` (`provider`); `failure`/`timed_out` → `failed`; `cancelled` → `cancelled`; cualquier otro → `unknown`.
- [ ] **Step 3: robustez.** Errores transitorios al sondear (`GITHUB_UNREACHABLE`, `GITHUB_RATE_LIMITED`, `GITHUB_AUTH_FAILED`, `GITHUB_FAILED`) reintentan; tras 5 seguidos → `unknown` con nota. Tope absoluto de 6 h → `unknown`. Ningún camino posterior al POST puede dejar `failed`. Cerrar la fila de `executions` coherente (`unknown` se registra como `failed` con `error_code 'UNKNOWN_OUTCOME'`).
- [ ] **Step 4: `resume`.** En `resumeOnStartup`, los deploys dispatch `in_progress` con `run_id` reanudan el paso (f) (target o repo desaparecido → `unknown`); los `requested` sin `run_id` → `unknown` ("Steward closed before the run was found").
- [ ] **Step 5: registrar el runner** y quitar el rechazo "cannot be deployed yet" de T6.
- [ ] **Step 6: `npm run check`** → verde.

---

### Tarea 10: UI de dispatch (inputs, historial con jobs y logs)

**Files:**
- Create: `src/renderer/src/features/deployments/InputsForm.tsx`
- Modify: `DeployModal.tsx`, `HistoryView.tsx`, `src/renderer/src/features/github/JobLogModal.tsx`, `deployments.css`

**Interfaces:**
- Consumes: `deployments.workflowInputs`, `github.listBranches`, `github.listJobs`, `github.getJobLog`, `github.openUrl`; `RunDetail` (props existentes: `jobs`, `runUrl`, `onViewLog`, `onOpen`).
- Produces: `InputsForm({ specs: WorkflowInputSpec[], values: Record<string, string>, onChange(values) })`; `JobLogModal` gana prop opcional `loadLog?: (jobId: number) => Promise<StewardResult<GithubJobLog>>` y `onOpenUrl?: (url: string) => void`; sin ellas sigue usando `useGithubStore` (la pestaña GitHub no cambia).

- [ ] **Step 1: `JobLogModal`** acepta `loadLog`/`onOpenUrl` y los usa si vienen; el almacén de GitHub depende del repositorio seleccionado en esa pestaña, por eso Deployments pasa sus propias funciones con el `repositoryId` del target.
- [ ] **Step 2: `InputsForm`.** string → texto, number → numérico, boolean → casilla, choice → select, environment → texto; muestra descripción y marca los requeridos.
- [ ] **Step 3: `DeployModal` dispatch.** Selector de rama (por defecto `config.defaultRef`); al abrir y al cambiar la rama carga `workflowInputs` (errores como `WORKFLOW_NOT_DISPATCHABLE` se muestran en el modal y bloquean el botón); resumen con workflow + ref + inputs.
- [ ] **Step 4: `HistoryView` dispatch.** Fila desplegable con `RunDetail` (jobs de `github.listJobs` con el `repositoryId` del target, `runUrl` del deploy), "Open run on GitHub" y `JobLogModal`; un deploy `unknown` sin run muestra enlace a la pestaña Actions de GitHub.
- [ ] **Step 5: `npm run check`** → verde.
- [ ] **Step 6: prueba manual (usuario).** Dispatch real contra un workflow tuyo con inputs de cada tipo: aparece el run, pasa a `in_progress` y termina `succeeded` "confirmed by GitHub" con jobs y log; un workflow que falla → `failed`; uno cancelado a mano en GitHub → `cancelled`; workflow sin `workflow_dispatch` → mensaje claro (Review Focus 4); con la app cerrada a mitad de un run, al volver reanuda (Review Focus 5); revocar el token durante el sondeo → `unknown`.

---

### Tarea 11: Documentación, grafo y cierre

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/plan.md`, `docs/superpowers/specs/2026-10-24-m7-deployments-design.md`, `vault/steward/{Estado,Decisiones,Proyecto}.md`

- [ ] **Step 1: `README.md`.** La fila "🔜 Deployments (M7)" pasa a ✅ con una frase de usuario; badge a "milestone 7 of 7".
- [ ] **Step 2: `CHANGELOG.md`** bajo `Unreleased`, líneas `**M7**` en *Added* (entornos protegidos, targets, deploy por SSH y por workflow_dispatch con inputs, historial con fuente de la confirmación y logs) y *Changed* (el entorno de los servidores SSH pasa de texto libre a la lista de entornos). Si el usuario pidió commits a mitad de camino, cada uno ya debe llevar su línea.
- [ ] **Step 3: spec y `docs/plan.md`.** Añadir al spec una sección "Ajustes durante el plan" con los cinco puntos de arriba; en `plan.md` anotar la desviación de `workflow_runs` y de la clave de entorno.
- [ ] **Step 4: vault.** `Estado.md` con el milestone, lo que funciona y la lista de pruebas manuales de T1 a T10; `Decisiones.md` con fecha y motivo de cada ajuste; `Proyecto.md` con la arquitectura de deploy.
- [ ] **Step 5: grafo.** `graphify update .` y `graphify export obsidian --dir vault/steward/graphify`; como cambiaron docs, `/graphify . --update`.
- [ ] **Step 6: verificación final.** `npm run check` y `npm run build` en verde; entregar al usuario la lista completa de pruebas manuales y recordar la regla del proyecto: terminar el milestone con README y CHANGELOG al día, push y PR hacia `master` **antes** de empezar el siguiente.
