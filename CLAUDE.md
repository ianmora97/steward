# Steward — instrucciones para Claude

Steward es un workspace de escritorio centrado en proyectos para DevOps: un proyecto agrupa varios repositorios, entornos e integraciones, y cada proyecto tiene sus propias pestañas (Git primero; terminal, SSH, GitHub Actions y despliegues después). Electron + TypeScript + React + Vite + Zustand + Zod, persistencia local en SQLite (`node:sqlite`, sin servidor). El plan completo está en `docs/plan.md`; el estado actual, en `README.md`. Tras M7, la hoja de ruta M8–M13 (Docker, MongoDB, Redis, monitoreo, cloud; M9, PM2, se canceló porque PM2 Plus es de pago) está en `docs/superpowers/specs/2026-10-23-m8-m13-roadmap-design.md`, con una spec por milestone junto a ella.

## Reglas obligatorias

### 1. Sin pruebas automatizadas
- **Nunca** crear, ejecutar ni proponer tests automatizados (unitarios, integración, e2e, Vitest, Playwright, etc.). No añadir dependencias, scripts ni pasos de CI de testing.
- Todas las pruebas son **manuales y las hace el usuario**. Al terminar un cambio, describe qué debe probar a mano (pasos concretos), no lo "verifiques" con una suite.
- La verificación que sí haces tú es estática: `npm run check` (typecheck + lint). Úsala después de cada cambio y antes de decir que algo está listo. Si falla, arréglalo; no digas "listo" con el check roto.

### 2. Leer primero el árbol de graphify
- Antes de explorar el código (Glob/Grep/Read masivos) lee `graphify-out/GRAPH_REPORT.md` y consulta el grafo: `graphify query "<pregunta>"`, `graphify explain "<nodo>"`, `graphify path "A" "B"`. Solo baja a leer archivos concretos cuando el grafo ya te dijo dónde mirar.
- Si `graphify-out/` no existe o está desactualizado, reconstrúyelo antes de seguir (`/graphify .`).

### 3. Mantener graphify actualizado
- Después de cualquier cambio de código o documentación, actualiza el grafo: `graphify update .` (solo código, AST, sin coste de LLM). Si cambiaste docs/imágenes, `/graphify . --update`.
- El hook post-commit (`graphify hook install`) reconstruye el grafo tras cada commit, pero no lo uses como excusa: actualiza al terminar la tarea.
- `graphify-out/` es solo local: está en `.gitignore`, nunca se trackea ni se commitea. El hook post-commit y `graphify update .` lo regeneran en cada máquina.

### 4. Mantener el Obsidian vault actualizado
- El vault vive en `vault/steward/`. La exportación de graphify va en `vault/steward/graphify/` (se regenera con `graphify export obsidian --dir vault/steward/graphify`).
- Además del export automático, mantén a mano las notas de proyecto en `vault/steward/`: `Proyecto.md` (explicación y arquitectura), `Decisiones.md` (decisiones técnicas con fecha y motivo) y `Estado.md` (milestone actual, qué funciona, qué falta, qué debe probar el usuario). Actualízalas al terminar cada tarea relevante.
- Las notas de graphify son generadas: no las edites a mano, se sobrescriben.

### 5. Changelog, ramas y PRs
- `CHANGELOG.md` se actualiza en **cada commit** (bajo `Unreleased`, categorías Added / Changed / Fixed / Removed / Security / Docs / Tooling, con etiqueta de milestone). Sirve como base de las release notes: escribe cada línea pensando en un usuario, no en un diff.
- La rama se llama como el milestone en curso (`milestone-N-descripcion`). Antes de abrir un PR, comprueba que el nombre coincide con el milestone actual; si no, renómbrala.
- Al terminar un milestone: `npm run check`, README y CHANGELOG al día, push y PR hacia `master` **antes** de empezar el siguiente milestone. Luego crea la rama del milestone nuevo.

### 6. Lint y check de código
- `npm run lint` (ESLint), `npm run lint:fix` (arreglos seguros), `npm run typecheck`, `npm run check` (typecheck + lint).
- No silencies reglas con `eslint-disable` ni `@ts-ignore` sin una razón escrita en el mismo comentario.

## Arquitectura (resumen; detalle en el grafo)

```
src/main/      Proceso principal: único lugar con acceso al sistema
  db/          driver node:sqlite, migraciones, acceso a datos
  exec/run.ts  única vía para lanzar procesos hijos (salida completa y con tope)
  exec/stream.ts  misma disciplina, para salida continua (logs en vivo); desde M8
  net/         HTTP con CA propia, topes y redirecciones controladas; desde M12
  security/    validación de rutas, secret-store (safeStorage)
  services/    project, repository, tab, git-* (exec, parse, errors, ops)
  ipc/         definición de canales (sin Electron) + registro
src/preload/   superficie contextBridge, nada más
src/renderer/  UI React; sin Node, sin shell, sin filesystem
src/shared/    tipos y schemas Zod usados en ambos lados
```

Flujo: el renderer llama funciones con nombre de `window.steward` → el preload reenvía a un canal declarado → main valida con Zod y ejecuta un servicio → devuelve `StewardResult<T>`. Añadir una capacidad = canal en `src/shared/types/ipc.ts` + handler en `src/main/ipc/handlers.ts` + binding en `src/preload/index.ts` + schema. Los tres, o no existe.

## Seguridad (no negociable)
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Sin canal genérico `invoke(channel, payload)` ni `runCommand(string)`.
- Procesos hijos solo vía `src/main/exec/run.ts` (y `exec/stream.ts` cuando exista): ejecutable + array de argumentos, nunca `shell: true`, nunca strings concatenados. Nombres de rama, rutas y mensajes son datos no confiables. Comandos remotos por SSH (Docker): plantilla fija por operación, valores validados con regex estricta y entrecomillados; nunca texto libre.
- Clientes de red (MongoDB, Redis, Grafana/Loki/Prometheus/Sentry, AWS, Cloudflare, DNS/TLS) solo en `src/main/`. El renderer nunca abre sockets. Hosts y URLs salen siempre de una conexión guardada, no de un parámetro libre del canal; toda operación con timeout y tope de tamaño de respuesta; clientes cerrados al borrar la conexión/proyecto y en `will-quit`.
- Conexiones de datos y cloud: URIs con contraseña, tokens y access keys van en `secret-store`, nunca en SQLite ni al renderer (que solo ve "guardado"). Certificados TLS por ruta. Una conexión de entorno protegido nace en **solo lectura**, y el bloqueo se aplica en main en cada canal de escritura (`CONNECTION_READ_ONLY`). Las escrituras se registran en `executions` sin contenido de documentos/valores.
- Excepción documentada al "sin canal genérico": la consola de Redis (`redis:execute`, array de argumentos al servidor Redis ya conectado, con denylist y confirmaciones). No hay ni habrá equivalente para el sistema operativo.
- Git es la fuente de verdad: se lee del `git` instalado, no se cachea como sistema de registro. Acciones destructivas (discard, force-delete de rama, abortar merge) exigen confirmación (`confirmed: true` en el schema).
- Los secretos nunca van en la base de datos, en logs ni en el renderer. Toda salida de Git se pasa por `redact()` antes de salir de main.
- Los errores esperados se lanzan como `StewardServiceError` con código; lo inesperado se registra en main y se devuelve genérico.

## Convenciones
- TypeScript estricto (`noUncheckedIndexedAccess`). Imports de tipos con `import { type X }`.
- Comentarios solo para el *por qué* no obvio; el código existente es el modelo de estilo.
- Migraciones SQLite: solo hacia adelante, nunca editar una ya publicada; añadir una nueva en `src/main/db/migrations/index.ts`.
- Dependencias nuevas: versión exacta, comprobar mantenimiento, licencia y que no traigan binarios nativos antes de añadirlas (los clientes de M10–M13 son JS puro). La spec del milestone dice cuáles se esperan.
- Una spec por milestone en `docs/superpowers/specs/`; el plan de tareas se escribe al empezar el milestone, no antes.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`…). Solo commitear cuando el usuario lo pida. `vault/` y `graphify-out/` son solo locales (en `.gitignore`): nunca se trackean ni se commitean.
- Responde en español, tono directo.

## Entorno (Windows)
- Shell principal PowerShell; Bash disponible. Comandos muy largos con heredoc pueden fallar (`ENAMETOOLONG`): escribe archivos grandes con la herramienta Write, no con heredocs.
- Si hay una instancia de Steward abierta, otra instancia no arranca (lock de instancia única). Ciérrala antes de probar con `npm run dev`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
