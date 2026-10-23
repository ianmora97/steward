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

export const MIGRATIONS: readonly Migration[] = [m001, m002];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
