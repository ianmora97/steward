import { z } from 'zod';
import { idSchema } from './common';

export const DOCKER_MAX_LOG_STREAMS = 6;
export const DOCKER_LOG_TAIL_DEFAULT = 500;
export const DOCKER_LOG_TAIL_MAX = 5000;

/**
 * Where a Docker command runs: this machine, or one of the project's SSH servers.
 * The host is looked up (and checked against the project) in main; the renderer
 * only names it.
 */
export const dockerTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }),
  z.object({ kind: z.literal('ssh'), sshHostId: idSchema })
]);

/**
 * Container, volume and network names and ids. The first character is
 * alphanumeric so a value can never be read as a flag, and the alphabet has no
 * shell or path metacharacters, which keeps remote commands free of injection.
 */
export const dockerObjectIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'not a valid Docker name or id');

/** `registry.example.com:5000/team/app:1.2` or `app@sha256:…`. */
export const dockerImageRefSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/, 'not a valid image reference');

const projectTargetShape = { projectId: idSchema, target: dockerTargetSchema };

/**
 * Typing the exact name is how a destructive action on a protected server is
 * confirmed. Main checks it against the real name; the renderer cannot skip it.
 */
const confirmationSchema = z.object({ name: z.string().max(256) });

export const dockerTargetInputSchema = z.object(projectTargetShape);

export const dockerContainerActionSchema = z.enum([
  'start',
  'stop',
  'restart',
  'pause',
  'unpause',
  'kill',
  'remove'
]);

export const dockerContainerIdInputSchema = z.object({ ...projectTargetShape, containerId: dockerObjectIdSchema });

export const dockerContainerActionInputSchema = z
  .object({
    ...projectTargetShape,
    containerId: dockerObjectIdSchema,
    action: dockerContainerActionSchema,
    confirmed: z.boolean().optional(),
    confirmation: confirmationSchema.optional()
  })
  .refine((input) => (input.action !== 'kill' && input.action !== 'remove') || input.confirmed === true, {
    message: 'kill and remove need confirmed: true',
    path: ['confirmed']
  });

export const dockerLogsStartInputSchema = z.object({
  ...projectTargetShape,
  containerId: dockerObjectIdSchema,
  tail: z.number().int().min(0).max(DOCKER_LOG_TAIL_MAX).optional()
});

export const dockerLogsStopInputSchema = z.object({ subscriptionId: idSchema });

export const dockerImagePullInputSchema = z.object({ ...projectTargetShape, image: dockerImageRefSchema });

export const dockerImageRemoveInputSchema = z.object({
  ...projectTargetShape,
  image: dockerImageRefSchema,
  confirmed: z.literal(true),
  confirmation: confirmationSchema.optional()
});

export const dockerPruneKindSchema = z.enum(['containers', 'images', 'volumes', 'networks', 'system']);

export const dockerPruneInputSchema = z.object({
  ...projectTargetShape,
  kind: dockerPruneKindSchema,
  confirmed: z.literal(true),
  confirmation: confirmationSchema.optional()
});

export const dockerVolumeRemoveInputSchema = z.object({
  ...projectTargetShape,
  name: dockerObjectIdSchema,
  confirmed: z.literal(true),
  confirmation: confirmationSchema.optional()
});

export const dockerNetworkRemoveInputSchema = z.object({
  ...projectTargetShape,
  name: dockerObjectIdSchema,
  confirmed: z.literal(true),
  confirmation: confirmationSchema.optional()
});

export const dockerComposeListInputSchema = z.object({ projectId: idSchema });

export const dockerComposeRepositoryInputSchema = z.object({ projectId: idSchema, repositoryId: idSchema });

export const dockerComposeActionSchema = z.enum(['up', 'down', 'restart', 'stop', 'pull']);

export const dockerComposeActionInputSchema = z
  .object({
    projectId: idSchema,
    repositoryId: idSchema,
    action: dockerComposeActionSchema,
    /** Only meaningful for `down`: also removes the named volumes, which deletes their data. */
    removeVolumes: z.boolean().optional(),
    confirmed: z.boolean().optional()
  })
  .refine((input) => input.removeVolumes !== true || (input.action === 'down' && input.confirmed === true), {
    message: 'removing volumes only applies to down and needs confirmed: true',
    path: ['confirmed']
  });

export type DockerTarget = z.infer<typeof dockerTargetSchema>;
export type DockerTargetInput = z.infer<typeof dockerTargetInputSchema>;
export type DockerContainerAction = z.infer<typeof dockerContainerActionSchema>;
export type DockerContainerIdInput = z.infer<typeof dockerContainerIdInputSchema>;
export type DockerContainerActionInput = z.infer<typeof dockerContainerActionInputSchema>;
export type DockerLogsStartInput = z.infer<typeof dockerLogsStartInputSchema>;
export type DockerLogsStopInput = z.infer<typeof dockerLogsStopInputSchema>;
export type DockerImagePullInput = z.infer<typeof dockerImagePullInputSchema>;
export type DockerImageRemoveInput = z.infer<typeof dockerImageRemoveInputSchema>;
export type DockerPruneKind = z.infer<typeof dockerPruneKindSchema>;
export type DockerPruneInput = z.infer<typeof dockerPruneInputSchema>;
export type DockerVolumeRemoveInput = z.infer<typeof dockerVolumeRemoveInputSchema>;
export type DockerNetworkRemoveInput = z.infer<typeof dockerNetworkRemoveInputSchema>;
export type DockerComposeListInput = z.infer<typeof dockerComposeListInputSchema>;
export type DockerComposeRepositoryInput = z.infer<typeof dockerComposeRepositoryInputSchema>;
export type DockerComposeAction = z.infer<typeof dockerComposeActionSchema>;
export type DockerComposeActionInput = z.infer<typeof dockerComposeActionInputSchema>;

export const dockerStartInputSchema = z.object({ projectId: idSchema });

export type DockerStartInput = z.infer<typeof dockerStartInputSchema>;

export type DockerState =
  | 'ready'
  | 'starting'
  | 'not_installed'
  | 'daemon_down'
  | 'permission_denied'
  | 'unreachable'
  | 'error';

/** `launched` is false when Docker was already up or already being started. */
export interface DockerStartResult {
  launched: boolean;
  state: 'ready' | 'starting';
}

/** Reported rather than thrown: "Docker is off" is something the page explains, not an error banner. */
export interface DockerStatus {
  state: DockerState;
  cliVersion: string | null;
  serverVersion: string | null;
  message: string | null;
  hint: string | null;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  command: string;
  createdAt: string;
  runningFor: string;
  ports: string;
  /** Docker's own word: running, exited, paused, restarting, created, dead, removing. */
  state: string;
  status: string;
  networks: string;
  composeProject: string | null;
}

export interface DockerContainerStats {
  id: string;
  name: string;
  cpuPercent: number | null;
  memoryUsage: string;
  memoryPercent: number | null;
  networkIo: string;
  blockIo: string;
  pids: number | null;
}

export interface DockerMount {
  type: string;
  source: string;
  destination: string;
  readWrite: boolean;
}

export interface DockerContainerDetail {
  id: string;
  name: string;
  image: string;
  command: string;
  createdAt: string;
  state: string;
  running: boolean;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  health: string | null;
  restartCount: number;
  restartPolicy: string;
  workingDir: string;
  user: string;
  ports: string[];
  mounts: DockerMount[];
  networks: { name: string; ipAddress: string }[];
  /** `value` is null for names that look like secrets: the name is shown, the value never leaves main. */
  env: { name: string; value: string | null }[];
  labels: { name: string; value: string }[];
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  createdSince: string;
  size: string;
  dangling: boolean;
  /** Names of containers created from it. */
  usedBy: string[];
}

export interface DockerVolume {
  name: string;
  driver: string;
  scope: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface DockerCommandOutput {
  output: string;
}

export interface DockerLogsStarted {
  subscriptionId: string;
}

export interface DockerLogEvent {
  subscriptionId: string;
  stream: 'out' | 'err';
  lines: string[];
}

export interface DockerLogEndEvent {
  subscriptionId: string;
  reason: 'exited' | 'stopped' | 'error';
  message: string | null;
}

export interface DockerComposeProject {
  repositoryId: string;
  repositoryName: string;
  file: string;
}

export interface DockerComposeService {
  name: string;
  service: string;
  state: string;
  status: string;
  ports: string;
}
