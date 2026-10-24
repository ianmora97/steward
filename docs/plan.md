# Steward — Repository Assessment & Initial Release Plan

## Context

Steward is to be a project-centric DevOps desktop workspace: one place for Git, terminal, SSH, CI/CD visibility and deployments, per project. Two briefs define it:

- **Notion PRD** (`Product Requirements and Implementation Plan`) — the product: projects that own many repositories, environments, integrations and configurable tabs; GitHub first; integrate with existing CI/CD rather than building one; OS credential vault; local-only persistence with no separate DB server.
- **`GitFlow_Desktop_Specification_for_Claude.pdf`** — confirmed by the user as the **specification for Steward's Git tab**, not a separate product. It was the original idea, since extended into Steward. Its stack, security rules, IPC contract sketch, graph notes and testing strategy are treated as binding for the Git feature area and as strong defaults for the app shell.

The assessment was requested before implementation. This document delivers it, then the roadmap.

---

## 1. Current architecture

**There is none.** The repository is effectively empty.

| | |
|---|---|
| Tracked files | 3 — `.gitignore`, `LICENSE`, `README.md` |
| Commits | 1 (`8a7b599 Initial commit`), branch `master`, remote `github.com/ianmora97/steward` |
| `package.json` | absent |
| Source files (`.ts/.tsx/.js`) | none |
| Electron main / preload / renderer | none |
| UI components, state, persistence, integrations | none |
| Scripts, CI, tests | none |

Details that matter:

- **`.gitignore` is the wrong template** — Flash/ActionScript boilerplate (`bin-debug/`, `*.swf`, `*.air`, `*.ipa`, `.settings/`). It ignores nothing a Node/Electron project needs and does *not* ignore `node_modules/`, `dist/`, `out/`, `release/`, `.env`, or the local SQLite file. Must be replaced in Milestone 1.
- **`LICENSE`** is Apache 2.0. Keep; add the matching `license` field to `package.json`.
- **`README.md`** is a one-line tagline. The PDF requires documented prerequisites/setup; README gets written in M1.
- **`vault/`** is an untracked, empty Obsidian vault (`vault/steward/` with default `.obsidian/` config and the stock `Welcome.md`). Not application code. Decide whether it is docs-in-repo (then track it and ignore `.obsidian/workspace.json`) or personal notes (then `.gitignore` it). No code should depend on it.

**Verified local toolchain** (relevant to feasibility):

```
node v22.21.1    npm 9.5.1    git 2.39.2.windows.1
gh 2.96.0        OpenSSH_9.1p1    platform: win32 / Windows 11
```

`gh` being present makes GitHub token import viable. System `ssh` being present makes the chosen SSH model viable. `npm 9.5.1` is old relative to Node 22 — not blocking, worth bumping.

---

## 2. Feature inventory

Nothing is implemented. Inventory against the combined briefs, so the gap is explicit rather than implied:

### Implemented
*(none)*

### Partially implemented
*(none)* — no scaffolding, stubs or dead code to preserve or work around. The constraint "preserve existing working functionality" is satisfied trivially; the only existing assets to preserve are `LICENSE` and the git history.

### Missing — app shell
- Electron main process, preload bridge, renderer, build pipeline, packaging
- Shared types / Zod schemas / typed IPC contract
- Project CRUD, project switcher, dashboard
- Configurable tab system (reorder / hide / restore, persisted)
- Integration registry and integration contract
- Settings, logging, error surfaces, update path
- Test infrastructure (unit, component, integration-with-temp-repos, Electron e2e)
- CI (type check, test, build, release)

### Missing — Git tab (PDF §4)
- Repository open + work-tree validation, clone with progress, recent repositories
- Status (staged / unstaged / untracked), diff view, stage/unstage file then hunk/line, commit
- Branch list (local + remote), tags, HEAD, upstream; create/checkout/rename/delete with safety checks
- Commit graph: machine-readable `git log` parsing, DAG, lane assignment, SVG render, commit detail
- Fetch / pull / push with progress and auth error handling; merge + abort; standard rebase
- Destructive-action confirmation flows; divergence / detached HEAD / unfinished-operation detection
- Later tier: stash, cherry-pick, revert, reset, reflog, force push, interactive rebase

### Missing — integrations
- GitHub: auth, repo detection from remote, PR list/create, Actions workflow list, run history, statuses, logs
- Terminal: PTY sessions, xterm.js, per-project cwd, session lifecycle
- SSH: host records, connect, remote command execution, output capture
- Deployments: deploy targets, invoke existing workflow / adapter, status + output inspection
- CLI dependency detection ("is `gh` installed?") with authorized install flow

---

## 3. Does the architecture support project-centric workspaces and extensible integrations?

There is no architecture to assess, so the real question is whether the PDF's architecture — which is otherwise binding — is sufficient for the PRD. **It is not, as written, and needs three additions.** The PDF describes a single-repository Git client; the PRD requires a multi-repository, multi-service project workspace.

Gaps to close in the design:

1. **No project aggregate.** The PDF's state is "selected repository". The PRD's root entity is a *project* owning many repositories, environments, integrations and credential references. Fix: introduce `Project` as the aggregate root; every IPC call that touches domain state carries an explicit `projectId`, and repository-scoped Git calls carry `repositoryId` (not a bare path). This avoids the PDF's own warned-about failure mode — mixing state across repositories — and extends it across projects.
2. **No integration abstraction.** The PDF has `github.service.ts` as a concrete service. The PRD requires register / configure / connect / disconnect / validate / operate as a uniform contract with declared capabilities, so services need not implement identical functionality. Fix: an integration registry in main; each integration is a descriptor (`kind`, capabilities set, config schema, credential requirements, validator, operations) + implementation. Tabs, dashboard cards and available actions are derived from registered capabilities, not hardcoded.
3. **Connection status ≠ operational status.** PRD requirement, absent from the PDF. Fix: every integration instance carries two independent fields — `connectionStatus` (`unconfigured | connected | auth_error | unreachable`) and `operationalStatus` (`unknown | healthy | degraded | failing`), each with its own timestamp and last error. A healthy GitHub connection with a failing workflow must render as exactly that.

Everything else in the PDF — Git CLI as source of truth, `contextIsolation: true` / `nodeIntegration: false`, narrow `contextBridge` surface, Zod on every payload, argument arrays never shell strings, `GitOperationResult<T>`, in-memory Git data with only preferences persisted — carries over unchanged and is adopted as the Steward baseline.

One deliberate divergence: the PDF says persist "only app preferences and recent repository paths." Steward must also persist projects, integrations, environments, tab layouts and execution history. The principle is preserved in a narrower form: **Git and provider data are never the system of record** — they are re-read from Git / the GitHub API. Only Steward's own configuration and its own execution records are stored.

### Target structure

Extends the PDF's §6 layout rather than replacing it:

```
steward/
├─ src/
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ ipc/                 # channel registration, Zod validation, result normalization
│  │  ├─ db/                  # connection, migrations/, repositories (data access)
│  │  ├─ security/            # credential vault, path validation, confirmation gating
│  │  ├─ exec/                # process runner, pty sessions, cancellation registry
│  │  └─ services/
│  │     ├─ project.service.ts
│  │     ├─ repository.service.ts
│  │     ├─ git.service.ts  status/branch/history/sync.service.ts
│  │     ├─ terminal.service.ts   ssh.service.ts
│  │     └─ integrations/
│  │        ├─ registry.ts    types.ts
│  │        └─ github/        # client, auth, prs, actions
│  ├─ preload/index.ts
│  ├─ renderer/
│  │  ├─ features/{projects,git,terminal,ssh,actions,deployments,settings}/
│  │  ├─ components/  stores/  App.tsx
│  └─ shared/{types,schemas}/
└─ tests/{unit,integration,component,e2e}/
```

Stack, per the PDF: Electron + TypeScript, React + Vite, Zustand, Zod, Tailwind + shadcn/ui, Octokit, Vitest + React Testing Library, electron-builder. Added for Steward: `better-sqlite3`, `keytar` (or Electron `safeStorage`, see §6), `node-pty` + `xterm.js`. Added only when its milestone begins — not up front.

---

## 4. Local persistence recommendation

**SQLite via `better-sqlite3`, with a versioned migration runner, owned exclusively by the main process.** (Confirmed by the user.)

Rationale against the actual requirements:

- The domain is relational: a project has many repositories, environments, integrations and tabs; executions and workflow runs are append-only, high-volume, and queried by time, status and project. JSON blobs force full read-modify-write and lose integrity.
- Execution history is the deciding factor. `electron-store` would rewrite the entire document on every log flush.
- No separate server — satisfies the PRD's hard constraint. Single file under `app.getPath('userData')`.
- Migrations and portability are first-class: `PRAGMA user_version` + ordered SQL migration files, forward-only, applied at startup inside a transaction, with a pre-migration file copy as backup.
- Synchronous API suits main-process service code and avoids async-transaction footguns.

Trade-offs accepted: native module, so `electron-rebuild` in postinstall and per-platform build config; and binaries must match the Electron ABI in CI. Mitigation: pin Electron, run `electron-rebuild` in `postinstall`, and smoke-test a packaged build in CI from M1 — so the native-module cost is paid on day one rather than discovered at packaging time.

Rejected: `electron-store` alone (no relational queries, no migrations, history rewrite cost); `node:sqlite` (still experimental, API churn); any client/server DB (violates the no-server constraint).

Kept out of SQLite: window bounds and last-open UI state → a tiny JSON file (`electron-store` or plain write). Secrets → never in the DB (§6). The DB holds **credential references only**.

---

## 5. Proposed data model

SQLite. `id TEXT PRIMARY KEY` = UUID v7 so ids sort by creation. All timestamps `TEXT` ISO-8601 UTC. `FOREIGN KEY ... ON DELETE CASCADE` with `PRAGMA foreign_keys = ON`. `PRAGMA journal_mode = WAL`.

```
schema_migrations(version INTEGER PK, applied_at)
app_settings(key PK, value_json)

projects(id PK, name, slug UNIQUE, description, icon, color,
         created_at, updated_at, archived_at NULL)

repositories(id PK, project_id FK→projects, name, local_path, provider,
             remote_name, remote_url, default_branch,
             role,                       -- 'primary' | 'service' | 'infra' | 'docs'
             service_name NULL,          -- microservice label inside the project
             created_at, last_opened_at)
             UNIQUE(project_id, local_path)

environments(id PK, project_id FK, key, name,
             kind,                       -- 'development' | 'staging' | 'production' | 'custom'
             rank INTEGER, is_protected INTEGER,  -- gates destructive/deploy confirmations
             config_json, created_at, updated_at)
             UNIQUE(project_id, key)

integrations(id PK, project_id FK, kind,  -- 'github' | 'ssh' | 'terminal' | 'actions' | ...
             display_name, config_json,
             connection_status, connection_checked_at, connection_error NULL,
             operational_status, operational_checked_at, operational_error NULL,
             capabilities_json,           -- snapshot of what this instance negotiated
             credential_ref_id FK→credential_refs NULL,
             enabled INTEGER, created_at, updated_at)
             UNIQUE(project_id, kind, display_name)

credential_refs(id PK, service, account,
                backend,                 -- 'os_keychain' | 'encrypted_file'
                scope_hint,              -- e.g. 'repo,workflow' — metadata, never the secret
                created_at, last_used_at)
                UNIQUE(service, account)
                -- NO secret column. Ever.

ssh_hosts(id PK, project_id FK, environment_id FK→environments NULL, label,
          hostname, port, username,
          auth_mode,                     -- 'agent' | 'key_file' | 'system_config'
          identity_file_path NULL,       -- path only; key material never read into Steward
          use_system_config INTEGER, strict_host_key_checking,
          jump_host NULL, created_at, last_connected_at)

deploy_targets(id PK, project_id FK, environment_id FK, name,
               kind,                     -- 'github_workflow_dispatch' | 'ssh_command' | 'adapter'
               integration_id FK→integrations NULL, ssh_host_id FK→ssh_hosts NULL,
               config_json,              -- workflow file, ref, inputs schema, or command spec
               requires_confirmation INTEGER, created_at, updated_at)

workspace_tabs(id PK, project_id FK, tab_key,  -- 'git' | 'terminal' | 'ssh' | 'actions' | ...
               position INTEGER, visible INTEGER, pinned INTEGER,
               source,                   -- 'builtin' | 'integration'
               integration_id FK→integrations NULL, updated_at)
               UNIQUE(project_id, tab_key)
               -- 'git' seeded at position 0 on project creation (PRD requirement)

executions(id PK, project_id FK, repository_id FK NULL,
           environment_id FK NULL, ssh_host_id FK NULL, deploy_target_id FK NULL,
           kind,                         -- 'git_op' | 'local_command' | 'ssh_command'
                                         -- | 'deploy' | 'workflow_dispatch' | 'cli_install'
           context,                      -- 'local' | 'remote'  (never conflated)
           command, args_json, cwd, redacted_env_keys_json,
           status,                       -- 'pending'|'running'|'succeeded'|'failed'
                                         -- |'cancelled'|'timed_out'
           exit_code NULL, confirmed_by_user INTEGER,
           started_at, finished_at NULL, duration_ms NULL,
           log_path NULL,                -- large output spills to a capped file
           error_code NULL, error_message NULL)

execution_log_chunks(execution_id FK→executions, seq INTEGER,
                     stream,             -- 'stdout' | 'stderr'
                     chunk, ts, PRIMARY KEY(execution_id, seq))
                     -- bounded ring per execution; overflow → log_path

workflow_runs(id PK, project_id FK, integration_id FK, repository_id FK NULL,
              provider,                  -- 'github_actions'
              provider_run_id, provider_run_url, workflow_name, workflow_path,
              event, branch, commit_sha,
              status, conclusion, started_at, finished_at,
              synced_at)                 -- mirror/cache, not system of record
              UNIQUE(integration_id, provider_run_id)

deployments(id PK, project_id FK, environment_id FK, deploy_target_id FK,
            execution_id FK→executions NULL, workflow_run_id FK→workflow_runs NULL,
            commit_sha NULL, ref NULL, version NULL,
            status,                      -- 'requested'|'in_progress'|'succeeded'
                                         -- |'failed'|'cancelled'|'unknown'
            status_source,               -- 'provider' | 'exit_code'  — never inferred optimistically
            url NULL, requested_at, finished_at NULL, notes NULL)
```

Modelling notes:

- **Multi-repo projects** are first-class: `repositories.role` + `service_name` let a project hold a web app, an API and infra repos without implying one deployable.
- **Tabs are rows, not code.** `workspace_tabs` is seeded with `git` at position 0; configuring an integration inserts its tab (PRD: auto-enable); hiding sets `visible = 0` and keeps the row so "restore" is possible.
- **Execution history is uniform** across git ops, local commands, SSH commands, workflow dispatches and deploys — one table, one status vocabulary, `context` always explicit. This is what makes the dashboard and audit view possible without per-feature history tables.
- **`deployments.status_source`** enforces the PRD rule that Steward must not claim success unless the underlying operation actually succeeded.
- **Secrets are absent by construction.** `credential_refs` stores a lookup key; the value lives in the OS vault.

---

## 6. Security review

### Electron / IPC
| Control | Requirement |
|---|---|
| Window config | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `nodeIntegrationInWorker: false` |
| Bridge | `contextBridge` exposes only named functions. Never `child_process`, `fs`, `ipcRenderer`, `require`, or any generic `invoke(channel, payload)` passthrough — a generic channel re-creates arbitrary RCE through a "secure" boundary |
| Validation | Zod `.parse()` on every payload **in main** before use. Renderer-side validation is UX only |
| No generic exec endpoint | No `runCommand(string)` IPC. Local execution is reachable only through the terminal PTY session API (explicitly user-driven) and allowlisted service operations |
| Navigation | Deny `will-navigate` / `setWindowOpenHandler` for non-app origins; external links via `shell.openExternal` after URL-scheme allowlist (`https:` only) |
| CSP | Strict CSP on the renderer document, no `unsafe-eval`; no remote script origins |
| Errors | Normalize at one boundary into `GitOperationResult<T>`; never return raw process objects, full env, or unbounded output to the renderer |
| Output bounds | Cap per-execution bytes streamed to the renderer; spill the rest to a capped log file |

### Local command execution
- `spawn(file, argsArray)` — **never** `shell: true`, never string concatenation. Branch names, paths, commit messages, remote output and repository content are untrusted input (a branch literally can be named `$(rm -rf ~)`).
- Fixed Git subcommand allowlist per service method. `git` arguments that are user data are passed after `--` where the subcommand supports it; refs are validated with `git check-ref-format` before use.
- Repository paths: resolve, reject non-absolute, reject traversal, confirm the path is inside a known project's declared roots, and verify it is a Git work tree before any operation.
- Preflight + explicit confirmation for: force push, `reset --hard`, discard changes, delete branch with unmerged work, rebase, deploy to a protected environment. Confirmation shows the exact command, the target, and the execution context (`local` vs which SSH host). `executions.confirmed_by_user` records that it happened.
- Cancellation: every long-running execution is registered with its PID/handle; cancel sends `SIGTERM` then escalates, and the row ends in `cancelled`, not `failed`.
- Timeouts on all non-interactive executions.
- CLI install (`gh`, etc.): detect → explain → propose the exact command → require authorization → run → verify by re-detecting. Never silent install.

### SSH
- **Spawn the system OpenSSH client** (`ssh` 9.1p1 is present). Steward never parses, loads or stores private keys or passphrases; the user's agent, `~/.ssh/config` and credential helpers do their job. This removes the single largest credential-handling surface.
- `strict_host_key_checking` defaults to enabled; host-key prompts surface in the UI as a decision, never auto-accepted.
- `ssh_hosts.identity_file_path` is a path, not key material.
- Remote execution uses the same argument-array discipline; remote commands are never built by string interpolation of UI fields.
- Local and remote contexts are visually and structurally distinct (`executions.context`), so a destructive command can never be confirmed against the wrong machine.

### Credentials
- Primary: OS vault — Windows Credential Manager / macOS Keychain / libsecret, via `keytar` or Electron `safeStorage`. **Decision needed, see §9.**
- Fallback (headless Linux without a keyring): AES-256-GCM file encrypted with a key held by `safeStorage`/DPAPI — key never co-located with ciphertext, no custom crypto scheme. Documented, and the fallback is visible to the user.
- Tokens live only in the main process. Never in renderer state, Zustand, Redux devtools, crash dumps, or `app_settings`.
- Redaction layer on all logging: token patterns, `Authorization` headers, `GITHUB_TOKEN`/`*_SECRET`/`*_PASSWORD` env keys, SSH passphrases. `executions` stores `redacted_env_keys_json` — key names only, never values.
- Minimum GitHub scopes (`repo`, `workflow` only when Actions/dispatch is configured). Scope hint stored for display; token value is not.
- Importing a token from `gh auth token` requires explicit user action and is labelled as such.

---

## 7. Prioritized roadmap

Dependencies are strict: each milestone depends on all previous ones.

**M1 — Foundation & projects** *(the recommended first milestone — see §10)*
Electron + Vite + React + TS scaffold; secure window config; preload bridge; Zod-validated typed IPC; SQLite + migration runner; `projects` / `repositories` / `workspace_tabs` tables; project CRUD + switcher; repository add with work-tree validation; tab system with `git` seeded first; dark app shell; correct `.gitignore`; README setup docs; Vitest + CI (typecheck, test, packaged-build smoke).

**M2 — Git tab, everyday operations** (PDF §4.1–4.2, §4.4 core)
Status (staged/unstaged/untracked); diff view; stage/unstage file; commit; branch list/create/checkout/delete with safety checks; fetch/pull/push with progress and auth-error handling; normalized errors; destructive-action confirmations; `executions` rows for every Git op.

**M3 — Commit graph** (PDF §5)
Machine-readable `git log` + `for-each-ref` parsing; DAG by hash/parents; lane assignment; SVG render; commit selection → metadata + changed files; refresh after every mutating op; paging/virtualization for large histories.

**M4 — Terminal**
`node-pty` + `xterm.js`; per-project sessions with project/repo cwd; session lifecycle, resize, close; output capped and persisted to `executions`; multiple tabs; no generic exec IPC.

**M5 — SSH**
`ssh_hosts` CRUD; connect via system `ssh`; interactive remote shell in the terminal surface; one-shot remote commands with captured exit code/stdout/stderr; host-key policy UI; remote context clearly marked; connection status separate from operational status.

**M6 — GitHub integration: PRs + Actions**
Integration registry + contract; GitHub integration (PAT in OS vault, import from `gh`); repo detection from remote; PR list + create (base/head/title/body/draft, browser link); workflow list; run history with status/conclusion; log retrieval within API limits; dual-status display.

**M7 — Deployments**
`deploy_targets` + `environments` CRUD; invoke an existing GitHub Actions workflow via `workflow_dispatch` with typed inputs; or an SSH deploy command; correlate to `deployments` with `status_source`; surface real status and output; protected-environment confirmation; never report success without provider/exit-code evidence.

Deferred past the initial release: interactive rebase, stash/cherry-pick/revert/reflog, hunk/line staging, multi-provider Git, Docker, DB admin, Playwright, observability, FTP/SFTP, templates, team sharing, OAuth device flow.

---

## 8. Acceptance criteria

**M1**
- `npm run dev` starts the app; `npm run build` succeeds; a packaged build is produced by CI.
- Renderer has no Node access: `typeof window.require === 'undefined'`, `process` undefined, and an automated test asserts the preload surface contains no `exec`/`fs`/`ipcRenderer` member.
- Creating a project persists it; restarting the app lists it; the DB file lives under `userData`.
- Migration runner applies v1 on a fresh DB and is a no-op on second start; `user_version` reflects the applied version; a backup copy is made before migrating.
- Adding a folder that is not a Git work tree produces a clear in-UI error (not console-only); a valid repo is accepted and bound to the project.
- Every new project shows the Git tab at position 0; hiding and restoring a tab survives restart.
- An IPC call with a malformed payload is rejected by Zod in main and returns a typed error, with a test proving it.
- Typecheck + test suite pass; README documents prerequisites, setup, dev and build commands.

**M2**
- Status reflects real `git status` output across staged/unstaged/untracked, including renames, deletions and binary files.
- Stage → commit → the commit appears in `git log` in a temp repo integration test.
- Discard and branch-delete-with-unmerged-work both require confirmation showing exactly what is lost; declining changes nothing.
- A branch named `$(touch pwned)` can be created and checked out with no file created — argument-array proof test.
- Missing Git, invalid repo, network failure, auth failure, merge conflict and non-fast-forward push each produce a distinct actionable message.
- Each operation writes an `executions` row with command, args, exit code, status and duration.

**M3**
- Graph renders linear history, divergent branches, merge commits, tags and multiple parents correctly, verified against fixture repos built in tests.
- Local refs, remote refs and current HEAD are accurate.
- Selecting a commit shows metadata and changed files.
- Graph refreshes correctly after checkout, commit, fetch, pull, merge and rebase.
- A ≥10k-commit repository loads with visible progress and a responsive UI (paged or virtualized).

**M4**
- A shell opens with cwd at the project/repo path; `node-pty` resize works; closing the tab reaps the process.
- Output beyond the cap spills to a log file and the UI says so; no unbounded memory growth on a flooding command.
- Killing a session terminates the OS process (verified by PID check).
- No IPC channel accepts an arbitrary command string — asserted by a channel-inventory test.

**M5**
- Connecting to a reachable host with an agent key succeeds without Steward reading any key file.
- An unknown host key surfaces a decision in the UI; declining aborts; nothing is auto-trusted.
- A one-shot remote command records exit code, stdout and stderr in `executions` with `context = 'remote'` and the correct `ssh_host_id`.
- Auth failure, unreachable host and timeout produce distinct messages.
- A reachable host whose last command failed shows `connected` + `failing` — two statuses, not one.

**M6**
- A PAT entered in the UI is retrievable after restart, is absent from the DB file (grep proof) and absent from logs (redaction test).
- Import from `gh auth token` requires an explicit click and is labelled.
- Repo is auto-detected from the remote URL; ambiguity falls back to manual selection.
- PR list shows title, state, base, head, author; creating a PR from head→base returns a real PR URL that opens in the browser.
- Workflow runs list status and conclusion; a failing run is shown as failing while the GitHub connection still reads `connected`.
- 401, 403, 404 and rate-limit responses each render a specific, actionable state.

**M7**
- A configured `workflow_dispatch` target triggers a real run, and the `deployments` row links to the resulting `workflow_run`.
- Deployment status is only `succeeded` when the provider reports success or the SSH command exits 0; `status_source` records which.
- Deploying to a protected environment requires confirmation naming the environment and the target.
- Output and logs for the deployment are inspectable in the UI.
- A provider error leaves the deployment as `failed` or `unknown` — never `succeeded`.

---

## 9. Decisions requiring approval

Already settled by the user: Git tab spec framing · SQLite + `better-sqlite3` + migrations · GitHub PAT in OS vault with `gh` import · `node-pty` + system `ssh`.

Open, non-blocking for M1 unless noted:

1. **Credential backend: `keytar` vs Electron `safeStorage`** — `keytar` is archived upstream but still the closest thing to a direct OS-vault API; `safeStorage` is first-party and maintained but is an encryption primitive, so Steward owns the ciphertext file. Recommendation: `safeStorage` + encrypted file, no archived native dep. *(Needed by M6, not M1.)*
2. **`vault/` directory** — track as repo docs, or `.gitignore` it as personal notes? *(Affects M1's `.gitignore`.)*
3. **Scaffold base** — `electron-vite` (recommended; matches the PDF's Vite choice with the least config) vs `electron-forge` + Vite plugin. *(Affects M1 directly.)*
4. **Repo name / product name** — remote is `ianmora97/steward`; the PDF says "GitFlow Desktop". Confirm `steward` everywhere for `package.json`, app id and window title.
5. **Windows-first or cross-platform CI from M1** — cross-platform CI costs more setup now but catches the `better-sqlite3`/`node-pty` ABI issues early. Recommendation: build on Windows + Linux in CI from M1.

---

## 10. Recommended first implementation milestone

**M1 — Foundation & projects.**

Why first:

1. **Nothing exists.** There is no scaffold, no process boundary, no build. No other milestone can start.
2. **The IPC contract and DB schema are the two hardest things to change later.** Every subsequent feature calls through the preload bridge and stores rows. Getting `projectId`-scoped, Zod-validated, `GitOperationResult`-shaped channels right once avoids reworking every service in M2–M7. The PDF makes the same point: typed IPC contracts and validation *before* adding many Git operations.
3. **The project aggregate is the gap identified in §3.** Building the Git tab first — the PDF's own Task 1 — would produce a repo-centric app that then needs retrofitting into projects, exactly the mistake the PRD warns against ("do not assume one project corresponds to one repository").
4. **It pays the native-module cost on day one.** `better-sqlite3` + `electron-rebuild` + a packaged-build smoke test in CI during M1 means the packaging surprise happens while the app is 500 lines, not 15,000.
5. **It is independently verifiable.** Create a project, add a repo, see it validated, reorder tabs, restart, see it persist. That is a demonstrable product increment and it satisfies the PDF's Task 1 definition-of-done as a subset.

M1 deliberately excludes the commit graph, GitHub, terminal and SSH — matching the PDF's instruction for its first task.

---

## Verification plan for M1

```bash
npm install            # includes postinstall electron-rebuild
npm run typecheck
npm run test           # Vitest: schema validation, migrations, repo validation, preload surface
npm run dev            # manual: create project, add repo, reorder/hide/restore tabs, restart
npm run build          # packaged artifact
```

Manual checks: in devtools, confirm `window.require`, `process` and `module` are all undefined and `window.steward` exposes only the declared functions. Point the repo picker at `C:\Users\ianmo\dev\steward` (a valid work tree) and at `C:\Users\ianmo` (not one) and confirm both outcomes render in the UI. Inspect the SQLite file under `userData` and confirm `user_version = 1` and the seeded `git` tab row.

---

## Implementation note — Milestone 1 (2026-10-23)

**Deviation from §4, recorded here rather than silently absorbed.**

`better-sqlite3@13` publishes no prebuilt binaries: `npm install` always falls back to a `node-gyp` source build, which on Windows requires the MSVC C++ toolchain. That toolchain is not present on this machine, and the install fails outright:

```
gyp ERR! find VS - not found
gyp ERR! not ok
```

Milestone 1 therefore ships on **`node:sqlite`**, Node's built-in SQLite, behind the `SqlDatabase` interface in `src/main/db/driver.ts`. Verified before committing to it: it works in Electron 45 (Node 24.22, SQLite 3.53.4) and in Node 22.21 under Vitest, with named parameters, `PRAGMA user_version`, WAL and enforced foreign keys.

What this changes and what it does not:

- The requirement that the default install needs no separate database server is still met, and now the default install needs no compiler either.
- Everything above `driver.ts` uses only that interface, so moving to `better-sqlite3` later is a single-file change plus `electron-rebuild` in `postinstall`.
- Under Node 22 the module prints an `ExperimentalWarning`; Electron 45 bundles Node 24, so the application itself does not.

The §9 decisions were resolved as: `electron-vite` as the scaffold base, `steward` as the product name everywhere, and `vault/` left untracked and untouched (deliberately not added to `.gitignore`, so the choice stays open).

## Implementation note — Milestone 7 (2026-10-24)

Where M7 differs from the plan above:

- **No `workflow_runs` table.** The Actions view reads GitHub live and stores nothing, so `deployments` keeps `run_id`, `run_url` and `commit_sha` itself instead of a foreign key to a mirror.
- **`environments` replaces the free-text environment of SSH servers.** The migration creates one environment per distinct text of each project (`key` is the lowercased, trimmed text) and points every server at it; production-like names become protected. The old text column stays, unread.
- **`deployments` also stores `target_name`, `target_kind` and `repository_id`**, and its target reference is `ON DELETE SET NULL`, so deleting a target keeps its history. An SSH target's config includes `timeoutSeconds` (120 by default).
- **`status_source` is `NULL` until there is evidence**, and `succeeded` cannot be recorded without it.

The detailed design and the decisions taken while implementing it are in `docs/superpowers/specs/2026-10-24-m7-deployments-design.md` and `docs/superpowers/plans/2026-10-24-m7-deployments.md`.
