# M12 — Monitoreo y troubleshooting: diseño

Rama: `milestone-12-observability` (desde `master`, tras el PR de M11). Base común: [roadmap](2026-10-23-m8-m13-roadmap-design.md).

## Objetivo

Conectar las herramientas de observabilidad del equipo (Grafana, Loki, Prometheus; después Sentry y otras) a un proyecto, consultar logs y métricas desde Steward y, sobre todo, **investigar un incidente**: elegir servicio, entorno y ventana de tiempo y ver juntos logs de error, métricas, alertas activas, estado de containers y procesos, y los **deploys de M7** sobre la misma línea de tiempo.

## Decisiones

| Tema | Decisión |
| --- | --- |
| Estructura | Contrato `ObservabilityProvider` (el "registro de integraciones" que `docs/plan.md` §3 prometió) con una implementación por herramienta. Estado de conexión y operativo por separado. |
| Primera entrega | Grafana, Loki, Prometheus. Sentry en 12.4. Datadog y otros quedan fuera: el contrato se diseña para admitirlos, pero no se implementan sin pedirlo. |
| Acceso a Loki/Prometheus | Directo (URL propia) **o a través de Grafana** (`/api/ds/query` con el UID del datasource): con un solo token de service account se llega a todo. |
| Dashboards de Grafana | No se incrustan (CSP y `X-Frame-Options` lo impiden): se listan, se abren en el navegador (`https:`/`http:` tras allowlist) y se dibujan gráficas nativas con las queries. |
| Gráficas | `uplot` (canvas, ligero). |
| Tail de logs | Sondeo de `query_range` cada 2 s con `start` = última marca de tiempo; el WebSocket de `/tail` (necesita cabeceras de auth y dependencia `ws`) queda para 12.4 si hace falta. |
| Escritura | Ninguna: todo es lectura. Los tokens se piden con permisos mínimos. |

## 1. Datos (m019–m020)

```
observability_sources(id PK, project_id FK→projects ON DELETE CASCADE,
                      environment_id FK→environments NULL ON DELETE SET NULL,
                      kind CHECK IN ('grafana','loki','prometheus','sentry'),
                      name, base_url,                        -- http(s)://…, validada
                      config_json,                           -- no secreto: auth_kind, org/tenant, datasource uid, CA, via_source_id
                      allow_insecure_tls INTEGER CHECK IN (0,1),
                      created_at, updated_at)
                      UNIQUE(project_id, name)

observability_services(id PK, project_id FK, environment_id FK NULL,
                       name, repository_id FK→repositories NULL ON DELETE SET NULL,
                       log_selector,            -- LogQL, p. ej. {app="api",env="prod"}
                       metric_matcher,          -- PromQL matcher, p. ej. job="api"
                       ssh_host_id FK→ssh_hosts NULL ON DELETE SET NULL,
                       docker_container NULL, pm2_process NULL,
                       created_at, updated_at)
                       UNIQUE(project_id, environment_id, name)

observability_signals(id PK, project_id FK, name, kind CHECK IN ('promql','logql_metric'),
                      query_template,           -- admite {{matcher}} y {{selector}}
                      unit, position, created_at)
```

- Credenciales (token de service account, usuario/contraseña básica, token de Sentry) en `secret-store` bajo el id de la fuente; nunca en `config_json`.
- `via_source_id` hace que una fuente Loki/Prometheus se consulte a través de una fuente Grafana del mismo proyecto.
- Además: pestaña `monitoring` para proyectos existentes y *signals* iniciales sembradas por servicio al crearlo (editables): tasa de errores 5xx, latencia p95, CPU y memoria, con plantillas de exporters comunes.
- Las queries guardadas en `observability_signals` son las del usuario; no se asumen nombres de métricas.

## 2. Servicios en main

`observability.service` (fuentes, estado), `observability-provider.ts` (contrato y registro), `provider-grafana.ts`, `provider-loki.ts`, `provider-prometheus.ts`, `provider-sentry.ts` (12.4), `observability-investigate.service` (reúne las señales), `net/net-request.ts` (HTTP con CA propia, topes, redirecciones controladas).

### Contrato

```ts
interface ObservabilityProvider {
  kind: 'grafana' | 'loki' | 'prometheus' | 'sentry';
  capabilities: Capability[];             // 'dashboards' | 'alerts' | 'logs' | 'metrics' | 'issues'
  checkConnection(source): Promise<ConnectionCheck>;   // identidad, versión, latencia
  checkHealth(source): Promise<OperationalCheck>;      // alertas activas, targets caídos…
  // operaciones por capacidad (queryLogs, queryMetrics, listAlerts, listDashboards…)
}
```

Las pestañas y tarjetas se derivan de las capacidades de las fuentes configuradas, no están fijas en código.

### Grafana

`/api/health`, `/api/search?type=dash-db` (dashboards y carpetas), `/api/dashboards/uid/:uid` (paneles, solo metadatos), `/api/datasources`, `/api/ds/query` (consultas a cualquier datasource), alertas gestionadas por Grafana: `/api/prometheus/grafana/api/v1/rules` y `/api/alertmanager/grafana/api/v2/alerts`. Auth: cabecera `Authorization: Bearer <service account token>` con rol **Viewer** (la UI lo recomienda).

### Loki

`GET /loki/api/v1/query_range` (`query`, `start`, `end`, `limit`, `direction`), `/query`, `/labels`, `/label/<nombre>/values`, `/series`. Cabecera opcional `X-Scope-OrgID` (multi-tenant). Límites: 1000 líneas por defecto, máximo 5000, rango máximo 24 h por consulta (más pide acotar). Consultas de métrica LogQL (`rate(...)`) devuelven matrices y se grafican.

### Prometheus

`/api/v1/query`, `/query_range` (el paso se calcula en main para no superar 11 000 puntos), `/api/v1/targets`, `/api/v1/alerts`, `/api/v1/rules`, `/api/v1/label/__name__/values` (autocompletado), `/api/v1/series`.

### Sentry (12.4)

`/api/0/projects/<org>/<proyecto>/issues/?query=is:unresolved&statsPeriod=24h`, evento más reciente con stack trace, y filtro por `release` para cruzarlo con el `commit_sha` de los deploys de M7. Token con scopes `project:read`, `event:read`, `org:read`. Servidor `sentry.io` o autohospedado.

### Seguridad de red

- La URL base viene de la fuente guardada, solo `http:`/`https:`; el resto de rutas son constantes del proveedor. Las queries van como parámetros (`URLSearchParams`), nunca concatenadas.
- Redirecciones: solo al mismo origen (máx. 3). Timeout 15 s (30 s en `query_range`). Respuesta máx. 8 MB (`OBS_RESPONSE_TOO_LARGE`).
- TLS autofirmado: lo normal es **ruta a CA propia** (`config_json.caFile`). `allow_insecure_tls` existe pero exige `confirmed: true` y deja un pill de advertencia permanente en la fuente.
- Líneas de log y mensajes pasan por `redact()` antes de salir de main. Es una red de patrones, no una garantía: se avisa en la UI.
- Los tokens nunca llegan al renderer; editar una fuente muestra "guardado".

### Estado dual

- **Conexión** (en memoria, se comprueba al abrir y con *Test*): `connected` / `auth_error` / `unreachable`.
- **Operativo** (calculado en main, cacheado 30 s): Prometheus → targets caídos y alertas `firing`; Grafana → alertas activas; Loki → la consulta de salud responde. `healthy` / `degraded` / `failing` / `unknown`. Un 401 cambia la conexión a `auth_error` y no toca lo operativo.

### Canales (agrupados)

`observability:sources:list/create/update/delete/test`, `observability:grafana:dashboards/alerts/datasources`, `observability:loki:labels/labelValues/query/volume`, `observability:prometheus:query/queryRange/targets/alerts/metricNames`, `observability:services:list/create/update/delete`, `observability:signals:list/create/update/delete/reorder`, `observability:investigate` `{ serviceId, environmentId, from, to }` → paquete con logs de error, series de cada señal, alertas, deploys de la ventana, estado de container/proceso del servicio; `observability:openUrl` (solo `https:`/`http:` a una URL derivada de una fuente guardada). Fuera de `IPC_CHANNELS`: `observability:logs-live` para el sondeo en vivo, con id de suscripción.

## 3. UI (`features/monitoring/`, `stores/monitoring.store.ts`)

Subvistas de la pestaña **Monitoring**:

- **Sources:** alta con asistente por tipo (URL, auth, CA, entorno), *Test connection*, dos `Pill` (conexión y operativo), enlace "abrir en Grafana".
- **Logs:** selector de fuente Loki, constructor de selector por labels (con valores desde `/label/<n>/values`), caja LogQL, rango (15 m / 1 h / 6 h / 24 h / personalizado), modo **Live** (sondeo 2 s con pausa), lista virtualizada (mismo enfoque que el grafo de Git), color por nivel, filtro local, expandir líneas JSON en campos, copiar. Volumen de logs como histograma encima.
- **Metrics:** caja PromQL con autocompletado de nombres de métricas, rango, gráfica `uplot` multi-serie, tabla instantánea, *Targets* y *Alerts*.
- **Dashboards:** lista de Grafana con búsqueda y carpetas, abrir en el navegador; panel de alertas activas.
- **Services:** definición del mapeo servicio ↔ selectores ↔ servidor/container/proceso, y sus señales.
- **Investigate (la vista de troubleshooting):**
  - Controles: servicio, entorno, ventana (15 m / 1 h / 6 h / 24 h / **desde el último deploy**).
  - Arriba, una **línea de tiempo común** con los deploys de M7 (marca, ref, estado) y alertas; debajo, las gráficas de cada señal con esas marcas, el panel de **logs de error** del servicio (`|~ "(?i)error|exception|panic|fatal"` por defecto, editable) y el estado actual de su container (M8) o proceso (M9) si está mapeado.
  - Tabla **antes / después de un deploy**: para cada señal, media de la ventana previa y posterior (misma duración, p. ej. 15 min) y variación porcentual. Es un cálculo simple y explicable, sin modelos.
  - Acciones de salto: abrir el deploy en Deployments, los logs del container en Docker, los procesos en PM2.
- Errores y estados vacíos explicados (sin fuentes, token caducado, rango demasiado grande, sin datos).

## 4. Fases

1. **12.1** Fuentes y contrato, Grafana (salud, dashboards, alertas, datasources), estado dual.
2. **12.2** Loki (explorador, labels, live por sondeo) y Prometheus (PromQL, gráficas, targets, alertas), acceso directo o vía Grafana.
3. **12.3** Servicios, señales y vista **Investigate** con marcas de deploy y comparación antes/después.
4. **12.4** Sentry, y WebSocket `/tail` si el sondeo se queda corto. Otras herramientas (Datadog, etc.) solo bajo petición.

## 5. Qué debe probar el usuario (manual)

1. Levantar un stack de prueba con Docker (Grafana + Loki + Prometheus) o usar el tuyo. Añadir Grafana con un token Viewer: *Test* muestra versión y latencia; con token erróneo pasa a `auth_error` sin tocar lo operativo; con URL inexistente, `unreachable`.
2. Añadir Loki y Prometheus directos y otra vez vía Grafana: las mismas queries devuelven lo mismo.
3. Logs: `{app="api"}` en 15 min; cambiar el rango; modo **Live** añade líneas nuevas sin duplicarlas; una query que devuelva miles de líneas queda en el tope con aviso; un token en un log aparece redactado.
4. Métricas: una consulta `rate(...)` se dibuja; un rango enorme con paso pequeño no revienta (el paso se ajusta).
5. Dashboards: la lista coincide con Grafana; "abrir" abre el navegador; no hay iframes.
6. Alertas: provocar una alerta `firing` y ver el estado operativo pasar a `degraded`.
7. Servicios y señales: mapear `api` con su selector LogQL y matcher PromQL; las plantillas generan queries válidas.
8. **Investigate:** lanzar un deploy desde M7 y ver su marca en la línea de tiempo; la tabla antes/después coincide con los valores que ves en Grafana para las dos ventanas; "desde el último deploy" fija la ventana.
9. Revisar en devtools que ningún token aparece en respuestas de IPC ni en el `.db`.
10. Fuente HTTPS con CA propia: funciona con la ruta de CA; con certificado autofirmado y sin CA falla con mensaje claro; el modo inseguro pide confirmación y deja un aviso permanente.

## 6. Límites conocidos

- Solo lectura. Sin silenciar alertas ni crear dashboards.
- El tail es sondeo (latencia ≈ 2 s).
- La comparación antes/después no establece causalidad: lo dice la UI.
- Sin Datadog ni otras herramientas hasta que se pidan.
