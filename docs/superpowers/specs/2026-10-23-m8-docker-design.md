# M8 — Docker: diseño

Rama: `milestone-8-docker` (desde `master`, tras el PR de M7). Base común: [roadmap](2026-10-23-m8-m13-roadmap-design.md).

## Objetivo

Administrar los containers, imágenes, volúmenes y redes de Docker de un proyecto desde Steward, en la máquina local o en un servidor SSH del proyecto, sin salir de la app: ver estado, arrancar/parar, leer logs en vivo, ver CPU y memoria, abrir una shell dentro de un container y manejar los `docker compose` de sus repositorios.

## Decisiones

| Tema | Decisión |
| --- | --- |
| Acceso a Docker | CLI `docker … --format json` vía `exec/run.ts` y `exec/stream.ts`. Respeta contextos y `DOCKER_HOST`; evita el named pipe de Windows (`npipe:////./pipe/docker_engine`), que da problemas con clientes de librería. |
| Descartado | `dockerode` / Engine API directa: una dependencia más y soporte de pipe irregular en Windows. |
| Remoto | `docker` ejecutado por `ssh` en los servidores SSH del proyecto, con plantillas fijas (nunca texto libre). |
| Datos persistidos | Ninguno de Docker: es la fuente de verdad. Solo la migración de la pestaña. |
| Fuera de alcance | `docker build`, explorar registries, Swarm, Kubernetes, editar Dockerfiles. |

## Objetivo de ejecución: local o servidor

Un selector de **destino** arriba de la pestaña: `Local` o uno de los servidores SSH del proyecto (los mismos de la pestaña SSH, agrupados por entorno). Cada llamada de IPC lleva `target: { kind: 'local' } | { kind: 'ssh', sshHostId }`. Main resuelve el host de la base y verifica que pertenece al proyecto.

- **Local:** `run('docker', [...args])`.
- **Remoto:** se reutiliza `sshService.runCommand` / el builder de argumentos de `ssh-args.ts` (known_hosts propio, `StrictHostKeyChecking=yes`, `BatchMode`). El comando remoto se construye con una plantilla fija por operación y cada valor variable pasa por validación estricta y se entrecomilla (`shellQuote`, el mismo helper de M7). Ids de container/imagen: `^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$`. Nada entra al comando remoto sin validar.
- Un destino remoto sin `docker` en el `PATH` da `DOCKER_NOT_FOUND` con una explicación del servidor; sin permiso sobre el socket (usuario fuera del grupo `docker`) da un error propio con la pista.

## 1. Datos

Una sola migración (m015): añade la pestaña `docker` a los proyectos existentes. No hay tablas nuevas.

## 2. Servicios en main

Nuevos: `docker.service` (operaciones), `docker-exec.ts` (resuelve destino, ejecuta local o remoto y normaliza errores), `docker-parse.ts` (JSON de `docker ps/images/inspect/stats/volume/network`), `docker-errors.ts` (clasifica stderr), `compose.service` (detección y acciones de Compose), `exec/stream.ts` (compartido, ver roadmap).

### Canales (los tres sitios de siempre: `ipc.ts`, `handlers.ts`, preload + schema)

| Canal | Qué hace |
| --- | --- |
| `docker:status` | `docker version --format json`: cliente, servidor, contexto; distingue sin CLI, daemon parado y permiso denegado |
| `docker:containers:list` | `docker ps -a --format json` |
| `docker:containers:inspect` | `docker inspect`, con **variables de entorno enmascaradas en main** |
| `docker:containers:action` | `start`, `stop`, `restart`, `pause`, `unpause`, `kill`, `remove` (`remove` y `kill` exigen `confirmed: true`) |
| `docker:containers:stats` | `docker stats --no-stream --format json` (sondeo cada 5 s solo con la pestaña visible) |
| `docker:logs:start` / `docker:logs:stop` | `docker logs --tail 500 --timestamps -f <id>` como stream |
| `docker:shell:open` | Crea una sesión en el terminal existente con `docker exec -it <id> <shell>` (local) o `ssh -t … docker exec -it` (remoto) |
| `docker:images:list` / `remove` / `pull` | `pull` con progreso por stream; `remove` exige `confirmed: true` |
| `docker:prune` | `container`, `image`, `volume`, `network`, `system`; muestra antes `docker system df` y exige `confirmed: true` |
| `docker:volumes:list` / `remove`, `docker:networks:list` / `remove` | Lectura y borrado con confirmación |
| `docker:compose:list` | Detecta `compose.yaml`, `compose.yml`, `docker-compose.yml/.yaml` en la raíz de cada repositorio del proyecto |
| `docker:compose:action` | `ps`, `up -d`, `down`, `restart`, `pull`, `logs`; `down` con volúmenes exige `confirmed: true` |

Eventos main→renderer (fuera de `IPC_CHANNELS`): `docker:log` y `docker:pull-progress`, con id de suscripción y `offset`.

### Seguridad y reglas

- Argumentos de `docker` siempre en array. Nombres de imagen, ids y rutas de repositorio son datos no confiables; los ids se validan y van tras `--` cuando el subcomando lo admite.
- **Enmascarado de secretos:** `Config.Env` de `inspect` se devuelve con los valores ocultos para claves que casen `SECRET|TOKEN|PASSWORD|PASSWD|KEY|CREDENTIAL|AUTH` (los nombres se ven, los valores nunca llegan al renderer; no hay botón "mostrar"). Los logs pasan por `redact()` antes de salir.
- Docker y Compose usan las credenciales que el usuario ya tenga (`docker login`); Steward no las toca.
- Compose se ejecuta con `cwd` = repositorio validado del proyecto y archivo fijo detectado, nunca una ruta libre.
- Confirmación reforzada: acciones destructivas sobre un servidor cuyo entorno es **protegido** piden teclear el nombre del container (o de la imagen) y muestran el servidor de destino.
- Los logs se limitan a 2000 líneas en el renderer; máximo 6 suscripciones de logs vivas (`DOCKER_TOO_MANY_STREAMS`). Un stream muere al cerrar la pestaña, cambiar de proyecto, borrar el servidor o salir de la app.
- Acciones (no lecturas) se registran en `executions` (`kind: 'docker_action'`, `context` local/remote, `ssh_host_id`).

### Errores

`DOCKER_NOT_FOUND` (sin CLI; guía de instalación), `DOCKER_DAEMON_DOWN` ("Cannot connect to the Docker daemon" / "error during connect": Docker Desktop apagado), `DOCKER_PERMISSION` (socket denegado), `DOCKER_FAILED` (resto, con stderr redactado), más los de SSH ya existentes para destinos remotos.

## 3. UI (`features/docker/`, `stores/docker.store.ts`)

Selector de destino arriba. Subvistas: **Containers**, **Images**, **Volumes & Networks**, **Compose**.

- **Containers:** tabla con estado (`Pill`: running, exited, paused, restarting, unhealthy), imagen, puertos, CPU/mem (stats), uptime. Acciones por fila (iconos) y barra de filtros (estado, texto). Detalle lateral: inspect legible, mounts, redes, healthcheck, env enmascarado, pestaña de **logs** (stream con pausa, filtro, descarga de lo visible) y botón **Shell**.
- **Images:** repo:tag, tamaño, antigüedad, "en uso por" (cruce con containers), pull, borrar; prune de dangling.
- **Compose:** una tarjeta por repositorio con archivo detectado, estado de sus servicios (`compose ps --format json`) y acciones; botón "Open logs".
- Estados vacíos claros: Docker no instalado, daemon apagado (con pasos), destino sin permisos.
- Tras cada acción el listado se recarga; sondeo cada 5 s mientras la pestaña esté visible.

## 4. Fases

1. **8.1** Estado, containers (listar/inspect/start/stop/restart/remove), imágenes (listar/pull/remove), local.
2. **8.2** Logs en vivo, stats, shell en container, Compose, prune.
3. **8.3** Destino remoto por SSH, volúmenes y redes.

Cada fase deja la app funcional y pasa `npm run check`.

## 5. Qué debe probar el usuario (manual)

1. Docker Desktop apagado: la pestaña muestra "daemon no disponible" con pasos, sin errores en consola. Encenderlo y *Refresh*: aparecen los containers.
2. Crear un container (`docker run -d --name steward-test -p 8080:80 nginx`): aparece con puertos; stop/start/restart cambian el estado; remove pide confirmación.
3. Detalle: el env de un container con `-e PASSWORD=x` muestra la clave sin valor; los logs no contienen tokens.
4. Logs en vivo: `docker exec steward-test sh -c 'while true; do date; sleep 1; done'` en otra terminal no afecta; los logs del container se actualizan; cerrar la pestaña mata el stream (no queda `docker.exe logs` en el administrador de tareas).
5. Shell: el botón abre una pestaña de Terminal dentro del container; `exit` la cierra.
6. Imágenes: pull de `alpine`, aparece; borrar una imagen en uso falla con mensaje claro; prune muestra qué se liberará antes de confirmar.
7. Compose: en un repo con `docker-compose.yml`, aparece la tarjeta; `up -d` y `down` funcionan; `down` con volúmenes pide confirmación.
8. Remoto (8.3): elegir un servidor SSH con Docker; la lista es la del servidor; un servidor sin Docker explica el motivo; un entorno protegido pide el nombre exacto para borrar.
9. Cambiar de proyecto/pestaña con logs abiertos: el stream se cierra.

## 6. Límites conocidos

- Sin `docker build` ni explorador de registries.
- Los stats se sondean (no stream) para evitar el parseo de secuencias de pantalla del modo continuo.
- Compose solo en la raíz del repositorio; sin selección de perfiles ni de archivos override en 8.x.
