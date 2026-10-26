# Navegación y pantalla principal: plan de implementación

**Spec:** [m11-navigation-polish-design](../specs/2026-10-25-m11-navigation-polish-design.md). Rama `milestone-11-redis`. Sin tests automatizados (regla del proyecto): cada tarea termina con `npm run check`; las pruebas manuales están en la spec §8. Ejecución nativa, en esta sesión.

## Restricciones globales

- Botones sin partir en dos líneas; filas centradas; ningún input nativo de fecha/hora (CLAUDE.md).
- Migraciones solo hacia adelante: la nueva es **m019**, la 18 no se toca.
- Canales nuevos = canal en `ipc.ts` + handler + preload + schema (los tres).
- Sin pruebas automatizadas.

## Tareas

### 1. Modelo de tabs, migración y barra
- `shared/schemas/tabs.ts`: `PINNED_TAB_KEYS = ['git','terminal']`; añadir `OPTIONAL_TAB_KEYS = ['ssh','deployments','docker','mongodb','redis']` y `TAB_DESCRIPTIONS` (texto del menú +).
- `main/db/migrations/index.ts` **m019**: `terminal.pinned = 1`; `visible = 0` para `github`, y para `ssh`/`deployments`/`mongodb`/`redis` sin filas en `ssh_hosts` / `deploy_targets` / `data_connections` (por `kind`), y `docker` siempre.
- `main/services/tab.service.ts`: `seedDefaultTabs` crea los opcionales con `visible = false` y `github` oculto; `restoreDefaultTabs` igual; `attachIntegrationTab` sigue válido para `github` pero ya no activa nada visible.
- `renderer` `TabBar.tsx`: solo tabs visibles; × en opcionales (llama `setTabVisibility(key,false)`); botón **+** con menú (`AddTabMenu`) de los opcionales ocultos; icono del activo en `--accent`; `App.tsx`: `case 'github'` renderiza `GitPanel`.
- **Hecha cuando:** `npm run check` pasa; un proyecto nuevo muestra solo Git, Terminal y Settings.

### 2. Icono de MongoDB y árbol de Mongo
- `components/Icon.tsx`: soporte de iconos rellenos (`FILLED` set; `fill="currentColor"`, sin trazo) y nuevo `mongodb` (hoja); `TabBar` lo usa para `mongodb`.
- `features/mongodb/Explorer.tsx`: quitar `formatSize(database.sizeOnDisk)` del árbol y poner `<Icon name="database">` antes del nombre.

### 3. Tab Git unificado
- `features/git/GitPanel.tsx`: sub-tabs agrupados (**Local**: Changes, Activity · **GitHub**: Pull requests, Actions); sin Branches ni Repositories; selector de repositorio único que llama `useGitStore.selectRepository` y `useGithubStore.selectRepository`.
- `features/git/BranchesModal.tsx` (nuevo): `BranchesView` dentro de `Modal`; el chip de rama del `GitToolbar` pasa a ser botón que lo abre.
- `features/github/GithubSection.tsx` (nuevo, extraído de `GithubPanel`): props `{ view: 'pulls' | 'actions' }`; incluye la conexión (`ConnectForm`) si no está conectado, la barra de filtros y las listas. `GithubPanel.tsx` se elimina.
- **Hecha cuando:** compila y Pull requests / Actions se alcanzan solo desde Git.

### 4. Configuración del proyecto
- `features/workspace/WorkspaceSettings.tsx` pasa a navegación lateral con `GeneralSection`, `ServicesSection`, `IntegrationsSection`, `WorkspaceSection` (archivos propios en `features/workspace/settings/`).
- General: `window.steward.projects.update` (nombre, descripción, color, icono), archivar/eliminar con `ConfirmDialog`. Servicios: interruptor y ↑↓ sobre `OPTIONAL_TAB_KEYS`, *Restore default tabs*. Integraciones: GitHub con `useGithubStore` (conectar, importar de `gh`, desconectar). Espacio de trabajo: `RepositoryPanel`, `TerminalSettingsPanel`, `EnvironmentsView`, y el bloque de almacenamiento.

### 5. VPC Home
- `features/ssh/SshPanel.tsx`: sub-tabs **Home** · **Connections** (lo actual). `features/ssh/VpcHome.tsx` (nuevo): tarjetas por entorno con pill de estado (`SshHost.connection.state`), última comprobación, shells abiertos, `operational`; acciones *Test* / *Connect*; *Test all* con máximo 3 a la vez.

### 6. Pantalla principal
- `shared/schemas/overview.ts` (nuevo): `OverviewProjectSummary` y `ActivityEntry`; canales `overview:summary` y `activity:recent`; `main/services/overview.service.ts` (agrega repos, integración GitHub, hosts SSH por estado, `data_connections` por `kind` y solo-lectura, `deploy_targets`, tabs visibles; actividad = `executions` ⋈ `projects`, tope 15); handlers + preload.
- `features/overview/Overview.tsx`: resumen global, `ServicePills` en cada tarjeta (clic abre el proyecto en ese tab), `RecentActivity`.

### 7. Cierre
`npm run check`, `npm run build`, CHANGELOG (Changed / Added), README, `docs/plan.md`, `graphify update .`, vault (`Estado`, `Decisiones`, `Proyecto`), `graphify export obsidian`.

## Foco de revisión

- Proyecto cuyo único tab activo era GitHub: tras la migración debe caer en Git, no en "No tab selected".
- Quitar con × el tab activo: se activa Git.
- Proyecto sin repositorios: Git muestra `RepositoryPanel`, sin sub-tabs rotos.
- Proyecto con GitHub conectado y un repo sin remoto github.com: el sub-tab lo explica.
- Overview con 0 proyectos o con servicios sin configurar: sin pills vacías ni errores.
