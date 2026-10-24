# M8–M13 — Hoja de ruta y base común

Estado: diseño aprobado en conversación (2026-10-23); specs escritas, pendientes de revisión. Cada milestone tiene su propia spec, su rama y su PR. Los planes de tareas (`writing-plans`) se redactan al empezar cada milestone, porque dependen del código que dejan los anteriores.

## Orden y ramas

| Milestone | Rama | Spec | Qué entrega |
| --- | --- | --- | --- |
| M8 | `milestone-8-docker` | [m8-docker](2026-10-23-m8-docker-design.md) | Containers, imágenes, volúmenes, redes y Compose, local y remoto por SSH |
| M9 | — | — | **Cancelado (2026-10-24).** PM2 se descartó: su dashboard (PM2 Plus) es de pago y no se quieren servicios de pago. La numeración de M10–M13 no cambia |
| M10 | `milestone-10-mongodb` | [m10-mongodb](2026-10-23-m10-mongodb-design.md) | Cliente MongoDB tipo Compass |
| M11 | `milestone-11-redis` | [m11-redis](2026-10-23-m11-redis-design.md) | Cliente Redis tipo Redis Insight |
| M12 | `milestone-12-observability` | [m12-observability](2026-10-23-m12-observability-design.md) | Grafana, Loki, Prometheus, Sentry y vista de troubleshooting |
| M13 | `milestone-13-cloud` | [m13-cloud](2026-10-23-m13-cloud-design.md) | Dominios, checks, AWS, Cloudflare, topología de producción |

Orden elegido por el usuario: los baratos primero (Docker reusa `run.ts` y el SSH existente), luego los dos clientes de datos, luego lo que depende de todo lo demás.

Regla del repo: un milestone termina con `npm run check`, README y CHANGELOG al día, push y PR hacia `master` **antes** de crear la rama del siguiente. M7 (`milestone-7-deployments`) sigue sin PR: se cierra primero.

## Decisiones del usuario que fijan el alcance

- Sin túnel SSH para las conexiones de Mongo y Redis: solo conexión directa (IP, host, Atlas). Docker remoto va por los servidores SSH que ya existen en el proyecto, porque no tiene otra vía.
- Cloud: AWS y Cloudflare. Monitoreo: Grafana, Loki, Prometheus y, después, Sentry y otros.
- Sin pruebas automatizadas (regla del repo). Cada spec termina con pasos manuales para el usuario.

## Base común

### Pestañas

`tabKeySchema` (`src/shared/schemas/tabs.ts`) gana una clave por milestone: `docker`, `mongodb`, `redis`, `monitoring`, `cloud`. Cada milestone añade una migración que inserta la pestaña en los proyectos existentes y `tab.service` la siembra en los nuevos (mismo patrón que m006, m011 y m014). `settings` sigue fijada al final solo en el renderer.

### Migraciones

El esquema está en v14. Cada milestone añade las suyas a continuación (m015 en adelante); los números exactos se asignan al implementar. Solo hacia adelante, nunca editar una publicada.

### Clientes de red en main (regla nueva para `CLAUDE.md`)

Hasta M7, main solo habla con el exterior por procesos hijos (`git`, `ssh`) y por `fetch` a GitHub. M10–M13 abren sockets propios (MongoDB, Redis, HTTP a Grafana/Loki/Prometheus/Sentry, AWS, Cloudflare, DNS, TLS). Reglas:

- Solo en `src/main/services` (o `src/main/net`). El renderer sigue sin red, sin Node y sin CSP más laxa.
- Todo cliente tiene timeout de conexión y de operación, tope de tamaño de respuesta y cierre en `will-quit` y al borrar la conexión o el proyecto.
- Los hosts y URLs vienen siempre de una conexión guardada, nunca de un parámetro libre de un canal.
- Salida hacia el renderer pasa por `redact()`.
- Para HTTP con CA propia, redirecciones controladas y topes, se añade `src/main/net/net-request.ts` (sobre `node:https`/`node:http`). `github-api` sigue con `fetch`; no se reescribe.

### Streams de proceso: `src/main/exec/stream.ts` (M8)

`run.ts` devuelve la salida entera y con tope; no sirve para `docker logs -f`. M8 añade `streamCommand(file, args, { onChunk, onExit, … })`: mismo contrato que `run.ts` (ejecutable + array de argumentos, nunca `shell: true`, nulos prohibidos, timeout opcional) y devuelve un handle con `kill()`. Lo usa M8 y lo reutilizarán los siguientes milestones que necesiten salida continua. Los eventos main→renderer siguen el patrón de `terminal:data`: fuera de `IPC_CHANNELS`, nombres en `ipc.ts` (el preload sandbox no carga zod), con `offset` para no duplicar, agrupados cada ~100 ms y con un máximo de suscripciones vivas por tipo.

### Conexiones de datos (M10, reutilizado por M11)

Tabla común `data_connections` (ver M10). Cada conexión puede enlazarse a un `environment`. Si el entorno es **protegido**, la conexión nace en **solo lectura** y desbloquear la escritura exige una confirmación explícita por sesión. El bloqueo se aplica **en main**, en cada canal de escritura (`CONNECTION_READ_ONLY`), no solo ocultando botones en la UI.

### Secretos

`secret-store.ts` (safeStorage, un `.bin` por id) se reutiliza tal cual. Una URI de Mongo con contraseña, un token de Grafana o de Cloudflare o una access key de AWS se guardan como un blob JSON bajo el id de su conexión. La base guarda solo metadatos no secretos. Sin `safeStorage` se rechaza guardar. Los certificados y claves de cliente TLS se guardan **por ruta**, como la clave SSH de M5; Steward no las lee salvo para pasarlas al driver.

### Acciones destructivas y auditoría

- `confirmed: true` en el schema Zod, aplicado en main. En entornos protegidos, además, el usuario teclea el nombre exacto del objetivo (patrón de M7).
- Las escrituras se registran en `executions` con `kind` propio (`mongo_write`, `redis_write`, `dns_change`, …), sin contenido de documentos ni valores. Las lecturas no se registran (como Git).

### Estado: conexión y operación por separado

Mismo criterio que M5: la conexión (alcanzable/autenticada) y el estado operativo (sano/degradado/fallando) son dos señales. La conexión vive en memoria (un "conectado" persistido caduca al instante); lo operativo se calcula de la última comprobación. La UI usa `Pill`.

### Códigos de error nuevos

Se añaden a `StewardServiceError`, con un mensaje accionable cada uno: `DOCKER_NOT_FOUND`, `DOCKER_DAEMON_DOWN`, `DOCKER_FAILED`, `MONGO_*`, `REDIS_*`, `OBS_*`, `CLOUD_*`, `CONNECTION_READ_ONLY`. El detalle va en cada spec. Lo inesperado se registra en main y se devuelve genérico.

### Dependencias nuevas (versiones exactas, como en `package.json`)

| Milestone | Paquete | Motivo | Comprobar antes de añadir |
| --- | --- | --- | --- |
| M10 | `mongodb` | Driver oficial | Que el bundle de main lo externalice y se empaquete |
| M10 | `mongodb-query-parser` | Filtros estilo Compass sin `eval` | Mantenimiento y compatibilidad con la versión de `bson` del driver |
| M10 | `@codemirror/*` | Editor de queries y documentos | Tamaño; alternativa: `textarea` en 10.1 |
| M11 | `redis` (node-redis) | Cliente oficial: cluster, sentinel, TLS, ACL | Versión mayor vigente |
| M12 | `uplot` | Gráficas de series temporales (canvas, ligero) | — |
| M13 | `@aws-sdk/client-*`, `@aws-sdk/credential-providers` | Solo los clientes usados (EC2, ELBv2, Route53, CloudFront, ACM, CloudWatch, STS) | Tamaño del bundle |

Cada paquete se verifica (mantenimiento, licencia, binarios nativos) al empezar su milestone. No se añade nada nativo: ni Kerberos ni LDAP en Mongo.

### Proceso por milestone

1. Rama `milestone-N-descripcion` desde `master` actualizada.
2. Plan de tareas (`writing-plans`) a partir de la spec.
3. Implementación por fases verificables (cada fase: `npm run check`).
4. Al terminar cada tarea: `graphify update .`, y si hay docs, `/graphify . --update`; vault (`Proyecto`, `Decisiones`, `Estado`); `CHANGELOG.md` bajo `Unreleased` con etiqueta del milestone.
5. Pruebas manuales del usuario con la lista de la spec; README al día; push y PR hacia `master`.

## Riesgos transversales

- **Tamaño del bundle y empaquetado** (driver de Mongo, SDK de AWS): se mide en cada milestone con `npm run package`.
- **Datos grandes hacia el renderer** (documentos, claves, logs): siempre paginados y con tope en main; nunca se manda una colección entera.
- **Credenciales de producción en un escritorio**: por eso solo lectura por defecto en entornos protegidos, mínimo privilegio documentado en cada integración (políticas IAM, scopes de token) y secretos solo en main.
- **Monitoreo 24/7**: Steward es una app de escritorio; los checks de M13 corren mientras esté abierta. No sustituye a un uptime monitor externo y la UI lo dice.
