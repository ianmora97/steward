# Steward

Steward brings CI/CD, deployments, infrastructure, and observability together in one workspace, simplifying the journey from code to production.

A project-centric desktop workspace: one project owns many repositories, environments and integrations, each with its own tabs. Git is the first tab of every project; terminal, SSH, GitHub Actions and deployments arrive in later milestones.

**Status: Milestone 2 — everyday Git.** Projects, repositories and the tab system persist, and the Git tab does status, diffs, stage/unstage, commit, branches (create, check out, delete) and fetch/pull/push against the installed `git`. Destructive actions (discard, force-delete a branch, abort a merge) ask for confirmation, and every action is recorded in the Activity list. Everything else is scaffolding with a clearly labelled panel, not a simulated feature.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | ≥ 22.12 | Build toolchain, and `node:sqlite` for the local database |
| npm | ≥ 9 | Dependency install |
| Git | ≥ 2.39 | Steward orchestrates the installed Git; it never reimplements it |

No database server, and no C++ toolchain: Steward has no native modules to compile.

## Setup

```bash
npm install
npm run dev
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Electron + Vite with hot reload |
| `npm run build` | Builds main, preload and renderer into `out/` |
| `npm start` | Runs the built app without packaging |
| `npm run typecheck` | Type-checks the Node and renderer projects separately |
| `npm test` | Vitest unit and integration suites |
| `npm run test:e2e` | Launches the built app and drives the real renderer over CDP |
| `npm run package` | Builds, then produces an unpacked app in `release/` |
| `npm run verify` | typecheck → test → build → e2e, in order |

`npm run test:e2e` requires `npm run build` first; `npm run verify` does both in the right order.

## Architecture

```
src/
├─ main/         Electron main process — the only place with system access
│  ├─ db/        node:sqlite driver, migrations, data access
│  ├─ exec/      the single safe route to a child process
│  ├─ security/  path validation
│  ├─ services/  project, repository, git, tab
│  └─ ipc/       channel definitions (Electron-free) + registration
├─ preload/      the contextBridge surface, and nothing else
├─ renderer/     React UI; no Node access, no shell, no filesystem
└─ shared/       types and Zod schemas used on both sides
tests/
├─ unit/         schemas, migrations, services, IPC boundary, window options
├─ integration/  real temporary Git repositories driven by the real git
└─ e2e/          the built app, driven over the Chrome DevTools Protocol
```

The renderer calls named functions on `window.steward`; the preload forwards them to a declared channel; the main process validates the payload with Zod and runs a service. Adding a capability means adding all three. There is no generic `invoke(channel, payload)` and no `runCommand(string)`, because either one would hand the renderer arbitrary execution through the boundary that exists to prevent it.

Every operation returns one shape:

```ts
type StewardResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: StewardErrorCode; message: string; details?: string } };
```

### Security posture

- Windows are created with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`. The e2e suite asserts from inside the running renderer that `require`, `process`, `module` and `Buffer` are all absent.
- A Content Security Policy is applied as a response header; navigation to other origins is cancelled; external links open in the OS browser only when the URL is plain `https:`.
- Child processes are started with an executable plus an argument array — never `shell: true`, never a concatenated command string. Branch names, paths and remote output are treated as untrusted data; a branch named `$(touch_pwned)` is covered by a test.
- Output is capped per execution and every run has a timeout and can be killed.
- Unexpected errors are logged in the main process and reported generically, so raw error text cannot carry paths or secrets into the UI.

### Local persistence

SQLite through Node's built-in `node:sqlite`, in a single file under the OS application-data directory. `src/main/db/driver.ts` is a small interface, so the driver is replaceable in one file.

`better-sqlite3` was the first choice and remains the fallback, but it publishes no prebuilt binaries: installing it compiles from source and therefore requires MSVC on Windows. `node:sqlite` ships inside Node, so it needs no compilation and no per-Electron-release ABI rebuild. Running under Node 22 it prints an `ExperimentalWarning`; Electron 45 bundles Node 24, where the app itself runs without that warning.

Migrations are forward-only (`src/main/db/migrations/`), applied at startup inside a transaction, tracked by `PRAGMA user_version` and audited in `schema_migrations`. A database that already holds data is copied to `<file>.v<n>.backup` before an upgrade.

Steward stores its own configuration and execution records only. Git and provider data are re-read from Git and the provider APIs rather than cached as a system of record.

Override the database location while developing:

```bash
STEWARD_DB_PATH=/tmp/steward-dev.sqlite npm run dev
```

## Verifying Milestone 1 by hand

1. `npm run dev`
2. Create a project. It appears in the sidebar with a derived slug, and the Git tab is first.
3. In the Git tab, point **Browse…** or the path field at a repository and press **Check**. Steward reports the work tree, branch, remote and provider, then **Add to project**.
4. Point it at a folder that is not a repository. The reason is shown in the UI, and nothing is recorded.
5. In **Workspace**, reorder and hide tabs. The Git tab refuses to be hidden and says why.
6. Restart the app. Projects, repositories and tab order are all still there.
7. In devtools, confirm `window.require`, `window.process` and `window.module` are `undefined` and `Object.keys(window.steward)` lists only `app`, `projects`, `repositories` and `tabs`.

Steps 2–7 are also covered by `npm run test:e2e`.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
