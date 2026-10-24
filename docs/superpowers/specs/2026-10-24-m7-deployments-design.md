# M7 — Deployments: diseño

Rama: `milestone-7-deployments` (desde `master`). Estado: diseño aprobado en conversación, pendiente de revisión del spec escrito.

## Objetivo

Lanzar un deploy desde Steward a un entorno concreto de un proyecto, por **comando SSH** o por **`workflow_dispatch` de GitHub Actions**, con confirmación reforzada en entornos protegidos, historial y logs inspeccionables, y una regla que no se negocia: **Steward nunca marca un deploy como exitoso sin evidencia** (exit code 0 del comando remoto, o conclusión `success` que reporta GitHub).

## Decisiones tomadas

| Tema | Decisión |
| --- | --- |
| Alcance | Todo en un solo M7 (entornos, targets SSH y dispatch, historial, UI). Se implementa por capas verificables. |
| Entornos | Tabla `environments` real. Migración desde el texto libre `ssh_hosts.environment`. |
| Comando SSH | Fijo en el target; al desplegar solo se confirma. Sin plantillas ni edición en el momento. |
| Inputs de dispatch | Leídos del `.yml` del workflow en GitHub (`on.workflow_dispatch.inputs`). |
| Arquitectura | Un `deployment.service` orquestador con un runner por tipo de target. |
| Fuera de alcance | Cancelar un deploy en curso, rollback, notificaciones del sistema, canal de eventos push. |

## 1. Datos

### m012 — `environments`

```
environments(id PK, project_id FK→projects ON DELETE CASCADE, key, name,
             kind CHECK IN ('development','staging','production','custom'),
             rank INTEGER, is_protected INTEGER CHECK IN (0,1),
             created_at, updated_at)
             UNIQUE(project_id, key)
```

- Backfill: por cada proyecto, una fila por cada valor distinto y no vacío de `ssh_hosts.environment`. `key` = slug en minúsculas del texto; `name` = el texto original; `kind` se infiere del nombre (`prod*` → production, `stage*`/`staging` → staging, `dev*` → development, resto custom); `is_protected = 1` solo para `production`; `rank` sigue el orden prod → stage → dev → resto alfabético, el mismo que usa hoy la vista Servers.
- `ssh_hosts` gana `environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL`, rellenado a partir del texto.
- La columna `ssh_hosts.environment` **no se borra** en esta migración (solo hacia adelante, sin perder datos); deja de leerse y se retirará en una migración posterior.

### m013 — `deploy_targets` y `deployments`

```
deploy_targets(id PK, project_id FK, environment_id FK→environments,
               name, kind CHECK IN ('ssh_command','github_workflow_dispatch'),
               ssh_host_id FK→ssh_hosts NULL, repository_id FK→repositories NULL,
               config_json,                 -- validado con Zod discriminado por kind
               requires_confirmation INTEGER, created_at, updated_at)
               UNIQUE(project_id, name)

deployments(id PK, project_id FK, environment_id FK, deploy_target_id FK,
            execution_id FK→executions NULL,
            ref NULL, commit_sha NULL,
            status CHECK IN ('requested','in_progress','succeeded','failed','cancelled','unknown'),
            status_source CHECK IN ('provider','exit_code') NULL,
            run_id NULL, run_url NULL,   -- dispatch: sin tabla workflow_runs (ver desviación)
            requested_at, finished_at NULL, notes NULL)
```

- `config_json` por kind: SSH → `{ command, remoteDir? }`; dispatch → `{ workflowId, workflowPath, defaultRef }`.
- `executions` gana `environment_id` y `deploy_target_id` (nullables) y se usan los kinds `deploy` y `workflow_dispatch` (la columna `kind` no tiene CHECK).
- `status_source` es `NULL` mientras no hay evidencia (`requested`, `in_progress`, `unknown`).

### m014 — pestaña

Añade la pestaña `deployments` a los proyectos existentes, igual que m006 y m011. La clave ya existe en `tabs.ts`. Se verifica que `tab.service` la siembre en proyectos nuevos.

### Desviación respecto a `docs/plan.md`

El plan prevé una tabla `workflow_runs` como espejo. No existe: la vista Actions lee en vivo de GitHub. `deployments` guarda `run_id` y `run_url` directamente. Se anota en `docs/plan.md` y en `Decisiones.md`.

## 2. Servicios en main y flujo del deploy

Piezas nuevas en `src/main`, cada una con canal en `src/shared/types/ipc.ts`, handler en `src/main/ipc/handlers.ts`, binding en `src/preload/index.ts` y schema Zod:

- `environment.service`, `deploy-target.service`: CRUD. Borrar un entorno con targets o deployments se rechaza (`ENVIRONMENT_IN_USE`).
- `deployment.service`: orquestador y única máquina de estados.
- `deployment-ssh`, `deployment-dispatch`: los dos runners.
- `workflow-inputs.ts`: lee el `.yml` por la API de contents y extrae `on.workflow_dispatch.inputs` (nueva dependencia de parseo YAML).
- `github-api` gana `dispatchWorkflow`, `getWorkflowFile`, `getRun`; `listRuns` admite filtros por `event` y rama.

### `deployment:start`

Todo se valida en main, nunca en el renderer.

1. Carga target y entorno. En dispatch, relee los inputs del workflow y valida los valores contra ese schema (`INPUT_INVALID` nombra el input culpable).
2. Confirmación, aplicada por el schema en main:
   - Entorno protegido: `confirmation.environmentName` debe ser idéntico al nombre del entorno (`CONFIRMATION_MISMATCH`).
   - No protegido con `requires_confirmation`: `confirmed: true` (`CONFIRMATION_REQUIRED`).
3. Inserta `deployments` en `requested` y una fila en `executions`. Un solo deploy activo por target (`TARGET_BUSY`).
4. **SSH** — reutiliza `sshService.runCommand`:
   - exit 0 → `succeeded`, fuente `exit_code`;
   - exit distinto de 0, o ssh que no conecta → `failed`;
   - timeout → `unknown` (el comando remoto pudo seguir corriendo).
5. **Dispatch** — el POST devuelve 204 sin id:
   - antes de lanzarlo se guarda el id del último run del workflow como línea base (sin depender de relojes);
   - después se busca cada 3 s, hasta 45 s, un run con id mayor, `event=workflow_dispatch` y la rama pedida;
   - encontrado → guarda `run_id` y `run_url`, `in_progress`, y consulta el run cada 10 s;
   - no aparece → `unknown`, con enlace a Actions.
6. **Mapeo del resultado de GitHub:** solo `conclusion=success` es `succeeded` (fuente `provider`). `failure` y `timed_out` → `failed`. `cancelled` → `cancelled`. Cualquier otro (`skipped`, `neutral`, `action_required`) → `unknown`.
7. **Arranque de la app:** los deploys `in_progress` con `run_id` reanudan el sondeo; los `requested` sin run y los SSH `in_progress` pasan a `unknown` (el proceso murió con la app).
8. **Logs:** SSH usa el log que ya guarda `ssh-logs`. Dispatch reutiliza el visor de jobs y logs de Actions con `run_id`.

### Regla de errores

Si algo falla *después* de lanzar el deploy (token revocado durante el sondeo, run que no aparece, red caída) el estado es `unknown`, nunca `failed` ni `succeeded`. `failed` solo con evidencia: exit distinto de 0, conclusión de GitHub, o el POST rechazado antes de ejecutar nada.

### Seguridad

- El token no sale de main; toda salida pasa por `redact()`.
- `ref` se valida con las reglas de nombres de ref de Git; los inputs tienen tope de tamaño.
- El comando SSH lo escribe el usuario y se guarda en SQLite en claro; la UI avisa de no poner secretos dentro.
- Procesos hijos solo vía `exec/run.ts` (el runner SSH usa el servicio SSH existente, que ya cumple esto).

### Códigos de error esperados

`ENVIRONMENT_IN_USE`, `TARGET_BUSY`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_MISMATCH`, `GITHUB_NOT_CONNECTED`, `WORKFLOW_NOT_DISPATCHABLE`, `INPUT_INVALID`, `TARGET_BROKEN`. Lo inesperado se registra en main y se devuelve genérico.

## 3. UI — pestaña Deployments

Código en `src/renderer/src/features/deployments/`, con el estilo de SSH y GitHub (segmentado, `Pill`, modales).

Tres vistas en un segmentado: **Targets · History · Environments**.

- **Targets** (por defecto): columnas por entorno ordenadas por `rank`. Cada tarjeta muestra tipo (icono), destino y pill del último deploy, con botón **Deploy**. *Add target* abre el editor.
- **Editor de target:** SSH → servidor, comando fijo, directorio remoto opcional, aviso de no poner secretos. Dispatch → repo, workflow (de la API), rama por defecto; sin GitHub conectado, pista hacia la pestaña GitHub. Común: entorno y *Ask for confirmation*, forzado y bloqueado si el entorno es protegido.
- **Modal Deploy:** resumen con entorno, target y comando exacto (SSH) o workflow + ref + inputs (dispatch). Dispatch: selector de rama y formulario tipado (string → texto, boolean → check, choice → select, number → numérico). Entorno protegido: hay que teclear el nombre del entorno; el botón queda desactivado hasta que coincida. Al confirmar, el modal se cierra y el deploy aparece en History.
- **History:** pill de estado, entorno, target, ref, tiempo relativo y duración; fuente indicada ("confirmed by exit code" / "confirmed by GitHub"). `unknown` lleva el texto *"Steward can't confirm the result. Check the server or GitHub."* Las filas activas se refrescan con `deployment:get` cada pocos segundos y paran al terminar. Fila desplegable: SSH → cola del log; dispatch → enlace a GitHub más `RunDetail` y `JobLogModal` reutilizados.
- **Environments:** nombre, kind, protegido, flechas de orden; crear, editar, borrar (aviso si tiene targets). **Quitar la protección pide confirmación.**

Cambios en SSH: el campo de entorno del editor de servidores pasa a selector de entornos, con *New environment…* inline; la vista Servers agrupa por `environment_id`.

Estados vacíos: sin entornos → invitación a crear el primero; sin targets → *Add target*; target con servidor o repo borrado → tarjeta "broken", sin botón Deploy.

## 4. Orden de implementación y verificación

Cada capa deja `npm run check` en verde y algo que probar a mano:

1. m012 + m014, tipos y schemas compartidos, servicio de entornos, canales, vista Environments y selector en el editor SSH.
2. `deploy_targets` (m013), servicio, canales, vista Targets y su editor.
3. `deployment.service`, runner SSH, modal Deploy y History con SSH de punta a punta.
4. Dispatch: `github-api`, `workflow-inputs`, runner, formulario de inputs, reutilización de `RunDetail`.
5. Recuperación al arrancar, docs (README, CHANGELOG, vault, nota en `plan.md`) y lista de pruebas manuales.

Sin tests automáticos (regla del proyecto). Pruebas manuales críticas:

- confirmación protegida con nombre erróneo;
- SSH con exit 0, exit distinto de 0 y timeout (debe quedar `unknown`);
- dispatch real contra un workflow propio;
- cerrar la app a mitad de un deploy;
- revocar el token durante el sondeo (debe quedar `unknown`, no `failed`).

Riesgo: m012 toca datos reales (backfill del texto de entorno). Antes de la primera ejecución conviene copiar la base local; la ruta se indicará al terminar la capa 1.

## Criterios de éxito (de `docs/plan.md`, M7)

- Un target `workflow_dispatch` configurado lanza un run real y la fila `deployments` queda enlazada a él (`run_id`, `run_url`).
- El estado es `succeeded` solo si el proveedor reporta éxito o el comando SSH sale con 0; `status_source` dice cuál.
- Desplegar a un entorno protegido exige confirmación que nombra entorno y target.
- Salida y logs del deploy se pueden inspeccionar en la UI.
- Un error del proveedor deja el deploy en `failed` o `unknown`, nunca `succeeded`.

## Ajustes durante el plan

Decididos al escribir e implementar el plan; donde difieren de lo anterior, mandan estos.

1. La config SSH de un target añade `timeoutSeconds` (defecto 120, máximo 300): el defecto de 30 s de `ssh:runCommand` corta deploys reales.
2. `deployments` guarda `target_name`, `target_kind` y `repository_id`; `deploy_target_id` es `NULL`able con `ON DELETE SET NULL`, de modo que borrar un target conserva su historial. `deployments.environment_id` no lleva `ON DELETE` (NO ACTION) y el servicio rechaza borrar entornos en uso.
3. El backfill de m012 usa `key = lower(trim(texto))` (no un slug) para que dos grafías distintas nunca choquen y la migración no pueda fallar.
4. `deployments:start` es asíncrona: valida, registra y devuelve; el runner sigue en segundo plano.
5. Quitar la protección a un entorno exige `confirmed: true`, aplicado en main (no solo en la UI).
6. Un error ambiguo al lanzar el dispatch (sin respuesta de GitHub, o un 5xx, que puede haber encolado el run) no se declara `failed`: se busca el run 12 s y, si no aparece, queda `unknown`. Un rechazo claro (401, 403, 404, 422, rate limit) sí es `failed` de inmediato porque no se encoló nada.
7. Al arrancar, las ejecuciones que quedaron abiertas se cierran como `failed` con código `INTERRUPTED`.
8. Deploy SSH: el comando compuesto imprime `steward: command started` en stderr en cuanto empieza (tras el `cd`, si hay directorio). Sin esa marca, un fallo ocurrió antes de ejecutar (conexión, autenticación, host key, `cd` fallido) y es `failed`. Con la marca, un exit 255 de ssh o la ausencia de exit code puede ser una conexión que murió con el comando en marcha: queda `unknown`, nunca `failed`. Un `~` inicial en el directorio remoto queda fuera de las comillas para que el shell lo expanda.
9. Un run pertenece a un solo deployment: al elegir el run creado por el dispatch se descartan los ya reclamados por otro deployment (comprobación y reclamo en un paso síncrono) y hay un índice único parcial en `deployments.run_id`. Si quedan dos o más candidatos nuevos sin reclamar, el resultado es `unknown` en vez de adivinar.
10. Seguimiento del run: los fallos transitorios (sin red, rate limit, 5xx de GitHub) se esperan con pausa creciente hasta 120 s sin perder el run, hasta el tope de 6 h; los que no se arreglan solos (token, permisos, run desaparecido) dan `unknown` tras 5 intentos seguidos.
11. `request()` de `github-api` mantiene el temporizador mientras lee el cuerpo, para que una respuesta colgada falle en vez de dejar un deployment `in_progress` y su target bloqueado.
