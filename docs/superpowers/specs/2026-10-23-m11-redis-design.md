# M11 — Redis (tipo Redis Insight): diseño

Rama: `milestone-11-redis` (desde `master`, tras el PR de M10). Base común: [roadmap](2026-10-23-m8-m13-roadmap-design.md). Reutiliza `data_connections`, el gestor de secretos y la regla de solo lectura de [M10](2026-10-23-m10-mongodb-design.md).

## Objetivo

Un cliente de Redis dentro de Steward con lo esencial de Redis Insight: conectar a instancias locales, remotas, con ACL, TLS, Sentinel o Cluster; navegar claves sin bloquear el servidor; ver y editar todos los tipos de dato; consola de comandos; monitoreo de memoria y rendimiento; pub/sub, slowlog y análisis de memoria.

## Decisiones

| Tema | Decisión |
| --- | --- |
| Cliente | `redis` (node-redis, oficial): standalone, Sentinel, Cluster, TLS, ACL. |
| Conexión | Solo directa (host/IP, Redis Cloud, ElastiCache accesible). Sin túnel SSH (decisión del usuario). |
| Navegación | **`SCAN` siempre, nunca `KEYS`.** Árbol por delimitador (`:` por defecto) construido sobre las claves ya cargadas; el total real sale de `DBSIZE`. |
| Consola | Canal tipado `redis:execute { connectionId, args: string[] }`. Es una desviación consciente de "sin canal genérico" (ver más abajo). |
| Escrituras | Mismo bloqueo en main que M10; en solo lectura se usa `COMMAND INFO` para rechazar cualquier comando con flag `write`/`admin`. |
| Fuera de alcance | Túnel SSH, RedisInsight Copilot/IA, módulos propietarios más allá de RedisJSON, gestión de ACL/usuarios, replicación (`REPLICAOF`). |

## 1. Datos (m018)

Reutiliza `data_connections` con `kind = 'redis'`. Nada nuevo salvo la pestaña `redis` para proyectos existentes y una tabla de comandos favoritos:

```
redis_saved_commands(id PK, connection_id FK→data_connections ON DELETE CASCADE,
                     name, command_text, created_at)
```

- `options_json` (redis): `mode` (`standalone` | `sentinel` | `cluster`), `database` (0–15), `username`, `tls`, `tlsCAFile`, `tlsCertFile`, `tlsKeyFile` (rutas), `tlsAllowInvalidCertificates` (con confirmación), `sentinelMaster`, `sentinels[]` (host:puerto), `keyDelimiter`.
- Secreto en `secret-store` bajo el id de la conexión: `{ password?, sentinelPassword?, tlsKeyPassword? }`.
- Historial de comandos: solo en memoria del renderer; se persisten únicamente los guardados por el usuario.

## 2. Servicios en main

`redis-connection.service` (alta/baja/prueba, pool de clientes), `redis-keys.service` (SCAN, tipos, valores), `redis-write.service`, `redis-cli.service` (tokenizador y ejecución), `redis-info.service` (INFO, slowlog, clientes), `redis-pubsub.service`, `redis-memory.service` (muestreo), `redis-errors.ts`.

### Conexión

- Cliente perezoso con cierre por inactividad (10 min), al borrar la conexión o el proyecto y en `will-quit`; máximo 6 a la vez. `connectTimeout` 8 s; toda operación va envuelta en un timeout de 15 s (los comandos ya enviados no se pueden cancelar en el servidor; los bucles de `SCAN` sí se abortan entre iteraciones).
- Cluster: el escaneo recorre cada nodo maestro; los errores `MOVED`/`ASK` los gestiona el cliente.
- *Detect local*: prueba `localhost:6379` y, con M8 disponible, los containers que publican `6379`.
- *Test connection*: `PING`, versión y modo (`INFO server`), latencia y rol (`master`/`replica`). Una réplica se marca solo lectura aunque el usuario la haya configurado en escritura.

### Navegador de claves

- `SCAN cursor MATCH patrón COUNT 500 [TYPE tipo]` por páginas. El renderer pide la siguiente página; el patrón por defecto es `*`. Para cada clave de la página: `TYPE` y `PTTL` en pipeline.
- Vista **Lista** (clave, tipo, TTL, tamaño bajo demanda) y vista **Árbol** (carpetas por delimitador; el contador de cada carpeta es de lo cargado y la UI lo dice: "N cargadas de ≈ DBSIZE").
- Detalle de clave por tipo, siempre paginado:
  - **string:** `STRLEN`; si > 1 MB se lee solo el primer MB con `GETRANGE`.
  - **hash:** `HSCAN`; **set:** `SSCAN`; **zset:** `ZRANGE … WITHSCORES` paginado; **list:** `LRANGE` paginado; **stream:** `XRANGE`/`XREVRANGE` + `XINFO` (grupos y consumidores); **JSON** (RedisJSON): `JSON.GET`, solo si el módulo está.
  - Metadatos: `OBJECT ENCODING`, `MEMORY USAGE key` (solo bajo demanda, para no pagar claves enormes), TTL.
- **Formateadores de valor:** Texto, JSON (con indentación), Hex, Base64, Binario (detección de UTF-8 inválido → se muestra hex). Los valores binarios viajan como base64 por IPC.

### Escritura

- `SET … KEEPTTL`, `HSET`/`HDEL`, `LPUSH`/`RPUSH`/`LSET`/`LREM`, `SADD`/`SREM`, `ZADD`/`ZREM`, `XADD`/`XDEL`, `RENAMENX`, `EXPIRE`/`PERSIST`, `DEL`/`UNLINK`.
- **Borrado de una clave:** `confirmed: true`.
- **Borrado masivo por patrón:** primero `redis:keys:countPattern` (SCAN completo con tope de 1 M de claves e indicación de "al menos"), el renderer envía `expectedCount`, main vuelve a contar y borra con `UNLINK` por lotes de 500; si difiere, `REDIS_COUNT_MISMATCH`. Patrón `*` exige tecleo del nombre de la conexión.
- Todas las escrituras comprueban `read_only` (`CONNECTION_READ_ONLY`) y se registran en `executions` (`kind: 'redis_write'`, comando y clave, **no** el valor).

### Consola / Workbench (`redis:execute`)

Es una excepción consciente al principio "sin canal genérico", y se cierra así:

- No toca el sistema operativo: va al servidor Redis ya conectado, con **array de argumentos** (el texto de la consola se tokeniza en main con un parser que respeta comillas; no hay shell).
- **Denylist siempre:** `SHUTDOWN`, `DEBUG`, `MODULE`, `REPLICAOF`/`SLAVEOF`, `MONITOR`, `SUBSCRIBE`/`PSUBSCRIBE` (hay UI de pub/sub), `SYNC`/`PSYNC`, `FAILOVER`, `CLUSTER FAILOVER|RESET|FORGET`, `ACL SETUSER|DELUSER`, `CONFIG REWRITE`, `SCRIPT DEBUG`.
- **Confirmación (`confirmed: true`, y tecleo en protegidos):** `FLUSHDB`, `FLUSHALL`, `CONFIG SET`, `CLIENT KILL`, `KEYS` (bloquea el servidor), `EVAL`/`EVALSHA`/`FUNCTION` con escritura.
- **Solo lectura:** `COMMAND INFO <cmd>` decide; cualquier comando con flag `write`, `admin` o `dangerous` se rechaza (`REDIS_COMMAND_BLOCKED`); se cachea por conexión.
- Salida formateada como `redis-cli` (enteros, bulk, listas, nil) con tope de 1 MB y 5000 elementos; los resultados enormes se truncan y se avisa.
- Historial (flechas arriba/abajo) y comandos guardados; autocompletado de nombres desde `COMMAND DOCS`/`COMMAND LIST`.

### Pub/Sub

- Conexión dedicada del cliente por suscripción (no se puede reusar la de comandos). Canales y patrones; mensajes en un ring de 1000 en el renderer; eventos por `redis:message` (fuera de `IPC_CHANNELS`). Máximo 3 suscripciones vivas; se cierran con la pestaña, la conexión o la app. *Publish* manual con el bloqueo de escritura.

### Monitoreo

- **Dashboard:** `INFO` cada 2 s mientras la pestaña esté visible (pausa creciente si falla): ops/s, memoria usada/RSS/máxima, clientes, hit rate (`keyspace_hits`/`misses`), claves expiradas y evictadas, rol y réplicas, persistencia. Ring en memoria con sparklines (≈5 min).
- **Slowlog:** `SLOWLOG GET 128` (+ `RESET` con confirmación). **Clientes:** `CLIENT LIST`. **Config:** `CONFIG GET *` de solo lectura.
- **Análisis de memoria** (11.3): muestrea hasta 5000 claves por `SCAN`, `MEMORY USAGE … SAMPLES 5` cada una, y agrupa por prefijo y tipo; top 20 claves mayores. Se anuncia que es una **muestra**.

### Errores

`REDIS_AUTH_FAILED` (`WRONGPASS`/`NOAUTH`), `REDIS_NOPERM` (ACL), `REDIS_UNREACHABLE`, `REDIS_TLS_FAILED`, `REDIS_READONLY_REPLICA` (`READONLY`), `REDIS_TIMEOUT`, `REDIS_COMMAND_BLOCKED`, `REDIS_COUNT_MISMATCH`, `REDIS_FAILED`, `CONNECTION_READ_ONLY`. Los mensajes remiten a lo accionable ("el usuario no tiene permiso sobre `SCAN`", "es una réplica").

## 3. UI (`features/redis/`, `stores/redis.store.ts`)

- Sidebar de conexiones del proyecto (misma componente base que Mongo: pill de entorno, candado). Formulario de conexión con modo (Standalone / Sentinel / Cluster), TLS y *Test connection*.
- Vistas por conexión: **Browser** (lista/árbol + detalle de clave), **Workbench** (consola), **Pub/Sub**, **Insights** (dashboard, slowlog, clientes, memoria, config).
- Editor por tipo con validación (JSON, números de zset, campos de stream), TTL editable (con *Persist*), rename y copiar nombre de clave.
- Barra de estado: servidor, versión, modo, `db`, latencia, lectura/escritura.

## 4. Fases

1. **11.1** Conexiones (standalone, ACL, TLS), Browser con SCAN, lista/árbol, lectura de todos los tipos, formateadores. Solo lectura.
2. **11.2** Escritura por tipo, TTL, rename, borrado simple y masivo, solo lectura y bloqueo en protegidos, auditoría.
3. **11.3** Workbench, Insights (INFO, slowlog, clientes, config), pub/sub, análisis de memoria.
4. **11.4** Sentinel y Cluster, streams con grupos/consumidores, RedisJSON.

## 5. Qué debe probar el usuario (manual)

1. Conectar a Redis local (container de M8: `docker run -d -p 6379:6379 redis`), a uno con contraseña, a uno con ACL (usuario sin permisos de escritura), a uno con TLS. Errores distintos para contraseña errónea, host inalcanzable y falta de permiso.
2. Con ≥ 100 000 claves (`redis-cli DEBUG POPULATE 100000` en local): la lista carga por páginas sin congelar la UI ni subir la latencia de otro cliente; confirmar que Steward nunca ejecuta `KEYS` (`MONITOR` desde otra terminal).
3. Árbol por `:`: las carpetas se expanden; el contador dice que es de lo cargado.
4. Un valor de cada tipo (string, hash, list, set, zset, stream, JSON): se ve y pagina; un string binario se ve en hex; un string de 5 MB no se carga entero.
5. Editar string, campo de hash y miembro de zset; el TTL se conserva con `SET … KEEPTTL`; crear y borrar claves.
6. Borrado por patrón `sesion:*`: muestra el conteo, borra por lotes; modificarlo en otra terminal antes de confirmar da `REDIS_COUNT_MISMATCH`.
7. Workbench: `GET`, `HGETALL`, `INFO memory`; `SHUTDOWN` y `DEBUG` rechazados; `FLUSHDB` pide confirmación; en solo lectura `SET` se rechaza por el flag `write`.
8. Conexión de un entorno protegido: solo lectura por defecto; un `redis:execute` de escritura desde devtools devuelve `CONNECTION_READ_ONLY`.
9. Insights: ops/s y memoria se mueven al generar carga; el slowlog muestra un comando lento provocado.
10. Pub/Sub: suscribirse a `chat:*` y publicar desde `redis-cli`; cerrar la pestaña cierra la suscripción.
11. Confirmar que la contraseña no está en el `.db` ni en las respuestas de IPC.

## 6. Límites conocidos

- El árbol y sus contadores reflejan las claves cargadas, no toda la base.
- `MEMORY USAGE` por muestreo: estimación, no inventario exacto.
- Sin gestión de usuarios ACL, replicación ni persistencia (solo lectura de `INFO`/`CONFIG`).
- Cluster y Sentinel llegan en 11.4.
