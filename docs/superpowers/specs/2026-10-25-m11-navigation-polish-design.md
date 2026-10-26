# Navegación y pantalla principal (rama M11): diseño

Rama `milestone-11-redis` (a petición del usuario, 2026-10-25; son ajustes de UI sobre el trabajo de M11, no un milestone nuevo). Sin pruebas automatizadas; cada paso termina con `npm run check`.

## Objetivo

Hoy cada servicio es un tab fijo y todos aparecen en todos los proyectos; Git y GitHub son tabs separados que se mezclan; la configuración del proyecto solo reordena tabs; la pantalla principal es escueta. Este cambio ordena la navegación alrededor de **lo que el proyecto realmente usa**.

## Decisiones tomadas con el usuario

| Tema | Decisión |
| --- | --- |
| Git + GitHub | Un solo tab **Git**, con sub-tabs en dos grupos: **Local** = Changes · Activity; **GitHub** = Pull requests · Actions. Selector de repositorio compartido arriba. *Branches* sale de los sub-tabs y pasa a un **modal**. |
| Tabs fijos | **Git** y **Terminal** (siempre). El resto (VPC, Deployments, Docker, MongoDB, Redis) se agrega con **+** y se configura. Settings sigue al extremo derecho. |
| Proyectos existentes | Se conservan solo los tabs opcionales que ya se usan (hay hosts SSH, targets de deploy o conexiones Mongo/Redis); el resto se oculta y sale en el menú **+**. Docker no tiene tablas, así que se oculta y se vuelve a agregar con **+**. El tab GitHub desaparece (su contenido vive en Git). |
| Configuración del proyecto | Cuatro secciones: **General**, **Servicios**, **Integraciones**, **Espacio de trabajo** (repositorios, terminal, entornos). |
| Pantalla principal | Pills de todos los servicios con estado, resumen global arriba y actividad reciente. |

## 1. Tab Git unificado

- `GitPanel` pasa a ser el contenedor único. Barra superior: selector de repositorio (uno solo para Git y GitHub: al cambiarlo se selecciona el mismo repositorio en `git.store` y en `github.store`), chip de rama **clicable** (abre el modal de ramas), Refresh · Fetch · Pull · Push.
- Fila de sub-tabs agrupada, con un separador visual entre grupos y el nombre del grupo como texto tenue: `Local: Changes · Activity   |   GitHub: Pull requests · Actions`.
- **Pull requests / Actions** reutilizan el contenido de `GithubPanel`, sin su cabecera propia: la cuenta conectada (pill "Connected as …") se muestra en la barra de herramientas del grupo y *Disconnect* pasa a Configuración → Integraciones. Si GitHub no está conectado, el sub-tab muestra el formulario de conexión (`ConnectForm`) en su sitio; si el repositorio no tiene remoto github.com, lo dice.
- **Modal de ramas** (`BranchesModal`): el contenido actual de `BranchesView` dentro de `Modal`, con crear rama, cambiar, eliminar; se abre desde el chip de rama y se cierra solo con la X o Esc.
- Se retiran los sub-tabs *Branches* y *Repositories* (los repositorios se administran en Configuración → Espacio de trabajo; con 0 repositorios el tab sigue mostrando `RepositoryPanel` para agregar el primero).

## 2. Barra de tabs

- `TabBar`: tabs visibles = fijos + opcionales con `visible = 1`. Cada opcional muestra una **×** al pasar el cursor (o con foco) que lo quita (oculta); Git y Terminal no la tienen.
- Botón **+** al final de los tabs opcionales: abre un menú con los tabs que faltan (icono, nombre y una línea de descripción: "Conexiones SSH a tus servidores", "Despliegues por entorno", …). Elegir uno lo agrega y lo activa. Si no falta ninguno, el + desaparece.
- Settings queda a la derecha, separado (como hoy).
- **Icono activo azul**: el tab activo pinta su icono con `--accent` (hoy solo cambia la línea inferior).
- Datos: sin tablas nuevas. `workspace_tabs.visible` ya es "agregado". `PINNED_TAB_KEYS = ['git', 'terminal']`. `seedDefaultTabs` crea los opcionales con `visible = 0`; `restoreDefaultTabs` vuelve a ese estado. La clave `github` se conserva en el enum (no se rompe una base vieja) pero deja de existir como tab: nunca se muestra ni se ofrece en el **+**.
- **Migración m019**: marca `pinned = 1` en `terminal`; `visible = 0` en `github` y en los opcionales sin uso (`ssh` sin filas en `ssh_hosts`, `deployments` sin `deploy_targets`, `mongodb` / `redis` sin filas de ese `kind` en `data_connections`, `docker` siempre). Solo hacia adelante.

## 3. Configuración del proyecto (`WorkspaceSettings`)

Vista con navegación lateral (misma estética que los demás paneles) y estas secciones:

1. **General**: nombre, descripción, color e icono del proyecto (columnas `color`/`icon` que ya existen), slug solo lectura; zona de peligro: archivar y eliminar (con la confirmación que ya existe).
2. **Servicios**: la lista de hoy reemplazada por una lista de los tabs opcionales con interruptor "Mostrar en la barra" y orden (↑↓); Git y Terminal aparecen como "siempre activos". *Restore default tabs* se conserva.
3. **Integraciones**: GitHub (estado, usuario, scopes, conectar con token / importar de `gh`, desconectar). Es el mismo almacén y servicio de hoy; solo cambia dónde se gestiona.
4. **Espacio de trabajo**: repositorios del proyecto (`RepositoryPanel`), shell del terminal (`TerminalSettingsPanel`) y entornos (`EnvironmentsView`). Más el bloque "Local storage" que ya existe, abajo.

## 4. VPC con "home"

El tab VPC abre en **Home**: una cuadrícula de tarjetas agrupadas por entorno (Production, Staging…, y "Sin entorno"), una tarjeta por conexión con nombre, host, pill de estado de conexión (`connected`, `unreachable`, `auth_failed`, `host_key_unknown`, sin probar), última comprobación, shells abiertos y resultado del último comando (`healthy`/`failing`). Acciones por tarjeta: **Test** y **Connect** (abre shell en Terminal). Arriba: contadores por estado y **Test all** (secuencial, con tope de 3 a la vez). Clic en el nombre abre el gestor actual (lista + editor) en un segundo sub-tab **Connections**. Estado vacío: invita a crear la primera conexión.

## 5. MongoDB

- Árbol izquierdo: se quita el tamaño ("12 KB") de cada base y se pone un **icono de base de datos** (el mismo `database` del resto de la app) antes del nombre.
- Icono del tab: **logo de MongoDB** (hoja), dibujado monocromo con `currentColor` para que el azul del tab activo (punto 8) le aplique también. Requiere que `Icon` acepte iconos rellenos además de los de trazo.

## 6. Pantalla principal

- **Resumen global** (reemplaza las 4 tarjetas actuales): Proyectos · Repositorios · VPC (alcanzables / total) · Conexiones de datos (Mongo + Redis) · Terminales abiertos.
- **Tarjeta de proyecto**: cabecera como hoy; fila de **pills de servicio** con icono, conteo y punto de estado: repositorios, GitHub (conectado / token inválido / no conectado), VPC (con el peor estado entre sus conexiones), Deployments (targets), Docker (solo si el tab está agregado), **MongoDB** y **Redis** (conteo; candado si alguna es de solo lectura; punto verde si alguna conectó alguna vez). Clic en un pill abre el proyecto en ese tab. Los servicios sin configurar no muestran pill.
- **Actividad reciente**: las últimas 15 acciones de todos los proyectos (commit/fetch/push, comandos SSH, deploys, acciones Docker, escrituras Mongo/Redis) con proyecto, tipo, resumen, estado y hora relativa; clic abre el proyecto.
- Datos: un canal `overview:summary` (por proyecto: repos, GitHub, SSH por estado, conexiones de datos por tipo y solo-lectura, targets, tabs visibles) y `activity:recent` (join `executions` ↔ `projects`, sin repositorio obligatorio, tope 15). Ninguno abre conexiones de red ni de base de datos: el estado sale de lo guardado.

## 7. Estilo

Se respetan las reglas de CLAUDE.md: botones sin partir en dos líneas, filas centradas, pickers propios. Menú **+** y modal de ramas usan `Modal`/popover con los tokens de la app, sin nada nativo.

## 8. Qué debe probar el usuario (manual)

1. Proyecto nuevo: solo Git, Terminal y Settings; **+** muestra VPC, Deployments, Docker, MongoDB, Redis; agregar uno lo activa; la × lo quita; Git y Terminal no tienen ×.
2. Proyecto existente tras migrar (schema v19): quedan solo los servicios que usabas (p. ej. VPC con hosts, MongoDB con conexiones); el resto sale en **+**; no existe el tab GitHub.
3. Git: un selector de repositorio; el chip de rama abre el modal de ramas (cambiar y borrar siguen funcionando); sub-tabs Local / GitHub; Pull requests y Actions funcionan como antes; sin conectar, aparece el formulario de token.
4. Icono del tab activo azul en todos los tabs; icono de MongoDB (hoja) azul al estar activo.
5. Mongo: árbol sin tamaños y con icono de base de datos.
6. VPC: Home con tarjetas por entorno y su estado; *Test* y *Test all* actualizan el pill; *Connect* abre el terminal; sub-tab Connections como antes.
7. Configuración: las cuatro secciones; cambiar nombre/color, mostrar/ocultar servicios, conectar y desconectar GitHub, repositorios, shell del terminal, entornos.
8. Pantalla principal: pills con estado, resumen global, actividad reciente (haz un fetch y un comando SSH y aparecen), clic en un pill abre ese tab.

## 9. Fuera de alcance

Docker con estado en la tarjeta (no hay forma barata sin abrir el daemon), logo oficial de Redis, reordenar tabs arrastrando, y estado en vivo de bases de datos en la pantalla principal.
