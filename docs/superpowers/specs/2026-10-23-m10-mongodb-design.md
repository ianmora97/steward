# M10 — MongoDB (tipo Compass): diseño

Rama: `milestone-10-mongodb` (desde `master`, tras el PR de M9). Base común: [roadmap](2026-10-23-m8-m13-roadmap-design.md).

## Objetivo

Un cliente de MongoDB dentro de Steward con el uso diario de Compass: conectar a bases locales, de red interna, por IP o en Atlas, con o sin autenticación y TLS; explorar bases y colecciones; consultar; ver documentos como **lista, JSON o tabla**; insertar, editar y borrar; agregaciones, índices, esquema, import/export. Por fases: la paridad total no cabe en un milestone, y el shell `mongosh` embebido queda como fase opcional.

## Decisiones

| Tema | Decisión |
| --- | --- |
| Driver | `mongodb` oficial, en main. Sin dependencias nativas (no Kerberos, no LDAP). |
| Conexión | Solo directa (IP, host, `mongodb+srv` de Atlas). Sin túnel SSH (decisión del usuario). |
| Filtros | Sintaxis estilo Compass (`{ age: { $gt: 5 }, _id: ObjectId("…") }`) parseada con `mongodb-query-parser`. **Nunca `eval` ni `Function`.** |
| Tipos BSON por IPC | **EJSON canónico** (`{"$oid": …}`, `{"$date": …}`, `{"$numberLong": …}`). `structuredClone` perdería `ObjectId`, `Date` y `Decimal128` y corrompería datos al editar. |
| Edición | `replaceOne({ _id }, doc)` del documento completo; el renderer muestra sintaxis de shell y main la parsea de vuelta. |
| Editor | CodeMirror 6 para la barra de query y el editor de documentos (alternativa: `textarea` en 10.1 si el tamaño preocupa). |
| Escrituras | Bloqueo de solo lectura aplicado en main; por defecto en entornos protegidos. |
| Fuera de alcance | Shell `mongosh` (opcional, 10.4), Kerberos/LDAP, cifrado a nivel de campo (CSFLE), Charts, API de administración de Atlas. |

## 1. Datos (m017)

```
data_connections(id PK, project_id FK→projects ON DELETE CASCADE,
                 environment_id FK→environments NULL ON DELETE SET NULL,
                 kind CHECK IN ('mongodb','redis'),
                 name, host_display,            -- sin credenciales: "cluster0.ab12c.mongodb.net" / "10.0.0.5:27017"
                 options_json,                  -- no secreto, validado por Zod según kind
                 read_only INTEGER CHECK IN (0,1),
                 last_connected_at NULL, created_at, updated_at)
                 UNIQUE(project_id, kind, name)

mongo_saved_queries(id PK, connection_id FK→data_connections ON DELETE CASCADE,
                    namespace,                  -- "db.coleccion"
                    name, kind CHECK IN ('find','aggregate'), body_json,
                    created_at)
```

- `options_json` (mongodb): `authSource`, `authMechanism` (`default`, `none`, `SCRAM-SHA-256`, `SCRAM-SHA-1`, `X509`), `replicaSet`, `readPreference`, `directConnection`, `tls` (bool), rutas `tlsCAFile` / `tlsCertificateKeyFile`, `tlsAllowInvalidCertificates` (solo con confirmación explícita y pill de advertencia permanente), `appName`.
- **La URI completa (con contraseña) y la contraseña de la clave TLS van en `secret-store`**, bajo el id de la conexión, como `{ uri, tlsKeyPassword? }`. El formulario guiado compone la URI en main; el renderer envía la contraseña una vez al guardar y nunca la recibe de vuelta (editar muestra "••••• guardada" y solo reemplaza si se escribe una nueva).
- La tabla `data_connections` es la que M11 reutiliza para Redis.
- `read_only`: se calcula al crear (1 si el entorno es protegido) y el usuario puede cambiarlo; desactivarlo en un entorno protegido exige `confirmed: true`.
- Además: pestaña `mongodb` para proyectos existentes.
- Las queries guardadas son acciones explícitas del usuario; el historial de queries recientes vive solo en memoria del renderer (los valores de las queries pueden contener datos sensibles).

## 2. Servicios en main

`mongo-connection.service` (alta/baja/prueba, gestor de clientes), `mongo-client-pool.ts` (mapa `connectionId → MongoClient`), `mongo-data.service` (find/CRUD), `mongo-admin.service` (colecciones, índices, validación), `mongo-aggregate.service`, `mongo-schema.ts` (analizador), `mongo-ejson.ts` (serializar/parsear), `mongo-errors.ts`.

### Gestor de clientes

- Conexión **perezosa**: se abre al primer uso, se cierra tras 10 min de inactividad, al borrar la conexión o el proyecto y en `will-quit`. Máximo 6 clientes abiertos a la vez.
- `serverSelectionTimeoutMS: 8000`, `connectTimeoutMS: 8000`, `maxPoolSize: 4`, `appName: 'Steward'`. Toda operación lleva `maxTimeMS` (30 s por defecto, configurable hasta 120 s).
- Atlas (`mongodb+srv`): la resolución SRV la hace Node. Si la selección de servidor falla y el host termina en `.mongodb.net`, el error añade la pista "¿tu IP está en la *IP Access List* de Atlas?".
- Descubrimiento local: botón *Detect local* que prueba `localhost:27017` y, si M8 está disponible, ofrece los containers que publican `27017`.

### Canales (agrupados; el detalle exacto se fija en el plan de tareas)

- **Conexiones:** `mongo:connections:list/create/update/delete/test/setReadOnly`.
- **Explorar:** `mongo:databases:list` (nombre, tamaño, colecciones), `mongo:collections:list` (count, tamaño, `avgObjSize`, índices, tipo: colección/vista/timeseries), `mongo:collection:stats`.
- **Consultar:** `mongo:find` `{ connectionId, namespace, filter, projection, sort, skip, limit, maxTimeMS }` → `{ documents: string[] (EJSON), hasMore, elapsedMs }`; `mongo:count` (estimado o con filtro); `mongo:explain`.
- **Escribir** (todas comprueban `read_only` y registran en `executions`, `kind: 'mongo_write'`, sin el contenido): `mongo:insert`, `mongo:replace`, `mongo:updateMany`, `mongo:deleteOne`, `mongo:deleteMany`, `mongo:createCollection`, `mongo:dropCollection`, `mongo:dropDatabase`.
- **Agregación:** `mongo:aggregate` y `mongo:aggregatePreview` (resultado de las primeras N etapas).
- **Índices:** `mongo:indexes:list/create/drop`.
- **Esquema y validación:** `mongo:schema:analyze`, `mongo:validation:get/set`.
- **Import/export:** `mongo:export` (a archivo vía diálogo nativo en main), `mongo:import` (desde archivo), con eventos de progreso.
- **Guardadas:** `mongo:savedQueries:list/save/delete`.

### Reglas de datos

- **Paginación y topes:** `limit` por defecto 20, máximo 1000; respuesta total ≤ 4 MB; un documento de más de 1 MB se devuelve marcado `tooLarge` (se puede ver recortado, no editar). Nunca se envía una colección entera.
- **Borrados masivos:** `deleteMany` / `updateMany` exigen que el renderer haya mostrado el conteo y envíe `expectedCount`; main recuenta con el mismo filtro y rechaza si difiere (`MONGO_COUNT_MISMATCH`). Filtro vacío `{}` pide `confirmed: true` y tecleo del nombre de la colección.
- **Drop de colección o base:** `confirmed: true` + tecleo del nombre exacto; en entornos protegidos, además, el nombre de la conexión.
- **Índices:** crear en una conexión de entorno protegido pide confirmación (puede ser pesado); borrar, también.
- **Agregación:** `$out` y `$merge` solo con la conexión en escritura y `confirmed: true`. `allowDiskUse` opcional. La vista previa de la etapa *n* ejecuta las etapas `0…n` más `$limit: 20`, nunca más.
- **Duplicados y errores del servidor** se mapean a códigos propios con mensaje accionable.

### Errores

`MONGO_AUTH_FAILED`, `MONGO_UNREACHABLE` (selección de servidor; incluye pista Atlas), `MONGO_TLS_FAILED`, `MONGO_TIMEOUT` (código 50 / `maxTimeMS`), `MONGO_NOT_AUTHORIZED` (código 13), `MONGO_QUERY_INVALID` (parseo), `MONGO_DUPLICATE_KEY` (11000), `MONGO_COUNT_MISMATCH`, `MONGO_FAILED`, y `CONNECTION_READ_ONLY` (común).

## 3. UI (`features/mongodb/`, `stores/mongo.store.ts`)

Disposición tipo Compass:

- **Barra lateral:** conexiones del proyecto (con pill de entorno y candado de solo lectura) → bases → colecciones, con filtro de texto y recuento.
- **Conexión nueva:** pestañas *URI* y *Formulario* (host/puerto, usuario, contraseña, authSource, TLS con selectores de archivo, replica set, read preference). *Test connection* informa servidor, versión y latencia, y los errores de §2.
- **Colección** → subvistas **Documents**, **Aggregations**, **Schema**, **Indexes**, **Validation**.
- **Documents:** barra de query (`Filter`, y plegable `Project`, `Sort`, `Skip`, `Limit`, `MaxTimeMS`) con botones *Find* / *Reset* y recientes; selector de vista **List** (árbol expandible con tipos, estilo Compass), **JSON** (texto con copiar) y **Table** (columnas = unión de claves de los documentos cargados, valores anidados plegados, clic para expandir). Paginación con total estimado.
  - **Edición:** en List, doble clic en un valor (editor con tipo); en JSON, editar el documento completo. *Update* aplica `replaceOne`; si el documento cambió en el servidor desde que se cargó, se avisa antes de sobrescribir.
  - **Añadir:** *Insert document* (editor, valida antes) e *Import*. **Clonar** y **Eliminar** por documento (con confirmación). **Export** del resultado del query.
- **Aggregations:** lista de etapas (`$match`, `$group`, `$project`, `$sort`, `$lookup`, `$unwind`, …) cada una con editor y **vista previa** de entrada/salida; modo texto para pegar el pipeline completo; *Explain*; guardar.
- **Schema:** muestra de 1000 documentos con `$sample`; por campo: tipos y %, presencia, valores de ejemplo (analizador propio y pequeño en main).
- **Indexes:** nombre, claves, tamaño, uso (`$indexStats`), propiedades (unique, sparse, TTL, parcial); crear y borrar; avisos de `COLLSCAN` desde *Explain*.
- **Validation:** ver y editar `$jsonSchema`, `validationLevel` y `validationAction`.
- Barra de estado: servidor, versión, latencia, modo (lectura/escritura) y entorno.

## 4. Fases

1. **10.1** Conexiones (URI y formulario, secretos, TLS, Atlas), explorar bases y colecciones, *Find* con **List / JSON / Table**, paginación, topes. Solo lectura.
2. **10.2** Insertar, editar, clonar, borrar; `updateMany`/`deleteMany` con conteo; modo solo lectura y bloqueo en protegidos; auditoría en `executions`; crear/borrar colecciones y bases.
3. **10.3** Agregaciones con vista previa, *Explain*, índices, esquema, validación, import/export JSON/NDJSON/CSV, queries guardadas.
4. **10.4 (opcional)** Shell tipo `mongosh`, GridFS, `currentOp` y estadísticas de rendimiento.

## 5. Qué debe probar el usuario (manual)

1. Conectar a un MongoDB local sin auth (container de M8: `docker run -d -p 27017:27017 mongo`), a uno con usuario y contraseña, a uno con TLS y a un cluster de Atlas con `mongodb+srv`. Contraseña errónea y host inalcanzable dan mensajes distintos; Atlas con tu IP fuera de la lista muestra la pista.
2. Comprobar que la contraseña no está en el `.db` (grep sobre el archivo de la base) ni en la respuesta de `mongo:connections:list` (devtools); reiniciar la app y sigue conectando.
3. Explorar: bases y colecciones con tamaños; una colección grande (≥ 1 M docs) carga la primera página sin congelar la UI.
4. Consultar con `{ age: { $gt: 30 } }`, con `ObjectId("…")`, `ISODate("…")`, `{ $or: [...] }`; probar una query inválida (error claro, sin ejecutarse) y una con `maxTimeMS` bajo sobre una colección grande (`MONGO_TIMEOUT`).
5. Alternar **List / JSON / Table** sobre el mismo resultado: los tipos (`ObjectId`, fecha, `NumberLong`, `Decimal128`) se conservan; editar un campo y guardar no cambia el tipo de los demás.
6. Insertar, clonar, editar y borrar un documento; borrar con filtro que afecta a N documentos pide ver el conteo y falla si cambia entre medias.
7. Conexión de un entorno protegido: nace en solo lectura (botones de escritura bloqueados **y** un intento directo desde devtools devuelve `CONNECTION_READ_ONLY`).
8. Agregación con 3 etapas: la vista previa de cada una; `$out` bloqueado en solo lectura.
9. Índices: crear uno único, ver su uso, borrarlo; *Explain* muestra `IXSCAN` vs `COLLSCAN`.
10. Export de un query a JSON y CSV; import de ese archivo en otra colección.
11. Borrar una conexión o el proyecto cierra el cliente (el servidor deja de ver la conexión).

## 6. Límites conocidos

- Sin shell `mongosh` ni gráficas de rendimiento hasta 10.4.
- Sin Kerberos/LDAP ni CSFLE.
- Las queries recientes no persisten entre reinicios (por privacidad); solo las guardadas.
- CSV: la inferencia de tipos es básica (número, booleano, fecha ISO, texto).
