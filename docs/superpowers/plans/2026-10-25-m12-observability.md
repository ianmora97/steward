# M12 — Monitoreo y troubleshooting: plan de implementación

> **Para quien ejecute:** usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`. Los pasos usan casillas `- [ ]`.

**Objetivo:** conectar Grafana, Loki y Prometheus (y Sentry en 12.4) a un proyecto, consultar logs y métricas desde Steward y ofrecer una vista **Investigate** que junta logs de error, señales, alertas, estado del container y los deploys de M7 en una sola línea de tiempo.

**Arquitectura:** contrato `ObservabilityProvider` en main con una implementación por herramienta, sobre un cliente HTTP propio (`src/main/net/net-request.ts`: CA propia, topes, redirecciones al mismo origen). Mismo molde que M10/M11: repo → servicios → fachada `observability.service` → canales `observability:*` (ipc.ts + handlers + preload + schema) → store Zustand + `features/monitoring/`. Todo es lectura.

**Stack:** Electron 45, `node:http`/`node:https` (sin dependencias para HTTP), `uplot` para gráficas, Zod, Zustand, CSS plano con los tokens y componentes de M11.5.

**Spec:** `docs/superpowers/specs/2026-10-23-m12-observability-design.md` · **Base común:** `docs/superpowers/specs/2026-10-23-m8-m13-roadmap-design.md` · **Rama:** `milestone-12-observability` (desde `master` con M11.5 ya mergeado).

## Desviaciones deliberadas respecto a la spec

- **Migraciones m021 y m022**, no m019–m020: esos números ya existen (m019 oculta pestañas opcionales, m020 es el icono de entorno). m021 llega con 12.1 (fuentes + pestaña); m022 con 12.3 (servicios + señales).
- **Pestaña `monitoring` opcional**, como Docker/Mongo/Redis: la fila se inserta en los proyectos existentes **oculta** (`visible = 0`), se añade a `OPTIONAL_TAB_KEYS` y se muestra desde el **+**. Se siembra igual en los proyectos nuevos (`tab.service`).
- **Sin M9 (PM2, cancelado):** Investigate solo muestra el estado del **container** de Docker (M8); el campo "proceso" de la spec no existe.
- **UI con M11.5, no `Pill`:** `Badge`, `ConnectionBar`, `Card`, `ListRow`, `Field`, `Skeleton`, `useAction` + toasts, `Tooltip`. Las dos señales de estado de una fuente son dos `Badge`.
- **HTTP con `node:http`/`node:https`**, no `fetch`: `fetch` no admite CA propia ni `rejectUnauthorized` por petición sin añadir `undici`. Una sola función, sin dependencias.
- **Eventos del tail en vivo** salen por `webContents.send` fuera de `IPC_CHANNELS` (`OBSERVABILITY_EVENTS`), igual que `REDIS_EVENTS` y `DOCKER_EVENTS`.
- **Secreto:** un JSON por fuente en `secret-store` bajo el id de la fuente (`{ token?, username?, password? }`), como `MongoSecret`.
- **Rutas de archivo (CA):** las elige main con un canal `observability:pickFile` que devuelve solo la ruta; ningún otro canal acepta rutas libres del renderer.

## Restricciones globales

- **Sin pruebas automatizadas** (`CLAUDE.md` §1): no hay pasos de test ni TDD. Cada tarea termina con `npm run check` (typecheck + lint) y una lista de **pruebas manuales** para el usuario. Nunca decir "listo" con el check roto.
- **Commits:** Conventional Commits, `CHANGELOG.md` en el mismo commit (bajo `Unreleased`, etiqueta `[M12]`, escrito para un usuario). **Solo se commitea cuando el usuario lo pide.** Termina con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Después de cada tarea: `graphify update .`. Al cerrar el milestone: `Proyecto.md`, `Decisiones.md`, `Estado.md` del vault y `graphify export obsidian --dir vault/steward/graphify`.
- **Solo lectura.** Ningún canal escribe en Grafana/Loki/Prometheus/Sentry. Tokens con permisos mínimos (Grafana: rol **Viewer**; Sentry: `project:read`, `event:read`, `org:read`).
- **Red solo en main.** El renderer nunca abre sockets. La URL base sale siempre de la fuente guardada (`http:`/`https:`, sin credenciales en la URL); las rutas son constantes del proveedor; las queries van como parámetros (`URLSearchParams`), nunca concatenadas.
- **Límites de `net-request`:** timeout 15 s (30 s en `query_range`); respuesta máx. 8 MB → `OBS_RESPONSE_TOO_LARGE`; redirecciones solo al mismo origen, máx. 3, **sin reenviar `Authorization` a otro origen**.
- **Límites de consulta:** Loki 1000 líneas por defecto, máx. 5000, rango máx. 24 h (`OBS_RANGE_TOO_LARGE`); Prometheus: el paso se calcula en main para no superar 11 000 puntos.
- **TLS:** lo normal es `config_json.caFile` (ruta a CA propia). `allow_insecure_tls` exige `confirmed: true` y deja un `Badge` de advertencia permanente en la fuente.
- **Secretos:** tokens y contraseñas solo en `secret-store`; el renderer ve "guardado". Líneas de log y mensajes pasan por `redactSecrets()` antes de salir de main (red de patrones, no garantía: la UI lo avisa).
- **Clientes y timers cerrados** al borrar fuente/proyecto y en `will-quit` (sondeos en vivo incluidos).
- Estado dual: **conexión** (`connected` / `auth_error` / `unreachable`, en memoria) y **operativo** (`healthy` / `degraded` / `failing` / `unknown`, calculado en main, caché 30 s). Un 401 cambia la conexión y no toca lo operativo.
- Dependencia nueva: `uplot` con versión exacta (confirmar con `npm view uplot version license` antes: MIT, JS puro, sin binarios nativos).
- Reglas de UI del repo: fechas/horas solo con `DateTimePicker`; el texto de botones y pestañas no se parte (`IconButton` con `title`/`aria-label` o `flex-wrap`); `margin: 0` en `card__hint` dentro de filas centradas.
- TypeScript estricto (`noUncheckedIndexedAccess`), `import { type X }`, sin `eslint-disable` ni `@ts-ignore` sin razón escrita, comentarios solo para el porqué no obvio. Respuestas al usuario en español, tono directo.

## Review Focus

Entradas o condiciones que la spec implica y que ninguna prueba cubriría sola, de más a menos probable. Cada una tiene su comprobación manual en la tarea dueña.

1. **Tail en vivo con líneas en el mismo nanosegundo:** el sondeo no duplica ni pierde líneas en el borde (`start` = última marca; se descartan las ya vistas por `(ts, línea)`). Las marcas de Loki son nanosegundos en string: no pasan por `Number`. → Tarea 12.2-b.
2. **Rangos y pasos extremos:** `from > to`, `to` en el futuro, rango de 30 días con paso mínimo, `from = to`; nunca se envía una query que Loki/Prometheus rechace por tamaño. → Tarea 12.2-a/b.
3. **URL base rara:** barra final, prefijo de ruta (`https://host/grafana/`), `user:pass@` en la URL (se rechaza), esquema distinto de http(s), IPv6, y un `200` que no es JSON (página de login de un proxy) → error `OBS_BAD_RESPONSE` claro, no un `Unexpected token <`. → Tarea 12.1-a.
4. **Fallo parcial en Investigate:** Loki caído con Prometheus bien, servicio sin container mapeado, entorno sin deploys, deploy tan reciente que no hay ventana "después" completa. Cada sección devuelve su propio resultado o error; la página nunca se queda en blanco por una. → Tarea 12.3-b.
5. **Fuga de secretos:** token en una línea de log, en un mensaje de error de Grafana, en una redirección a otro origen, en la respuesta de IPC de una fuente (`list`/`update`) o en el `.db`. → Tareas 12.1-a/b.

## Estructura de archivos

Crear (main):
- `src/main/net/net-request.ts` — HTTP con CA propia, topes, redirecciones controladas, abort por timeout.
- `src/main/db/observability.repo.ts` — fuentes, servicios y señales.
- `src/main/services/observability-errors.ts` — traduce errores de red/HTTP a `StewardServiceError` (`OBS_*`), todo por `redactSecrets`.
- `src/main/services/observability-provider.ts` — contrato `ObservabilityProvider`, tipos de capacidad y registro por `kind`.
- `src/main/services/provider-grafana.ts`, `provider-loki.ts`, `provider-prometheus.ts`, `provider-sentry.ts` (12.4).
- `src/main/services/observability-source.service.ts` — CRUD de fuentes, secreto, *Test*, estado dual con caché.
- `src/main/services/observability-live.service.ts` — sondeo de logs en vivo con ids de suscripción.
- `src/main/services/observability-catalog.service.ts` — servicios y señales (CRUD, reordenar, señales iniciales).
- `src/main/services/observability-investigate.service.ts` — arma el paquete de Investigate y la comparación antes/después.
- `src/main/services/observability-math.ts` — funciones puras: paso de `query_range`, ventanas antes/después, media y variación.
- `src/main/services/observability.service.ts` — fachada (`purgeProject`, `shutdown`).

Crear (compartido y renderer):
- `src/shared/schemas/observability.ts`
- `src/renderer/src/stores/monitoring.store.ts`
- `src/renderer/src/features/monitoring/`: `MonitoringPanel.tsx`, `SourcesView.tsx`, `SourceDialog.tsx`, `LogsView.tsx`, `MetricsView.tsx`, `DashboardsView.tsx`, `ServicesView.tsx`, `InvestigateView.tsx`, `TimeSeriesChart.tsx` (envoltorio de uPlot), `monitoring-meta.ts`, `monitoring.css`.

Modificar: `src/shared/schemas/tabs.ts` (clave `monitoring`, `OPTIONAL_TAB_KEYS`, `TAB_DESCRIPTIONS`), `src/shared/types/ipc.ts`, `src/shared/types/result.ts` (códigos `OBS_*`), `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/db/migrations/index.ts`, `src/main/services/tab.service.ts`, `src/renderer/src/features/workspace/TabBar.tsx`, `src/renderer/src/App.tsx`, `package.json` / `package-lock.json`.

---

## 12.1 — Fuentes, contrato y Grafana

### Tarea 12.1-a: Red, errores, datos y contrato

**Archivos:** `net/net-request.ts`, `observability-errors.ts`, `observability-provider.ts`, `db/observability.repo.ts`, `schemas/observability.ts`, `migrations/index.ts` (m021), `result.ts`, `tabs.ts`, `tab.service.ts`, `TabBar.tsx`, `App.tsx`.

**Interfaces:**
- Produce `netRequest(options: NetRequestOptions): Promise<NetResponse>`. `NetRequestOptions = { baseUrl: string; path: string; query?: Record<string, string | string[]>; headers?: Record<string, string>; method?: 'GET' | 'POST'; body?: string; timeoutMs?: number; maxBytes?: number; caFile?: string; allowInsecureTls?: boolean; signal?: AbortSignal }`; `NetResponse = { status: number; headers: Record<string, string>; bodyText: string; elapsedMs: number }`. Combina `baseUrl` + `path` respetando el prefijo de ruta de la base y sin doble barra. Lanza `StewardServiceError` ya traducido.
- Produce `translateObservabilityError(error: unknown, context: { kind: ProviderKind }): StewardServiceError` con los códigos `OBS_AUTH_FAILED`, `OBS_FORBIDDEN`, `OBS_UNREACHABLE`, `OBS_TIMEOUT`, `OBS_TLS_FAILED`, `OBS_RESPONSE_TOO_LARGE`, `OBS_RANGE_TOO_LARGE`, `OBS_BAD_QUERY`, `OBS_BAD_RESPONSE`, `OBS_NOT_SUPPORTED`, `OBS_LIVE_LIMIT`.
- Produce en el repo: `ObservabilitySourceRecord`, `listSourcesByProject`, `findSource`, `insertSource`, `updateSource`, `deleteSource`.
- Produce `ObservabilityProvider` según la spec §2, con `ProviderKind = 'grafana' | 'loki' | 'prometheus' | 'sentry'`, `Capability = 'dashboards' | 'alerts' | 'logs' | 'metrics' | 'issues'`, `ConnectionCheck = { state: 'connected' | 'auth_error' | 'unreachable'; version: string | null; identity: string | null; latencyMs: number | null; message: string | null }`, `OperationalCheck = { state: 'healthy' | 'degraded' | 'failing' | 'unknown'; reasons: string[] }`, y `getProvider(kind): ObservabilityProvider`.

- [ ] **Paso 1:** `netRequest`: validar `baseUrl` (solo `http:`/`https:`, sin `username`/`password`, sin fragmento) con `new URL`; construir la URL con `URL` + `URLSearchParams`; elegir `node:http` o `node:https`; leer `caFile` con `readFileSync` (error claro si no existe) y pasarlo en `ca`; `rejectUnauthorized: false` solo si `allowInsecureTls`. Cortar el stream al pasar `maxBytes` (`OBS_RESPONSE_TOO_LARGE`), abortar en `timeoutMs`. Seguir hasta 3 redirecciones **solo si el origen es el mismo**, y quitar `Authorization` si no lo es.
- [ ] **Paso 2:** `observability-errors.ts` siguiendo `redis-errors.ts`: 401 → `OBS_AUTH_FAILED`, 403 → `OBS_FORBIDDEN`, `ECONNREFUSED`/`ENOTFOUND`/`EHOSTUNREACH` → `OBS_UNREACHABLE`, `CERT_*`/`SELF_SIGNED*`/`UNABLE_TO_VERIFY*` → `OBS_TLS_FAILED` con la pista de la CA, 400/422 de Loki/Prometheus → `OBS_BAD_QUERY` con la primera línea del mensaje del servidor, cuerpo no JSON → `OBS_BAD_RESPONSE`. Mensajes por `redactSecrets`.
- [ ] **Paso 3:** m021 (`observability_sources` según la spec §1, `UNIQUE(project_id, name)`) más la fila de pestaña `monitoring` para proyectos existentes con `visible = 0` (mismo `INSERT … SELECT` de m018 pero con `visible = 0`). `kind` admite los cuatro valores desde ya para no migrar en 12.4.
- [ ] **Paso 4:** `schemas/observability.ts`: `observabilitySourceSchema` (sin secretos; `hasSecret: boolean`, `caFile`, `viaSourceId`, `allowInsecureTls`), entradas de crear/actualizar/borrar/probar/`pickFile`, `confirmed: z.literal(true)` cuando `allowInsecureTls` es `true`, `baseUrl` validado con la misma regla que `netRequest`.
- [ ] **Paso 5:** `tabKeySchema` suma `monitoring`; `OPTIONAL_TAB_KEYS` y `TAB_DESCRIPTIONS` ("Logs, metrics and troubleshooting from Grafana, Loki and Prometheus"); `tab.service` siembra la pestaña oculta en proyectos nuevos; `TabBar` (etiqueta "Monitoring", icono) y `App.tsx` (`case 'monitoring'` con un panel provisional).
- [ ] **Paso 6:** `npm run check`; `graphify update .`.

**Pruebas manuales:** `npm run dev` con un proyecto existente: el **+** ofrece Monitoring y al añadirlo aparece la pestaña vacía; los otros proyectos no cambian.

### Tarea 12.1-b: Grafana, estado dual, canales y UI de fuentes

**Archivos:** `provider-grafana.ts`, `observability-source.service.ts`, `observability.service.ts`, `ipc.ts`, `handlers.ts`, `preload/index.ts`, `main/index.ts`, `monitoring.store.ts`, `features/monitoring/{MonitoringPanel,SourcesView,SourceDialog,DashboardsView}.tsx`, `monitoring.css`.

**Interfaces:**
- Consume `netRequest`, `getProvider`, el repo y `secret-store` de 12.1-a.
- Produce `createGrafanaProvider(): ObservabilityProvider` con capacidades `dashboards`, `alerts` y las operaciones `listDashboards(source, query?)`, `listDatasources(source)`, `listAlerts(source)`, `queryDatasource(source, request)` (esta última la usan Loki y Prometheus en 12.2 cuando `viaSourceId` apunta a Grafana).
- Produce `createObservabilityService(deps)` con `{ sources: { list, create, update, remove, test, pickFile }, grafana: { dashboards, datasources, alerts }, purgeProject, shutdown }`; `list` devuelve cada fuente con `connection` y `operational` (caché de 30 s por id de fuente, invalidada por `test`, `update` y `remove`).
- Canales: `observability:sources:list|create|update|delete|test`, `observability:pickFile`, `observability:grafana:dashboards|datasources|alerts`, `observability:openUrl`.

- [ ] **Paso 1:** `provider-grafana.ts`: `checkConnection` con `/api/health` + `/api/user` (identidad, versión, latencia); `checkHealth` cuenta alertas `firing` de `/api/prometheus/grafana/api/v1/rules` (`degraded` si hay alguna, `failing` si el propio endpoint falla con 5xx); `listDashboards` con `/api/search?type=dash-db`; `listDatasources` con `/api/datasources`; `listAlerts` con `/api/alertmanager/grafana/api/v2/alerts`. Cabecera `Authorization: Bearer`. Un 401 devuelve `auth_error` y deja `operational` en `unknown`.
- [ ] **Paso 2:** `observability-source.service.ts`: `create`/`update` guardan el secreto con `secrets.save(id, JSON.stringify(...))` y `config_json` sin secretos; `update` sin secreto nuevo conserva el anterior; `remove` borra el secreto; `purgeProject` borra los de todas las fuentes. Borrar una fuente Grafana de la que otra fuente depende (`via_source_id`) se rechaza con `VALIDATION_FAILED` y un mensaje que nombra a las dependientes.
- [ ] **Paso 3:** `observability:openUrl` recibe `{ sourceId, path }`, construye la URL desde la fuente guardada y solo abre `http:`/`https:` con el `openExternal` ya inyectado en `main/index.ts`. Nunca una URL libre.
- [ ] **Paso 4:** cablear los tres puntos obligatorios por canal (ipc.ts + handlers + preload + schema), `purgeProject` en el borrado de proyecto de `handlers.ts` junto a mongo/redis, `shutdown` en `will-quit`.
- [ ] **Paso 5:** UI. `MonitoringPanel` con subtabs derivadas de las capacidades de las fuentes (en esta fase: Sources y Dashboards). `SourcesView`: `ListRow` por fuente con dos `Badge` (conexión y operativo), `Badge` de advertencia permanente si `allowInsecureTls`, botones *Test* (con `useAction`), editar, borrar con `ConfirmDialog`, "Abrir en Grafana". `SourceDialog`: asistente por tipo (URL, auth, CA con `pickFile`, entorno), el token se pide una vez y al editar muestra "guardado". Estado vacío que explica qué token crear y con qué rol. `DashboardsView`: lista con búsqueda y carpetas, "Abrir" por `openUrl`, panel de alertas activas. Skeleton con `useDelayedFlag` en las cargas.
- [ ] **Paso 6:** `npm run check`; `graphify update .`; línea de CHANGELOG `[M12]`.

**Pruebas manuales (spec §5.1, 5.5, 5.6, 5.9, 5.10):** Grafana con token Viewer → *Test* da versión y latencia; token erróneo → `auth_error` sin tocar lo operativo; URL inexistente → `unreachable`; `https://host/grafana/` con prefijo y barra final funcionan; una URL con `user:pass@` se rechaza; un proxy que devuelve HTML de login da `OBS_BAD_RESPONSE`; CA propia funciona, autofirmado sin CA falla con mensaje claro, el modo inseguro pide confirmar y deja el aviso; en devtools ninguna respuesta de IPC contiene el token y el `.db` tampoco; "abrir" abre el navegador y no hay iframes.

---

## 12.2 — Loki y Prometheus

### Tarea 12.2-a: Prometheus y gráficas

**Archivos:** `provider-prometheus.ts`, `observability-math.ts`, `observability.service.ts`, canales `observability:prometheus:*`, `package.json`, `TimeSeriesChart.tsx`, `MetricsView.tsx`, `monitoring.store.ts`.

**Interfaces:**
- Produce `computeStep(fromMs: number, toMs: number, maxPoints?: number): number` en `observability-math.ts` (segundos; entero ≥ 1; `maxPoints` por defecto 11 000; redondea hacia arriba a un paso "bonito": 1, 5, 15, 30, 60, 300, 900, 3600 s).
- Produce `createPrometheusProvider()` con `queryInstant`, `queryRange`, `targets`, `alerts`, `rules`, `metricNames`; `checkHealth` marca `degraded` si hay targets caídos o alertas `firing` y `failing` si la propia consulta falla. Si la fuente tiene `viaSourceId`, las consultas van por `/api/ds/query` de la Grafana indicada con el UID de datasource guardado en `config_json`.
- Produce `TimeSeriesChart({ series, markers?, height?, unit? })` con `Series = { label: string; points: [number, number][] }` y `Marker = { at: number; label: string; tone: 'info' | 'success' | 'danger' | 'warning' }`.

- [ ] **Paso 1:** añadir `uplot` (versión exacta) y su CSS; comprobar en `npm run dev` que el CSP de la ventana no bloquea nada.
- [ ] **Paso 2:** `computeStep` y validación común de rango (`from < to`, no más de 366 días, `to` no futuro más de 1 min): `OBS_RANGE_TOO_LARGE` o `VALIDATION_FAILED` con mensaje accionable. Prometheus usa timeout 30 s.
- [ ] **Paso 3:** provider Prometheus directo y vía Grafana; `metricNames` con tope y caché corta para el autocompletado.
- [ ] **Paso 4:** canales `observability:prometheus:query|queryRange|targets|alerts|metricNames` (ipc + handler + preload + schema; el `sourceId` sale del canal, nunca una URL).
- [ ] **Paso 5:** `TimeSeriesChart` (crea la instancia en un `useEffect`, la destruye al desmontar, redimensiona con `ResizeObserver`, colores desde tokens, marcas verticales) y `MetricsView`: caja PromQL con autocompletado de nombres, rango (15 m / 1 h / 6 h / 24 h / personalizado con `DateTimePicker`), gráfica multi-serie, tabla instantánea, *Targets* y *Alerts*. Cada fallo se muestra con el hint del error, no en blanco.
- [ ] **Paso 6:** `npm run check`; `graphify update .`; CHANGELOG.

**Pruebas manuales (5.4, 5.6):** `rate(...)` se dibuja; un rango de 30 días con paso pequeño no revienta y el paso se ajusta; `from > to` da un mensaje; una query mal escrita muestra el error de Prometheus en una línea; cambiar de pestaña no deja gráficas ni `ResizeObserver` colgados.

### Tarea 12.2-b: Loki, explorador y tail en vivo

**Archivos:** `provider-loki.ts`, `observability-live.service.ts`, `observability.service.ts`, `OBSERVABILITY_EVENTS` en `ipc.ts`, `handlers.ts`, `preload/index.ts`, `LogsView.tsx`, `monitoring.store.ts`.

**Interfaces:**
- Produce `createLokiProvider()` con `queryRange({ query, fromNs, toNs, limit, direction })`, `labels`, `labelValues(name)`, `volume(query, from, to)` (consulta de métrica `sum(count_over_time(...))`), y `queryInstant`. Tope: `limit` ≤ 5000 (por defecto 1000) y rango ≤ 24 h → `OBS_RANGE_TOO_LARGE`. Cabecera `X-Scope-OrgID` si `config_json.tenant`. Marcas de tiempo como **string de nanosegundos**; el resultado marca `truncated: true` si se alcanzó el tope.
- Produce `LogLine = { tsNs: string; line: string; labels: Record<string, string>; level: 'error' | 'warn' | 'info' | 'debug' | 'unknown' }` (nivel deducido del label `level`/`detected_level` o, si no, del texto) y `LogsResult = { lines: LogLine[]; truncated: boolean; matrix?: Series[] }`.
- Produce `createObservabilityLive(deps)` con `start({ sourceId, query, subscriptionId? }): { subscriptionId: string }` y `stop(subscriptionId)`; emite `OBSERVABILITY_EVENTS.logs = 'observability:logs-live'` con `{ subscriptionId, lines }` y `observability:logs-live-end` al terminar. Máx. 3 suscripciones simultáneas (`OBS_LIVE_LIMIT`).

- [ ] **Paso 1:** provider Loki directo y vía Grafana; las líneas pasan por `redactSecrets` antes de salir de main; las consultas de métrica devuelven matrices para graficar con `TimeSeriesChart`.
- [ ] **Paso 2:** `observability-live`: sondeo cada 2 s con `start` = última marca vista; guardar las líneas ya vistas **de esa marca** (conjunto de `(tsNs, line)`) y descartarlas en la siguiente respuesta; si una consulta falla, pausa creciente y evento de fin tras 3 fallos; se detiene con `stop`, al borrar la fuente/proyecto, al recargar la ventana (`did-start-loading`, igual que Redis) y en `will-quit`.
- [ ] **Paso 3:** canales `observability:loki:labels|labelValues|query|volume` y los de suscripción `observability:logs:startLive|stopLive` (con evento fuera de `IPC_CHANNELS`).
- [ ] **Paso 4:** `LogsView`: selector de fuente Loki, constructor de selector por labels (valores desde `labelValues`), caja LogQL, rango, modo **Live** con pausa, lista virtualizada (mismo enfoque que el grafo de Git; sin dependencia nueva), color por nivel, filtro local, expandir JSON en campos, copiar línea, histograma de volumen encima, aviso de "mostrando las N más recientes" si `truncated`, aviso de que el redactado es una red de patrones.
- [ ] **Paso 5:** `npm run check`; `graphify update .`; CHANGELOG.

**Pruebas manuales (5.2, 5.3):** `{app="api"}` en 15 min; cambiar el rango; **Live** añade líneas nuevas sin duplicar ni perder ninguna aunque lleguen varias en el mismo segundo; pausa y reanudar; una query que devuelve miles de líneas queda en el tope con aviso; un rango > 24 h pide acotar; un token en un log aparece redactado; salir de la pestaña corta el sondeo (comprobable porque Loki deja de recibir peticiones); las mismas queries dan lo mismo directas y vía Grafana.

---

## 12.3 — Servicios, señales e Investigate

### Tarea 12.3-a: Servicios y señales

**Archivos:** `migrations/index.ts` (m022), `observability.repo.ts`, `observability-catalog.service.ts`, `observability.service.ts`, canales `observability:services:*` y `observability:signals:*`, `schemas/observability.ts`, `ServicesView.tsx`, `monitoring.store.ts`.

**Interfaces:**
- Produce `ObservabilityService` y `ObservabilitySignal` (campos de la spec §1) y `renderSignalQuery(template: string, service: { logSelector: string | null; metricMatcher: string | null }): string` — sustituye `{{matcher}}` y `{{selector}}`; si falta el dato que la plantilla necesita lanza `VALIDATION_FAILED` indicando cuál; no interpreta nada más.
- Produce `DEFAULT_SIGNAL_TEMPLATES`: tasa de errores 5xx, latencia p95, CPU y memoria, como plantillas editables basadas en exporters comunes (`http_requests_total`, `http_request_duration_seconds_bucket`, `process_cpu_seconds_total`, `process_resident_memory_bytes`). Se siembran al crear el **primer** servicio del proyecto, no se asumen existentes.

- [ ] **Paso 1:** m022 (`observability_services`, `observability_signals` según la spec §1; `UNIQUE(project_id, environment_id, name)`; FKs con `ON DELETE SET NULL` donde lo dice la spec). Validar al guardar que `log_selector` empieza por `{` y acaba en `}` y que `metric_matcher` no contiene `{`, `}` ni saltos de línea (es el interior de un selector).
- [ ] **Paso 2:** CRUD de servicios y señales, `reorder` de señales (lista completa, rechazar parciales como `reorderTabsInputSchema`), `ssh_host_id` solo de un host del mismo proyecto y `docker_container` con el regex de `docker.ts` (alfanumérico inicial, sin metacaracteres).
- [ ] **Paso 3:** `ServicesView`: tabla de servicios con su mapeo (repo, entorno, selector, matcher, servidor, container), editor de señales con vista previa de la query ya renderizada, reordenar con botones arriba/abajo (icono + `aria-label`).
- [ ] **Paso 4:** `npm run check`; `graphify update .`; CHANGELOG.

**Pruebas manuales (5.7):** mapear `api` con selector LogQL y matcher PromQL; las plantillas generan queries válidas que corren en Metrics y Logs; una plantilla con `{{selector}}` sobre un servicio sin selector dice qué falta; borrar un repo o un host deja el servicio con ese campo vacío en vez de borrarlo.

### Tarea 12.3-b: Investigate

**Archivos:** `observability-investigate.service.ts`, `observability-math.ts`, `observability.service.ts`, canal `observability:investigate`, `InvestigateView.tsx`, `monitoring-meta.ts`, `monitoring.store.ts`.

**Interfaces:**
- Consume `listDeploymentsByProject` (`deployment.repo.ts`), `docker.listContainers`/`inspectContainer` (`docker.service.ts`) con `{ projectId, target: { kind: 'ssh', sshHostId } }`, los providers Loki/Prometheus/Grafana y `renderSignalQuery`.
- Produce `compareWindows(points: [number, number][], atMs: number, windowMs: number): { before: number | null; after: number | null; changePct: number | null }` en `observability-math.ts`: media de los puntos de `[at − window, at)` y de `[at, at + window)`; `null` si no hay puntos en esa ventana o la media previa es 0 (no inventa un porcentaje).
- Produce el paquete `InvestigateResult = { window: { fromMs; toMs; fromLastDeploy: boolean }; deploys: Section<DeployMarker[]>; alerts: Section<AlertMarker[]>; signals: Section<SignalSeries[]>; errorLogs: Section<LogsResult>; container: Section<ContainerState | null>; comparison: Section<SignalComparison[]> }` con `Section<T> = { ok: true; data: T } | { ok: false; code: string; message: string }`. `DeployMarker = { id; atMs; ref; commitSha; status; targetName }`.
- Entrada del canal: `{ projectId, serviceId, environmentId, preset: '15m' | '1h' | '6h' | '24h' | 'since_last_deploy' }` (o `from`/`to` personalizados, validados con `computeStep` y los límites de 12.2).

- [ ] **Paso 1:** `fromMs`/`toMs` desde el preset; "desde el último deploy" usa el deploy más reciente del entorno con estado `succeeded` (`finishedAt ?? requestedAt`) y si no hay ninguno devuelve la sección de deploys vacía y cae a 1 h con `fromLastDeploy: false`, avisándolo.
- [ ] **Paso 2:** reunir las secciones con `Promise.allSettled`: logs de error con `|~ "(?i)error|exception|panic|fatal"` añadido al selector del servicio (editable en la UI), una consulta `queryRange` por señal con el paso de `computeStep`, alertas de Grafana/Prometheus de la ventana, deploys del entorno dentro de la ventana, estado del container si `ssh_host_id`/`docker_container` están mapeados (si no: `data: null`, no es un error). Cada fallo se convierte en `{ ok: false }` de su sección.
- [ ] **Paso 3:** comparación: por cada deploy `succeeded`/`failed` de la ventana, `windowMs = min(15 min, ahora − finishedAt)`; si ese valor es < 2 min, la fila dice "demasiado reciente" en vez de calcular. La UI y el texto del hint dicen que **la comparación no establece causalidad**.
- [ ] **Paso 4:** `InvestigateView`: controles (servicio, entorno, ventana, "desde el último deploy"); línea de tiempo común con deploys y alertas; una `TimeSeriesChart` por señal con las marcas de los deploys; panel de logs de error; tarjeta del container; tabla antes/después con variación %; acciones "Abrir deploy" (cambia a la pestaña Deployments) y "Ver logs del container" (cambia a Docker). Cada sección con su skeleton y su error independiente; estados vacíos explicados (sin fuentes, token caducado, rango demasiado grande, sin datos).
- [ ] **Paso 5:** `npm run check`; `graphify update .`; CHANGELOG.

**Pruebas manuales (5.8):** lanzar un deploy desde M7 y ver su marca; la tabla antes/después coincide con los valores que se ven en Grafana para las dos ventanas; "desde el último deploy" fija la ventana; apagar Loki deja el resto de la página funcionando con un aviso en la sección de logs; un servicio sin container mapeado no muestra error; un deploy de hace 1 minuto dice "demasiado reciente".

---

## 12.4 — Sentry

### Tarea 12.4: Sentry (y tail por WebSocket solo si hace falta)

**Archivos:** `provider-sentry.ts`, `observability-provider.ts` (capacidad `issues`), canales `observability:sentry:*`, `schemas/observability.ts`, `InvestigateView.tsx`, `monitoring-meta.ts`, `SourceDialog.tsx`, nueva subvista `IssuesView.tsx`.

**Interfaces:**
- Produce `createSentryProvider()` con `listIssues(source, { query, statsPeriod })` sobre `/api/0/projects/<org>/<proyecto>/issues/`, `latestEvent(source, issueId)` (stack trace) y `listReleases`. `config_json` lleva `organization` y `project` (validados con `^[a-z0-9_-]{1,100}$`). Token de Sentry en `secret-store`. Servidor `sentry.io` o autohospedado (`baseUrl` de la fuente).

- [ ] **Paso 1:** provider, `checkConnection` por `/api/0/` y `/api/0/organizations/<org>/`, `checkHealth` con el número de issues sin resolver de las últimas 24 h (`degraded` si hay alguna nueva en el último deploy).
- [ ] **Paso 2:** `IssuesView` (lista con filtro, detalle con último evento y stack trace; mensajes por `redactSecrets`) y en Investigate una sección de issues filtrada por `release` = `commitSha` de los deploys de M7.
- [ ] **Paso 3:** decidir con el usuario si el sondeo de 2 s es suficiente; **no** implementar el WebSocket `/tail` ni la dependencia `ws` sin que lo pida.
- [ ] **Paso 4:** `npm run check`; `graphify update .`; CHANGELOG.

**Pruebas manuales:** token Sentry válido/erróneo; la lista de issues coincide con la web; el release de un deploy de M7 filtra los issues correspondientes; un issue con stack trace largo no revienta la vista.

---

## Cierre

- [ ] `npm run check`, `npm run build`.
- [ ] README (estado y tabla de requisitos: Grafana/Loki/Prometheus/Sentry opcionales), `docs/plan.md`, `CHANGELOG.md` al día.
- [ ] `graphify update .`; vault: `Proyecto.md`, `Decisiones.md` (net-request con `node:http`, estado dual, tail por sondeo, migraciones m021/m022, sin M9), `Estado.md` (milestone, qué funciona, qué falta, qué probar); `graphify export obsidian --dir vault/steward/graphify`.
- [ ] Comprobar que la rama se llama como el milestone en curso (`milestone-12-observability`); commit y PR hacia `master` **solo cuando el usuario lo pida**. Después, y no antes, la rama de M13.
