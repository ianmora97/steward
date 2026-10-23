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

export const MIGRATIONS: readonly Migration[] = [m001];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
