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

/**
 * Provider connections, one per project and kind. There is deliberately no
 * secret column: a token lives in an encrypted file under userData, and this
 * row only says whether it worked last time and who it belongs to.
 */
const m010: Migration = {
  version: 10,
  name: 'integrations',
  sql: `
    CREATE TABLE integrations (
      id                    TEXT NOT NULL PRIMARY KEY,
      project_id            TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      kind                  TEXT NOT NULL CHECK (kind IN ('github')),
      connection_status     TEXT NOT NULL
                              CHECK (connection_status IN ('unconfigured', 'connected', 'auth_error', 'unreachable')),
      connection_checked_at TEXT,
      last_error            TEXT,
      config_json           TEXT NOT NULL,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      UNIQUE (project_id, kind)
    );
  `
};

/**
 * The GitHub tab is where a project connects to GitHub, so it must exist before
 * any connection does. Same shape as m006: added after each project's last tab,
 * visible, and left alone where one already exists.
 */
const m011: Migration = {
  version: 11,
  name: 'github-tab-for-existing-projects',
  sql: `
    INSERT INTO workspace_tabs (id, project_id, tab_key, position, visible, pinned, source, integration_id, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) ||
                   '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
             p.id, 'github',
             COALESCE((SELECT MAX(position) FROM workspace_tabs WHERE project_id = p.id), -1) + 1,
             1, 0, 'builtin', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM projects p
       WHERE NOT EXISTS (SELECT 1 FROM workspace_tabs t WHERE t.project_id = p.id AND t.tab_key = 'github');
  `
};

/**
 * Environments become rows. Until now an SSH host carried its environment as free
 * text ("Prod", "prod "); one environment is created per distinct text of each
 * project and every host is pointed at it. The old text column is left in place
 * and no longer read: migrations only go forward and never drop user data.
 *
 * `key` is the lowercased, trimmed text rather than a slug, so two different
 * spellings can never collide and abort the migration. Production-like names are
 * protected, which is what later gates a deploy behind a typed confirmation.
 */
const m012: Migration = {
  version: 12,
  name: 'environments',
  sql: `
    CREATE TABLE environments (
      id           TEXT NOT NULL PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      key          TEXT NOT NULL,
      name         TEXT NOT NULL,
      kind         TEXT NOT NULL CHECK (kind IN ('development', 'staging', 'production', 'custom')),
      rank         INTEGER NOT NULL,
      is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      UNIQUE (project_id, key)
    );

    CREATE INDEX idx_environments_project ON environments (project_id, rank);

    INSERT INTO environments (id, project_id, key, name, kind, rank, is_protected, created_at, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) ||
                   '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
             g.project_id, g.key, g.name, g.kind,
             CASE
               WHEN g.kind = 'production' THEN 0
               WHEN g.kind = 'staging' THEN 1
               WHEN g.key IN ('qa', 'test', 'testing', 'uat') THEN 2
               WHEN g.kind = 'development' THEN 3
               ELSE 4
             END,
             CASE WHEN g.kind = 'production' THEN 1 ELSE 0 END,
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM (
          SELECT h.project_id, h.key, h.name,
                 CASE
                   WHEN h.key LIKE 'prod%' OR h.key = 'live' THEN 'production'
                   WHEN h.key LIKE 'stage%' OR h.key IN ('preprod', 'pre-prod') THEN 'staging'
                   WHEN h.key LIKE 'dev%' THEN 'development'
                   ELSE 'custom'
                 END AS kind
            FROM (
              SELECT project_id, lower(trim(environment)) AS key, MIN(trim(environment)) AS name
                FROM ssh_hosts
               WHERE environment IS NOT NULL AND trim(environment) <> ''
               GROUP BY project_id, lower(trim(environment))
            ) h
        ) g;

    ALTER TABLE ssh_hosts ADD COLUMN environment_id TEXT REFERENCES environments (id) ON DELETE SET NULL;

    UPDATE ssh_hosts
       SET environment_id = (
             SELECT e.id FROM environments e
              WHERE e.project_id = ssh_hosts.project_id AND e.key = lower(trim(ssh_hosts.environment))
           )
     WHERE environment IS NOT NULL AND trim(environment) <> '';
  `
};

/**
 * Deploy targets and their history. A target pointing at a host or repository
 * that is later deleted keeps existing (marked broken in the UI) and a deleted
 * target keeps its deployments, which carry a copy of its name. Environments are
 * referenced without ON DELETE on purpose: the service refuses to delete one in
 * use, and the project cascade must not trip over the reference.
 *
 * `status_source` stays NULL until there is evidence; a deployment only becomes
 * `succeeded` with a provider conclusion or an exit code behind it.
 */
const m013: Migration = {
  version: 13,
  name: 'deploy-targets-and-deployments',
  sql: `
    CREATE TABLE deploy_targets (
      id                    TEXT NOT NULL PRIMARY KEY,
      project_id            TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      environment_id        TEXT NOT NULL REFERENCES environments (id),
      name                  TEXT NOT NULL,
      kind                  TEXT NOT NULL CHECK (kind IN ('ssh_command', 'github_workflow_dispatch')),
      ssh_host_id           TEXT REFERENCES ssh_hosts (id) ON DELETE SET NULL,
      repository_id         TEXT REFERENCES repositories (id) ON DELETE SET NULL,
      config_json           TEXT NOT NULL,
      requires_confirmation INTEGER NOT NULL DEFAULT 1 CHECK (requires_confirmation IN (0, 1)),
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      UNIQUE (project_id, name)
    );

    CREATE INDEX idx_deploy_targets_project ON deploy_targets (project_id);

    CREATE TABLE deployments (
      id               TEXT NOT NULL PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      environment_id   TEXT NOT NULL REFERENCES environments (id),
      deploy_target_id TEXT REFERENCES deploy_targets (id) ON DELETE SET NULL,
      target_name      TEXT NOT NULL,
      target_kind      TEXT NOT NULL CHECK (target_kind IN ('ssh_command', 'github_workflow_dispatch')),
      repository_id    TEXT REFERENCES repositories (id) ON DELETE SET NULL,
      execution_id     TEXT REFERENCES executions (id) ON DELETE SET NULL,
      ref              TEXT,
      commit_sha       TEXT,
      status           TEXT NOT NULL
                         CHECK (status IN ('requested', 'in_progress', 'succeeded', 'failed', 'cancelled', 'unknown')),
      status_source    TEXT CHECK (status_source IN ('provider', 'exit_code')),
      run_id           INTEGER,
      run_url          TEXT,
      requested_at     TEXT NOT NULL,
      finished_at      TEXT,
      notes            TEXT
    );

    CREATE INDEX idx_deployments_project ON deployments (project_id, requested_at);
    CREATE INDEX idx_deployments_target ON deployments (deploy_target_id, requested_at);
    -- A run belongs to at most one deployment, whatever the code does: the database refuses a second claim.
    CREATE UNIQUE INDEX idx_deployments_run ON deployments (run_id) WHERE run_id IS NOT NULL;

    ALTER TABLE executions ADD COLUMN environment_id TEXT REFERENCES environments (id) ON DELETE SET NULL;
    ALTER TABLE executions ADD COLUMN deploy_target_id TEXT REFERENCES deploy_targets (id) ON DELETE SET NULL;
  `
};

/**
 * The Deployments tab existed as a key since M1 but was never seeded. Same shape
 * as m006 and m011: added after each project's last tab, visible, and left alone
 * where one already exists.
 */
const m014: Migration = {
  version: 14,
  name: 'deployments-tab-for-existing-projects',
  sql: `
    INSERT INTO workspace_tabs (id, project_id, tab_key, position, visible, pinned, source, integration_id, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) ||
                   '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
             p.id, 'deployments',
             COALESCE((SELECT MAX(position) FROM workspace_tabs WHERE project_id = p.id), -1) + 1,
             1, 0, 'builtin', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM projects p
       WHERE NOT EXISTS (SELECT 1 FROM workspace_tabs t WHERE t.project_id = p.id AND t.tab_key = 'deployments');
  `
};

/**
 * The Docker tab. Docker itself is the source of truth for containers and images,
 * so there are no tables: only the tab, added like m006, m011 and m014.
 */
const m015: Migration = {
  version: 15,
  name: 'docker-tab-for-existing-projects',
  sql: `
    INSERT INTO workspace_tabs (id, project_id, tab_key, position, visible, pinned, source, integration_id, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) ||
                   '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
             p.id, 'docker',
             COALESCE((SELECT MAX(position) FROM workspace_tabs WHERE project_id = p.id), -1) + 1,
             1, 0, 'builtin', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM projects p
       WHERE NOT EXISTS (SELECT 1 FROM workspace_tabs t WHERE t.project_id = p.id AND t.tab_key = 'docker');
  `
};

/**
 * Version 16 was a PM2 migration that ran on some machines while that milestone was being built, and then
 * the milestone was cancelled. A database that already recorded it keeps it; a database that did not simply
 * gets this empty step. Either way the real change is m017, which also cleans up what the PM2 one left.
 */
const m016: Migration = {
  version: 16,
  name: 'reserved-for-the-cancelled-pm2-milestone',
  sql: 'SELECT 1;'
};

/**
 * Data connections (MongoDB now, Redis next). The row holds only what is not secret: the URI with its
 * password, and any key passphrase, live encrypted in the secret store under this row's id. A connection
 * can belong to an environment; one in a protected environment starts read-only.
 *
 * It also removes the leftovers of the cancelled PM2 milestone (its table and its tab rows), which are
 * harmless on a database that never had them.
 */
const m017: Migration = {
  version: 17,
  name: 'data-connections-and-mongodb-tab',
  sql: `
    DROP TABLE IF EXISTS pm2_targets;
    DELETE FROM workspace_tabs WHERE tab_key = 'pm2';

    CREATE TABLE data_connections (
      id                TEXT NOT NULL PRIMARY KEY,
      project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      environment_id    TEXT REFERENCES environments (id) ON DELETE SET NULL,
      kind              TEXT NOT NULL CHECK (kind IN ('mongodb', 'redis')),
      name              TEXT NOT NULL,
      host_display      TEXT NOT NULL,
      options_json      TEXT NOT NULL,
      read_only         INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
      last_connected_at TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      UNIQUE (project_id, kind, name)
    );

    CREATE INDEX idx_data_connections_project ON data_connections (project_id, kind);

    CREATE TABLE mongo_saved_queries (
      id            TEXT NOT NULL PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES data_connections (id) ON DELETE CASCADE,
      namespace     TEXT NOT NULL,
      name          TEXT NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN ('find', 'aggregate')),
      body_json     TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE INDEX idx_mongo_saved_queries ON mongo_saved_queries (connection_id, namespace);

    INSERT INTO workspace_tabs (id, project_id, tab_key, position, visible, pinned, source, integration_id, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) ||
                   '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
             p.id, 'mongodb',
             COALESCE((SELECT MAX(position) FROM workspace_tabs WHERE project_id = p.id), -1) + 1,
             1, 0, 'builtin', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM projects p
       WHERE NOT EXISTS (SELECT 1 FROM workspace_tabs t WHERE t.project_id = p.id AND t.tab_key = 'mongodb');
  `
};

/**
 * The Redis tab and the commands a user saves in its console. Connections reuse `data_connections` (m017);
 * the command history stays in the renderer's memory and is never written.
 */
const m018: Migration = {
  version: 18,
  name: 'redis-saved-commands-and-tab',
  sql: `
    CREATE TABLE redis_saved_commands (
      id            TEXT NOT NULL PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES data_connections (id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      command_text  TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE INDEX idx_redis_saved_commands ON redis_saved_commands (connection_id);

    INSERT INTO workspace_tabs (id, project_id, tab_key, position, visible, pinned, source, integration_id, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) ||
                   '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
             p.id, 'redis',
             COALESCE((SELECT MAX(position) FROM workspace_tabs WHERE project_id = p.id), -1) + 1,
             1, 0, 'builtin', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM projects p
       WHERE NOT EXISTS (SELECT 1 FROM workspace_tabs t WHERE t.project_id = p.id AND t.tab_key = 'redis');
  `
};

/**
 * The tab bar now holds only Git and Terminal until a project adds more. For projects that already exist, an
 * optional tab stays when something is configured behind it and is hidden (not deleted: the + menu brings it
 * back) when nothing is. GitHub stops being a tab: its pull requests and Actions live inside Git. Docker has
 * no table that says it is in use, so it is hidden everywhere.
 */
const m019: Migration = {
  version: 19,
  name: 'optional-tabs-hidden-until-used',
  sql: `
    UPDATE workspace_tabs SET pinned = 1 WHERE tab_key = 'terminal';

    UPDATE workspace_tabs SET visible = 0 WHERE tab_key IN ('github', 'docker');

    UPDATE workspace_tabs SET visible = 0
     WHERE tab_key = 'ssh'
       AND NOT EXISTS (SELECT 1 FROM ssh_hosts h WHERE h.project_id = workspace_tabs.project_id);

    UPDATE workspace_tabs SET visible = 0
     WHERE tab_key = 'deployments'
       AND NOT EXISTS (SELECT 1 FROM deploy_targets d WHERE d.project_id = workspace_tabs.project_id);

    UPDATE workspace_tabs SET visible = 0
     WHERE tab_key = 'mongodb'
       AND NOT EXISTS (SELECT 1 FROM data_connections c WHERE c.project_id = workspace_tabs.project_id AND c.kind = 'mongodb');

    UPDATE workspace_tabs SET visible = 0
     WHERE tab_key = 'redis'
       AND NOT EXISTS (SELECT 1 FROM data_connections c WHERE c.project_id = workspace_tabs.project_id AND c.kind = 'redis');
  `
};

/** An environment can carry an icon the user picks (Staging, Production, Local…). */
const m020: Migration = {
  version: 20,
  name: 'environment-icon',
  sql: `ALTER TABLE environments ADD COLUMN icon TEXT;`
};

export const MIGRATIONS: readonly Migration[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
  m011,
  m012,
  m013,
  m014,
  m015,
  m016,
  m017,
  m018,
  m019,
  m020
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
