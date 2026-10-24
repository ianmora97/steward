import type {
  DockerComposeService,
  DockerContainer,
  DockerContainerDetail,
  DockerContainerStats,
  DockerImage,
  DockerNetwork,
  DockerVolume
} from '@shared/schemas/docker';
import { redactSecrets } from './git-errors';

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function str(object: Json, key: string): string {
  const value = object[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function num(object: Json, key: string): number | null {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percent(text: string): number | null {
  const value = Number.parseFloat(text.replace('%', ''));
  return Number.isFinite(value) ? value : null;
}

/** `docker … --format '{{json .}}'` prints one JSON document per line; anything else is skipped, not fatal. */
export function parseJsonLines(text: string): Json[] {
  const rows: Json[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      rows.push(asRecord(JSON.parse(trimmed)));
    } catch {
      // A partial line (output cut at the cap) is dropped.
    }
  }
  return rows;
}

const COMPOSE_PROJECT = /(?:^|,)com\.docker\.compose\.project=([^,]+)/;

export function parseContainers(text: string): DockerContainer[] {
  return parseJsonLines(text).map((row) => ({
    id: str(row, 'ID'),
    name: str(row, 'Names').split(',')[0] ?? '',
    image: str(row, 'Image'),
    command: str(row, 'Command'),
    createdAt: str(row, 'CreatedAt'),
    runningFor: str(row, 'RunningFor'),
    ports: str(row, 'Ports'),
    state: str(row, 'State'),
    status: str(row, 'Status'),
    networks: str(row, 'Networks'),
    composeProject: COMPOSE_PROJECT.exec(str(row, 'Labels'))?.[1] ?? null
  }));
}

export function parseStats(text: string): DockerContainerStats[] {
  return parseJsonLines(text).map((row) => ({
    id: str(row, 'ID') || str(row, 'Container'),
    name: str(row, 'Name'),
    cpuPercent: percent(str(row, 'CPUPerc')),
    memoryUsage: str(row, 'MemUsage'),
    memoryPercent: percent(str(row, 'MemPerc')),
    networkIo: str(row, 'NetIO'),
    blockIo: str(row, 'BlockIO'),
    pids: Number.isFinite(Number.parseInt(str(row, 'PIDs'), 10)) ? Number.parseInt(str(row, 'PIDs'), 10) : null
  }));
}

export function parseImages(text: string, containers: readonly DockerContainer[]): DockerImage[] {
  return parseJsonLines(text).map((row) => {
    const id = str(row, 'ID');
    const repository = str(row, 'Repository');
    const tag = str(row, 'Tag');
    const reference = tag === '' || tag === '<none>' ? repository : `${repository}:${tag}`;
    const usedBy = containers
      .filter((container) => container.image === reference || container.image === id || container.image === repository)
      .map((container) => container.name);
    return {
      id,
      repository,
      tag,
      createdSince: str(row, 'CreatedSince'),
      size: str(row, 'Size'),
      dangling: repository === '<none>',
      usedBy
    };
  });
}

export function parseVolumes(text: string): DockerVolume[] {
  return parseJsonLines(text).map((row) => ({
    name: str(row, 'Name'),
    driver: str(row, 'Driver'),
    scope: str(row, 'Scope')
  }));
}

export function parseNetworks(text: string): DockerNetwork[] {
  return parseJsonLines(text).map((row) => ({
    id: str(row, 'ID'),
    name: str(row, 'Name'),
    driver: str(row, 'Driver'),
    scope: str(row, 'Scope')
  }));
}

/** `docker compose ps --format json` prints a JSON array in some versions and one object per line in others. */
export function parseComposeServices(text: string): DockerComposeService[] {
  const trimmed = text.trim();
  let rows: Json[];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      rows = Array.isArray(parsed) ? parsed.map(asRecord) : [];
    } catch {
      rows = [];
    }
  } else {
    rows = parseJsonLines(trimmed);
  }
  return rows.map((row) => ({
    name: str(row, 'Name'),
    service: str(row, 'Service'),
    state: str(row, 'State'),
    status: str(row, 'Status'),
    ports: composePorts(row)
  }));
}

/** Compose lists published ports as objects under `Publishers`; older versions give one `Ports` string. */
function composePorts(row: Json): string {
  const publishers = row['Publishers'];
  if (!Array.isArray(publishers)) return str(row, 'Ports');
  return publishers
    .map(asRecord)
    .filter((publisher) => (num(publisher, 'PublishedPort') ?? 0) > 0)
    .map((publisher) => `${str(publisher, 'PublishedPort')}→${str(publisher, 'TargetPort')}/${str(publisher, 'Protocol')}`)
    .join(', ');
}

/** Names that look like credentials. Their values never leave the main process. */
const SECRET_NAME = /SECRET|TOKEN|PASSWORD|PASSWD|PWD|KEY|CREDENTIAL|AUTH|PRIVATE/i;

function parseEnv(value: unknown): { name: string; value: string | null }[] {
  if (!Array.isArray(value)) return [];
  const entries: { name: string; value: string | null }[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const separator = item.indexOf('=');
    const name = separator === -1 ? item : item.slice(0, separator);
    const raw = separator === -1 ? '' : item.slice(separator + 1);
    entries.push({ name, value: SECRET_NAME.test(name) ? null : redactSecrets(raw) });
  }
  return entries;
}

function portLines(ports: Json): string[] {
  const lines: string[] = [];
  for (const [container, bindings] of Object.entries(ports)) {
    if (!Array.isArray(bindings) || bindings.length === 0) {
      lines.push(container);
      continue;
    }
    for (const binding of bindings) {
      const record = asRecord(binding);
      const host = str(record, 'HostIp');
      lines.push(`${host === '' ? '' : `${host}:`}${str(record, 'HostPort')} → ${container}`);
    }
  }
  return lines;
}

/** `docker inspect <id>` prints an array with one object. Returns null when it holds none. */
export function parseInspect(text: string): DockerContainerDetail | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const root = asRecord(Array.isArray(parsed) ? parsed[0] : parsed);
  if (str(root, 'Id') === '') return null;

  const state = asRecord(root['State']);
  const config = asRecord(root['Config']);
  const hostConfig = asRecord(root['HostConfig']);
  const network = asRecord(root['NetworkSettings']);
  const health = asRecord(state['Health']);
  const command = [str(root, 'Path'), ...(Array.isArray(root['Args']) ? (root['Args'] as unknown[]).map(String) : [])]
    .join(' ')
    .trim();

  return {
    id: str(root, 'Id'),
    name: str(root, 'Name').replace(/^\//, ''),
    image: str(config, 'Image'),
    command,
    createdAt: str(root, 'Created'),
    state: str(state, 'Status'),
    running: state['Running'] === true,
    exitCode: num(state, 'ExitCode'),
    startedAt: str(state, 'StartedAt') === '' || str(state, 'StartedAt').startsWith('0001-') ? null : str(state, 'StartedAt'),
    finishedAt: str(state, 'FinishedAt') === '' || str(state, 'FinishedAt').startsWith('0001-') ? null : str(state, 'FinishedAt'),
    health: str(health, 'Status') === '' ? null : str(health, 'Status'),
    restartCount: num(root, 'RestartCount') ?? 0,
    restartPolicy: str(asRecord(hostConfig['RestartPolicy']), 'Name') || 'no',
    workingDir: str(config, 'WorkingDir'),
    user: str(config, 'User'),
    ports: portLines(asRecord(network['Ports'])),
    mounts: (Array.isArray(root['Mounts']) ? (root['Mounts'] as unknown[]) : []).map((mount) => {
      const record = asRecord(mount);
      return {
        type: str(record, 'Type'),
        source: str(record, 'Source') || str(record, 'Name'),
        destination: str(record, 'Destination'),
        readWrite: record['RW'] !== false
      };
    }),
    networks: Object.entries(asRecord(network['Networks'])).map(([name, value]) => ({
      name,
      ipAddress: str(asRecord(value), 'IPAddress')
    })),
    env: parseEnv(config['Env']),
    labels: Object.entries(asRecord(config['Labels'])).map(([name, value]) => ({
      name,
      value: typeof value === 'string' ? redactSecrets(value) : ''
    }))
  };
}
