/**
 * Forward-only migrations, applied in order inside a transaction.
 *
 * Each milestone appends a new entry; existing entries are never edited once
 * they have shipped. `PRAGMA user_version` is the applied-version marker and
 * `schema_migrations` is the human-readable audit trail.
 *
 * Milestone 1 creates only what Milestone 1 uses. Integrations, environments,
 * ssh_hosts, deploy_targets, executions, workflow_runs and deployments arrive
 * with the milestones that implement them.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const m001: Migration = {
  version: 1,
  name: 'initial_projects_repositories_tabs',
  sql: `
    CREATE TABLE schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
    );

    CREATE TABLE app_settings (
      key        TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      description TEXT,
      icon        TEXT,
      color       TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE INDEX idx_projects_archived ON projects (archived_at);

    -- A project owns many repositories: one project is not one repository and
    -- not one deployable service.
    CREATE TABLE repositories (
      id             TEXT NOT NULL PRIMARY KEY,
      project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      local_path     TEXT NOT NULL,
      provider       TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (provider IN ('github', 'other', 'unknown')),
      remote_name    TEXT,
      remote_url     TEXT,
      default_branch TEXT,
      role           TEXT NOT NULL DEFAULT 'primary'
                       CHECK (role IN ('primary', 'service', 'infra', 'docs')),
      service_name   TEXT,
      created_at     TEXT NOT NULL,
      last_opened_at TEXT,
      UNIQUE (project_id, local_path)
    );

    CREATE INDEX idx_repositories_project ON repositories (project_id);

    -- Tabs are rows, not code. 'git' is seeded at position 0 for every project.
    CREATE TABLE workspace_tabs (
      id             TEXT NOT NULL PRIMARY KEY,
      project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      tab_key        TEXT NOT NULL,
      position       INTEGER NOT NULL,
      visible        INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
      pinned         INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      source         TEXT NOT NULL DEFAULT 'builtin'
                       CHECK (source IN ('builtin', 'integration')),
      integration_id TEXT,
      updated_at     TEXT NOT NULL,
      UNIQUE (project_id, tab_key)
    );

    CREATE INDEX idx_workspace_tabs_project ON workspace_tabs (project_id, position);
  `
};

/**
 * One uniform history for everything Steward runs. Milestone 2 writes `git_op`
 * rows; later milestones add kinds without a schema change, which is why `kind`
 * carries no CHECK constraint. `context` stays explicit so a local command can
 * never be mistaken for a remote one.
 */
const m002: Migration = {
  version: 2,
  name: 'executions',
  sql: `
    CREATE TABLE executions (
      id                 TEXT NOT NULL PRIMARY KEY,
      project_id         TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      repository_id      TEXT REFERENCES repositories (id) ON DELETE SET NULL,
      kind               TEXT NOT NULL,
      context            TEXT NOT NULL DEFAULT 'local' CHECK (context IN ('local', 'remote')),
      command            TEXT NOT NULL,
      args_json          TEXT NOT NULL,
      cwd                TEXT,
      status             TEXT NOT NULL
                           CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
      exit_code          INTEGER,
      confirmed_by_user  INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_by_user IN (0, 1)),
      started_at         TEXT NOT NULL,
      finished_at        TEXT,
      duration_ms        INTEGER,
      error_code         TEXT,
      error_message      TEXT
    );

    CREATE INDEX idx_executions_project ON executions (project_id, started_at);
    CREATE INDEX idx_executions_repository ON executions (repository_id, started_at);
  `
};

/**
 * Terminal sessions: one `executions` row per session, with the long output
 * spilled to a capped log file, plus a per-project shell choice. Environment
 * variables are deliberately not stored: they would invite secrets into the
 * database.
 */
const m003: Migration = {
  version: 3,
  name: 'terminal',
  sql: `
    ALTER TABLE executions ADD COLUMN log_path TEXT;

    CREATE TABLE project_terminal_settings (
      project_id      TEXT NOT NULL PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
      shell_path      TEXT,
      shell_args_json TEXT NOT NULL DEFAULT '[]',
      updated_at      TEXT NOT NULL
    );
  `
};

/**
 * Shell profiles are global (like Windows Terminal's), and each project only
 * remembers which one it opens by default. A shell path saved per project by
 * the first terminal release becomes a custom profile so nothing is lost; the
 * old columns stay unused rather than being dropped.
 */
const m004: Migration = {
  version: 4,
  name: 'terminal-profiles',
  sql: `
    CREATE TABLE terminal_profiles (
      id              TEXT NOT NULL PRIMARY KEY,
      name            TEXT NOT NULL,
      shell_path      TEXT NOT NULL,
      shell_args_json TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL
    );

    ALTER TABLE project_terminal_settings ADD COLUMN default_profile_id TEXT;

    INSERT INTO terminal_profiles (id, name, shell_path, shell_args_json, created_at)
      SELECT 'legacy-' || project_id, 'Custom shell', shell_path, shell_args_json, updated_at
        FROM project_terminal_settings
       WHERE shell_path IS NOT NULL;

    UPDATE project_terminal_settings
       SET default_profile_id = 'legacy-' || project_id
     WHERE shell_path IS NOT NULL;
  `
};

/**
 * SSH hosts belong to a project. No key material, password or passphrase is
 * stored: authentication is whatever the system `ssh` resolves (agent, default
 * keys, ~/.ssh/config), so `host` may be a config alias. Connection state is
 * live and is not persisted; every remote run is an `executions` row with
 * `context = 'remote'` pointing here through `ssh_host_id`.
 */
const m005: Migration = {
  version: 5,
  name: 'ssh-hosts',
  sql: `
    CREATE TABLE ssh_hosts (
      id         TEXT NOT NULL PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      host       TEXT NOT NULL,
      port       INTEGER,
      username   TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, name)
    );

    CREATE INDEX idx_ssh_hosts_project ON ssh_hosts (project_id);

    ALTER TABLE executions ADD COLUMN ssh_host_id TEXT REFERENCES ssh_hosts (id) ON DELETE SET NULL;

    CREATE INDEX idx_executions_ssh_host ON executions (ssh_host_id, started_at);
  `
};

/**
 * The SSH tab shipped with M5 but was never seeded, so projects created before
 * it have no way to reach it. Adds it after their last tab, visible; projects
 * that already have one are left alone.
 */
const m006: Migration = {
  version: 6,
  name: 'ssh-tab-for-existing-projects',
  sql: `
    INSERT INTO workspace_tabs (id, project_id, tab_key, position, visible, pinned, source, integration_id, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) ||
                   '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
             p.id, 'ssh',
             COALESCE((SELECT MAX(position) FROM workspace_tabs WHERE project_id = p.id), -1) + 1,
             1, 0, 'builtin', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM projects p
       WHERE NOT EXISTS (SELECT 1 FROM workspace_tabs t WHERE t.project_id = p.id AND t.tab_key = 'ssh');
  `
};

/**
 * Optional private-key file per SSH host, passed to `ssh -i`. Only the path is
 * stored; Steward never reads the key, so no secret enters the database.
 */
const m007: Migration = {
  version: 7,
  name: 'ssh-identity-file',
  sql: `ALTER TABLE ssh_hosts ADD COLUMN identity_file TEXT;`
};

/**
 * Servers are described, not just reachable: which environment they belong to
 * (free text, so "Prod" and "Stage" are the user's words), where they run, and
 * the public names that identify them. All optional and informational; none of
 * it changes how `ssh` connects.
 */
const m008: Migration = {
  version: 8,
  name: 'ssh-host-metadata',
  sql: `
    ALTER TABLE ssh_hosts ADD COLUMN environment TEXT;
    ALTER TABLE ssh_hosts ADD COLUMN provider    TEXT;
    ALTER TABLE ssh_hosts ADD COLUMN region      TEXT;
    ALTER TABLE ssh_hosts ADD COLUMN domain      TEXT;
    ALTER TABLE ssh_hosts ADD COLUMN ip_address  TEXT;
    ALTER TABLE ssh_hosts ADD COLUMN description TEXT;
  `
};

/**
 * A connection belongs to a VPC (or network): its name, id and address range
 * describe where the server sits and are shown in the connection route.
 * Informational only; none of it is passed to `ssh`.
 */
const m009: Migration = {
  version: 9,
  name: 'ssh-host-vpc',
  sql: `
    ALTER TABLE ssh_hosts ADD COLUMN vpc_name TEXT;
    ALTER TABLE ssh_hosts ADD COLUMN vpc_id   TEXT;
    ALTER TABLE ssh_hosts ADD COLUMN vpc_cidr TEXT;
  `
};

export const MIGRATIONS: readonly Migration[] = [m001, m002, m003, m004, m005, m006, m007, m008, m009];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
