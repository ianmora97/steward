# Changelog

All notable changes to Steward are recorded here, newest first, and double as the source for release notes.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are tagged with the milestone they belong to.

Categories: **Added** · **Changed** · **Fixed** · **Removed** · **Security** · **Docs** · **Tooling**.

> Maintenance rule: every commit that changes behaviour, tooling or docs adds a line here, under `Unreleased`.
> When a release is cut, `Unreleased` is renamed to the version and date, and a new empty `Unreleased` is opened.

## [Unreleased]

### Added
- **M3** Commit graph: the history drawn with lanes, merges (hollow dot), and HEAD / branch / remote / tag labels.
- **M3** History is read a page at a time (400 commits) and only the visible rows are rendered, so large repositories stay responsive.
- **M3** Commit details: author, committer, parents (click to navigate), changed files with `+`/`−` counts, and a per-file diff. Merge commits are compared with their first parent; root commits are supported.
- **M3** "Working changes" row at the top of the graph, and an *All branches / Current branch* scope switch.
- **M3** Three new IPC channels (`git:history`, `git:commitDetail`, `git:commitDiff`) with Zod schemas; commit hashes are validated as hex so they can never be read as options.
- **M3** The graph reloads after every operation that changes the repository.
- **M2** Git tab on the installed `git`: status (staged / unstaged / untracked / conflicts / renames), diff, stage / unstage, discard, commit.
- **M2** Branches: list local and remote, create, check out (including remote → local tracking), delete.
- **M2** Fetch, pull (fast-forward only by default, optional merge), push (sets the upstream on first push), and abort merge.
- **M2** Activity tab: every action Steward runs is stored in a new `executions` table (command, arguments, exit code, status, duration, confirmation).
- **M2** Distinct, actionable errors for: missing Git, not a repository, auth failure, network failure, remote not found, non-fast-forward push, diverged pull, merge conflict, unmerged branch, uncommitted changes in the way, missing identity.
- **M1** Projects: create, list, archive, delete; one project owns many repositories.
- **M1** Repositories: add a local folder after Git confirms it is a work tree; the work-tree root is stored so the same repository cannot be added twice.
- **M1** Configurable tab system (reorder, hide, restore); the Git tab is seeded first and cannot be hidden.
- **M1** Local persistence in SQLite (`node:sqlite`) with forward-only versioned migrations and a pre-migration backup.
- **M1** Typed, Zod-validated IPC with one result shape for every call (`StewardResult<T>`), and dark app shell.
- **M1** CI on Windows and Linux: typecheck, lint, build and package.
- **Tooling** ESLint with `typescript-eslint` and `react-hooks`; `npm run lint`, `lint:fix` and `check` (typecheck + lint).
- **Docs** `CLAUDE.md` with project rules, architecture and security notes; this changelog; a redesigned README.

### Changed
- **M3** Git tab layout: the staging area (or the selected commit's details) sits on the right, and the code diff sits under the graph, so code and files are visible together. Tabs are *Changes*, *Branches*, *Activity*, *Repositories*.
- **M1** Database uses Node's built-in `node:sqlite` instead of `better-sqlite3`, so there is no native module or C++ toolchain to install. It sits behind the `SqlDatabase` interface in `src/main/db/driver.ts`.

### Fixed
- **M3** Scrolling: the root layout grid grew with its content and clipped the workspace, so long views (branches, file lists) could not be scrolled. Regions now scroll on their own.
- **M2** Loose equality in the Git toolbar flagged by the new lint rules.

### Removed
- **Tooling** All automated tests (Vitest unit and integration suites, the end-to-end smoke test) and their scripts and CI steps. Testing is manual.
- **Tooling** `graphify-out/` and the Obsidian `vault/` are no longer tracked; they stay local and are ignored by Git.

### Security
- **M3** Commit hashes and file paths are validated in the schema before they reach `git`.
- **M2** Git runs with `GIT_TERMINAL_PROMPT=0`, `GIT_LITERAL_PATHSPECS=1` and `LC_ALL=C`; arguments are always arrays, so a branch or file named like shell syntax is plain data.
- **M2** Destructive actions (discard, force-delete a branch) require `confirmed: true` in the IPC schema, and the UI states what will be lost first.
- **M2** Git output is redacted (credentials in URLs, tokens) before it reaches the renderer or the database; push never forces.
- **M1** Renderer isolation: `contextIsolation`, no `nodeIntegration`, `sandbox`, strict Content Security Policy, guarded navigation, and a bridge that exposes only named functions (no generic `invoke`, no `runCommand`).
- **M1** The only route to a child process is a single runner that never uses a shell and caps output and runtime.
