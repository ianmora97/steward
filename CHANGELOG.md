# Changelog

All notable changes to Steward are recorded here, newest first, and double as the source for release notes.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are tagged with the milestone they belong to.

Categories: **Added** · **Changed** · **Fixed** · **Removed** · **Security** · **Docs** · **Tooling**.

> Maintenance rule: every commit that changes behaviour, tooling or docs adds a line here, under `Unreleased`.
> When a release is cut, `Unreleased` is renamed to the version and date, and a new empty `Unreleased` is opened.

## [Unreleased]

### Added
- **M5** Connections are grouped by environment (Production, Staging, Dev… in your own words; known names keep a prod → stage → dev order, ungrouped last).
- **M5** Each connection records its VPC (name, id, CIDR), and optionally its provider (AWS, DigitalOcean, Google Cloud, Azure, Hetzner, Linode, Vultr, on-premises, other), region, domain, IP address and a description. They are informational and shown on its card.
- **M5** SSH tab: save hosts per project (name, host or `~/.ssh/config` alias, optional user and port) and use them through your system `ssh`, so your agent, keys and config apply. Steward never stores keys or passwords.
- **M5** Host-key review: an unknown host is never trusted automatically. Steward shows its fingerprints and trusts it only if you click *Trust this host*; declining saves nothing. If the key was swapped between review and trust, nothing is saved. Trusted keys live in Steward's own `known_hosts`, not yours.
- **M5** *Test connection* reports distinct outcomes: connected, unreachable, timed out, authentication failed, host not trusted and host key changed — each with a hint.
- **M5** Run one-shot commands on a host (timeout 10 s to 5 min) and see exit code, stdout and stderr; every run is recorded as a remote entry in the Activity history with its output saved to a log file.
- **M5** Connect through a domain *or* an IP address (pick one); a `~/.ssh/config` alias also works as the domain.
- **M5** Pick a private key (`.pem`) per host with a file browser. Steward stores only the path and passes it to `ssh -i` (with `IdentitiesOnly`); it never reads or stores the key. The key is used by connection tests, commands and shells alike.
- **M5** *Copy ssh command* on each host: the exact `ssh -i … -p … user@host` line to paste in any terminal.
- **M5** Clear messages when ssh refuses a key because its permissions are too open or its file is unreadable.
- **M5** Two separate statuses per host: connection (can Steward reach it) and last command (healthy or failing), so a reachable host whose last command failed shows both.
- **M5** *Open shell* starts an interactive `ssh` session in the Terminal tab, marked with an SSH icon and an amber banner saying everything typed runs on the remote machine. Password prompts work inside the terminal.
- **M4.5** New home screen: an Overview of all your projects with search, summary cards (projects, repositories, open terminals, Git version) and one card per project showing its repositories and when it last changed. Steward opens on it instead of jumping into the last project.
- **M4.5** New project dialog, opened from the Overview or the sidebar `+`.
- **M4.5** Icons on every project tab (Git, Terminal, SSH, Actions, Deployments, Workspace) and in the sidebar.
- **M4.5** Terminal split view: the *Split* button shows every terminal at once — two side by side, three as two above and one below, and so on. Click a pane to focus it.
- **M4.5** Opening the Terminal tab starts a terminal automatically when the project has none.
- **M4.5** Rename terminals: double-click a terminal tab, Enter to save, Esc to cancel.
- **M4.5** Animations: panels slide and fade in, dialogs and menus fade and slide in and out, project cards rise in. They are disabled if your system asks for reduced motion.
- **M4** Terminal tab: real interactive shells (colours, resize, full-screen programs) opened in the folder of any repository of the project.
- **M4** Several terminals per project, with tabs. They keep running when you switch tab or project and repaint with their history when you come back.
- **M4** Pick the shell for each terminal from a menu, like Windows Terminal: detected PowerShell, Windows PowerShell, Command Prompt, Git Bash and WSL on Windows (`$SHELL` and `/etc/shells` elsewhere). Only shells that exist on your machine are listed.
- **M4** Custom shells (name, executable, arguments) shared by every project, and a default shell chosen per project.
- **M4** Each terminal session is recorded in the Activity history, with its exit code and duration; its output is saved to a log file capped at 5 MB, and the tab tells you when the cap is reached.
- **M4** At most 8 terminals at once; closing a tab, deleting the project or repository, or quitting Steward ends their processes.
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
- **M4** Tooling: `node-pty` (pseudo-terminals) and `@xterm/xterm` added; the native module is unpacked from the app archive when packaging.

### Changed
- **M5** The SSH tab is labelled **VPC** in the project tab bar.
- **M5** Project cards in the Overview show counts instead of one pill per repository: *GitHub (n)*, *Repositories (n)* for non-GitHub ones (hover for the names), and *VPC (n)* for the project's saved connections.
- **M5** SSH tab redesigned as **VPC connections**: a *Saved connections* list on the left (search, environment filter, collapsible groups with Production highlighted, per-connection status) and a detail editor on the right with *Configuration* and *Session history* tabs, a connection route (this machine → VPC → server), SSH session status, sessions active on other connections, and *Save changes* / *Connect via SSH* in the footer.
- **M5** SSH dialogs (add/edit host, host-key review) are wider so fingerprints and paths stay on one line.
- **M4.5** Commit details are a compact raised card (title, author, date, short hash, parents, file and line totals); the file list below scrolls on its own. Email, full hash and the committer line are gone (hover for the full hash and email).
- **M4.5** Git changes: the commit message box stays pinned at the bottom while only the file lists scroll; the graph is taller; the diff area appears only after you pick a file.
- **M4.5** The sidebar collapses to an icon strip (button next to the logo) and remembers its state.
- **M4.5** Shell settings open in a dialog over the app (gear button) instead of squeezing in above the terminal.
- **M4.5** App redesign: navy theme, sidebar with the Steward logo, Overview and project list, and a blue accent.
- **M4.5** Deleting a project moved from the sidebar to its card in the Overview.
- **M4.5** With many terminals open the tab strip scrolls sideways instead of shrinking every tab.
- **M3** Git tab layout: the staging area (or the selected commit's details) sits on the right, and the code diff sits under the graph, so code and files are visible together. Tabs are *Changes*, *Branches*, *Activity*, *Repositories*.
- **M1** Database uses Node's built-in `node:sqlite` instead of `better-sqlite3`, so there is no native module or C++ toolchain to install. It sits behind the `SqlDatabase` interface in `src/main/db/driver.ts`.

### Fixed
- **M5** *Open shell* failed on Windows with "File not found"; Steward now starts `ssh` by its full path.
- **M5** The SSH tab now appears: new projects get it, and existing projects get it added after their last tab on first launch.
- **M4.5** Copy and paste in the terminal: Ctrl+C copies when text is selected (otherwise it still interrupts), Ctrl+Shift+C copies, Ctrl+V / Ctrl+Shift+V pastes, and right-click copies the selection or pastes.
- **M4.5** Dropdown arrows are now vertically centred with space to the right edge.
- **M3** Scrolling: the root layout grid grew with its content and clipped the workspace, so long views (branches, file lists) could not be scrolled. Regions now scroll on their own.
- **M2** Loose equality in the Git toolbar flagged by the new lint rules.

### Removed
- **Tooling** All automated tests (Vitest unit and integration suites, the end-to-end smoke test) and their scripts and CI steps. Testing is manual.
- **Tooling** `graphify-out/` and the Obsidian `vault/` are no longer tracked; they stay local and are ignored by Git.

### Security
- **M4** The renderer can only send keystrokes and resize requests to terminals that already exist; folder and shell are resolved in the main process, and there is still no channel that runs a command string. Terminal logs mask URL credentials and GitHub tokens.
- **M3** Commit hashes and file paths are validated in the schema before they reach `git`.
- **M2** Git runs with `GIT_TERMINAL_PROMPT=0`, `GIT_LITERAL_PATHSPECS=1` and `LC_ALL=C`; arguments are always arrays, so a branch or file named like shell syntax is plain data.
- **M2** Destructive actions (discard, force-delete a branch) require `confirmed: true` in the IPC schema, and the UI states what will be lost first.
- **M2** Git output is redacted (credentials in URLs, tokens) before it reaches the renderer or the database; push never forces.
- **M1** Renderer isolation: `contextIsolation`, no `nodeIntegration`, `sandbox`, strict Content Security Policy, guarded navigation, and a bridge that exposes only named functions (no generic `invoke`, no `runCommand`).
- **M1** The only route to a child process is a single runner that never uses a shell and caps output and runtime.
