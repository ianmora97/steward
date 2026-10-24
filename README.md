<div align="center">

# Steward

**One workspace for code, pipelines and deployments — per project.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/status-milestone%203%20of%207-orange?style=flat-square)](CHANGELOG.md)
[![Electron](https://img.shields.io/badge/Electron-45-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A5%2022.12-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-local%20only-003B57?style=flat-square&logo=sqlite&logoColor=white)](#local-persistence)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-555?style=flat-square)](#prerequisites)

</div>

Steward is a desktop app organised around **projects**, not repositories. A project can own several repositories (a web app, an API, infrastructure), environments and integrations, and each project gets its own set of tabs. Git comes first; terminal, SSH, GitHub Actions and deployments follow. It plugs into the CI/CD you already have instead of replacing it, keeps everything on your machine, and never reimplements Git: it asks the `git` you have installed.

## What works today

| | Feature |
| --- | --- |
| ✅ | **Projects** with many repositories each, persisted locally |
| ✅ | **Configurable tabs** per project (reorder, hide, restore) |
| ✅ | **Git — everyday**: status, diffs, stage / unstage, commit, branches, fetch / pull / push, abort merge |
| ✅ | **Commit graph** with lanes, merges, branch / tag labels, paged history and per-commit file diffs |
| ✅ | **Activity log**: every Git action Steward runs, with arguments, exit code and duration |
| ✅ | **Terminal**: real shells per project (several tabs, split view, rename, copy / paste, kept alive while you navigate), shell configurable per project, capped session logs |
| ✅ | **Overview** home screen with every project, search and a collapsible sidebar |
| ✅ | **SSH**: saved hosts through your system `ssh`, host-key review (nothing trusted automatically), one-shot remote commands with exit code / stdout / stderr, remote shells in the terminal, connection and last-command status shown separately |
| ✅ | **GitHub — pull requests**: connect a project with a personal access token (encrypted with your OS keyring, per project; or import it once from `gh`), list a repository's pull requests by state and create new ones after a confirmation step |
| ✅ | **GitHub — Actions**: a repository's workflows and runs with status and conclusion, jobs and steps per run, and the end of any job's log as plain text; workflow health is shown separately from the connection |
| 🔜 | Deployments (M7) |

Destructive actions (discard, force-delete a branch, abort a merge) always ask first and say exactly what is lost. Push never forces.

See the [CHANGELOG](CHANGELOG.md) for what changed in each step.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | ≥ 22.12 | Build toolchain, and `node:sqlite` for the local database |
| npm | ≥ 9 | Dependency install |
| Git | ≥ 2.39 | Steward orchestrates the installed Git |

No database server. The terminal uses `node-pty`, which ships prebuilt binaries for Windows and macOS; on Linux, `npm install` compiles it, so `python3`, `make` and a C++ compiler must be installed.

## Run it locally

```bash
git clone https://github.com/ianmora97/steward.git
cd steward
npm install
npm run dev
```

Then create a project, open the **Git** tab and add a repository folder. Steward checks it with Git before recording anything.

> Only one Steward instance can run at a time. Close any running copy before `npm run dev`.

Keep the database somewhere else while developing:

```bash
STEWARD_DB_PATH=/tmp/steward-dev.sqlite npm run dev
```

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Electron + Vite with hot reload |
| `npm run build` | Builds main, preload and renderer into `out/` |
| `npm start` | Runs the built app without packaging |
| `npm run typecheck` | Type-checks the Node and renderer projects separately |
| `npm run lint` | ESLint (`lint:fix` applies safe fixes) |
| `npm run check` | typecheck + lint — run before every commit |
| `npm run package` | Builds, then produces an unpacked app in `release/` |

There are no automated tests by design; testing is manual.

## How it is built

```
src/
├─ main/         Electron main process — the only place with system access
│  ├─ db/        node:sqlite driver, migrations, data access
│  ├─ exec/      the single safe route to a child process
│  ├─ security/  path validation
│  ├─ services/  project, repository, tab, git (exec, parse, errors, ops, history)
│  └─ ipc/       channel definitions (Electron-free) + registration
├─ preload/      the contextBridge surface, and nothing else
├─ renderer/     React UI; no Node access, no shell, no filesystem
└─ shared/       types, Zod schemas and the graph lane layout, used on both sides
```

The renderer calls named functions on `window.steward`; the preload forwards them to a declared channel; the main process validates the payload with Zod and runs a service. Adding a capability means adding all three. There is no generic `invoke(channel, payload)` and no `runCommand(string)`: either would hand the renderer arbitrary execution through the boundary that exists to prevent it.

Every operation returns one shape:

```ts
type StewardResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: StewardErrorCode; message: string; details?: string } };
```

### Security posture

- Windows use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`, plus a strict Content Security Policy and guarded navigation. External links open in the OS browser only for plain `https:` URLs.
- Child processes get an executable plus an argument array — never `shell: true`, never a concatenated string. Branch names, paths and remote output are untrusted data: a branch called `$(touch_pwned)` is just a name.
- Git runs non-interactively with literal pathspecs; output is capped, every run has a timeout, and credentials or tokens are redacted before output leaves the main process.
- Unexpected errors are logged in the main process and reported generically, so raw error text cannot carry paths or secrets into the UI.

### Local persistence

SQLite through Node's built-in `node:sqlite`, in one file under the OS application-data directory, behind a small interface in `src/main/db/driver.ts` so the driver can be swapped in one place. Migrations are forward-only, applied at startup in a transaction, and a database that already holds data is copied to `<file>.v<n>.backup` before an upgrade.

Steward stores only its own configuration and execution history. Git and provider data are re-read from Git and the provider APIs, never cached as a system of record.

## Contributing

Branches are named after the milestone they carry (for example `milestone-3-commit-graph`). Run `npm run check` before committing, add a line to [CHANGELOG.md](CHANGELOG.md) with every commit, and keep commits in [Conventional Commits](https://www.conventionalcommits.org/) style.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
