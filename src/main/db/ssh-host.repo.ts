import type { SshProvider } from '@shared/schemas/ssh';
import type { SqlDatabase } from './driver';

/** Persisted fields only: connection state is live and lives in the SSH service. */
export interface SshHostRecord {
  id: string;
  projectId: string;
  name: string;
  host: string;
  port: number | null;
  username: string | null;
  identityFile: string | null;
  environment: string | null;
  provider: SshProvider | null;
  region: string | null;
  domain: string | null;
  ipAddress: string | null;
  description: string | null;
  vpcName: string | null;
  vpcId: string | null;
  vpcCidr: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SshHostRow {
  id: string;
  project_id: string;
  name: string;
  host: string;
  port: number | null;
  username: string | null;
  identity_file: string | null;
  environment: string | null;
  provider: SshProvider | null;
  region: string | null;
  domain: string | null;
  ip_address: string | null;
  description: string | null;
  vpc_name: string | null;
  vpc_id: string | null;
  vpc_cidr: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: SshHostRow): SshHostRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    identityFile: row.identity_file,
    environment: row.environment,
    provider: row.provider,
    region: row.region,
    domain: row.domain,
    ipAddress: row.ip_address,
    description: row.description,
    vpcName: row.vpc_name,
    vpcId: row.vpc_id,
    vpcCidr: row.vpc_cidr,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toParams(host: SshHostRecord): Record<string, string | number | null> {
  return {
    id: host.id,
    name: host.name,
    host: host.host,
    port: host.port,
    username: host.username,
    identity_file: host.identityFile,
    environment: host.environment,
    provider: host.provider,
    region: host.region,
    domain: host.domain,
    ip_address: host.ipAddress,
    description: host.description,
    vpc_name: host.vpcName,
    vpc_id: host.vpcId,
    vpc_cidr: host.vpcCidr,
    updated_at: host.updatedAt
  };
}

export function listSshHosts(db: SqlDatabase, projectId: string): SshHostRecord[] {
  return db
    .prepare('SELECT * FROM ssh_hosts WHERE project_id = :project_id ORDER BY name COLLATE NOCASE, id')
    .all<SshHostRow>({ project_id: projectId })
    .map(toRecord);
}

export function findSshHost(db: SqlDatabase, id: string): SshHostRecord | null {
  const row = db.prepare('SELECT * FROM ssh_hosts WHERE id = :id').get<SshHostRow>({ id });
  return row === undefined ? null : toRecord(row);
}

export function findSshHostByName(db: SqlDatabase, projectId: string, name: string): SshHostRecord | null {
  const row = db
    .prepare('SELECT * FROM ssh_hosts WHERE project_id = :project_id AND name = :name COLLATE NOCASE')
    .get<SshHostRow>({ project_id: projectId, name });
  return row === undefined ? null : toRecord(row);
}

export function insertSshHost(db: SqlDatabase, host: SshHostRecord): void {
  db.prepare(
    `INSERT INTO ssh_hosts (id, project_id, name, host, port, username, identity_file, environment, provider,
                            region, domain, ip_address, description, vpc_name, vpc_id, vpc_cidr,
                            created_at, updated_at)
     VALUES (:id, :project_id, :name, :host, :port, :username, :identity_file, :environment, :provider,
             :region, :domain, :ip_address, :description, :vpc_name, :vpc_id, :vpc_cidr,
             :created_at, :updated_at)`
  ).run({ ...toParams(host), project_id: host.projectId, created_at: host.createdAt });
}

export function updateSshHost(db: SqlDatabase, host: SshHostRecord): void {
  db.prepare(
    `UPDATE ssh_hosts
        SET name = :name, host = :host, port = :port, username = :username, identity_file = :identity_file,
            environment = :environment, provider = :provider, region = :region, domain = :domain,
            ip_address = :ip_address, description = :description, vpc_name = :vpc_name, vpc_id = :vpc_id,
            vpc_cidr = :vpc_cidr, updated_at = :updated_at
      WHERE id = :id`
  ).run(toParams(host));
}

export function deleteSshHost(db: SqlDatabase, id: string): void {
  db.prepare('DELETE FROM ssh_hosts WHERE id = :id').run({ id });
}
