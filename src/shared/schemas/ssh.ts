import { z } from 'zod';
import { absolutePathSchema, displayNameSchema, idSchema, isoTimestampSchema } from './common';

export const SSH_COMMAND_MAX_CHARS = 4000;
export const SSH_COMMAND_DEFAULT_TIMEOUT_SECONDS = 30;
export const SSH_COMMAND_MAX_TIMEOUT_SECONDS = 300;

/** A host name, IP or ~/.ssh/config alias. It can never start with `-`, so it cannot be read as an ssh option. */
export const sshHostnameSchema = z
  .string()
  .trim()
  .min(1, 'host is required')
  .max(253)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'use letters, digits, dots, colons, hyphens or underscores')
  .refine((value) => !value.startsWith('-'), 'a host cannot start with a hyphen');

const sshUsernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/, 'use letters, digits, dots, hyphens or underscores');

const sshPortSchema = z.number().int().min(1).max(65535);

export const SSH_PROVIDERS = [
  'aws',
  'digitalocean',
  'gcp',
  'azure',
  'hetzner',
  'linode',
  'vultr',
  'on_prem',
  'other'
] as const;

export const sshProviderSchema = z.enum(SSH_PROVIDERS);

/** Optional free text: the UI sends null for an empty box so the database never holds empty strings. */
const optionalText = (max: number): z.ZodNullable<z.ZodString> => z.string().trim().min(1).max(max).nullable();

const sshHostFieldsSchema = z.object({
  name: displayNameSchema,
  host: sshHostnameSchema,
  port: sshPortSchema.nullable(),
  username: sshUsernameSchema.nullable(),
  /** Path to a private key (.pem). Only the path is stored; the file is read by `ssh`, never by Steward. */
  identityFile: absolutePathSchema.nullable(),
  /** One of the project's environments; servers in the same environment share a column. */
  environmentId: idSchema.nullable(),
  provider: sshProviderSchema.nullable(),
  region: optionalText(60),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9_.-]+$/, 'a domain has letters, digits, dots and hyphens only')
    .nullable(),
  ipAddress: z
    .string()
    .trim()
    .min(1)
    .max(45)
    .regex(/^[0-9A-Fa-f:.]+$/, 'not a valid IP address')
    .nullable(),
  description: optionalText(500),
  vpcName: optionalText(80),
  vpcId: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, 'a VPC id has letters, digits and hyphens only')
    .nullable(),
  vpcCidr: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[0-9A-Fa-f:.]+\/\d{1,3}$/, 'use CIDR notation, like 10.20.0.0/16')
    .nullable()
});

/**
 * Where the connection stands, kept apart from whether the last command worked:
 * a host can be `connected` while its last command is failing.
 */
export const sshConnectionStateSchema = z.enum([
  'unknown',
  'connected',
  'unreachable',
  'timeout',
  'auth_failed',
  'host_key_unknown',
  'host_key_changed',
  'error'
]);

export const sshConnectionSchema = z.object({
  state: sshConnectionStateSchema,
  checkedAt: isoTimestampSchema.nullable(),
  message: z.string().nullable(),
  hint: z.string().nullable()
});

export const sshLastCommandSchema = z.object({
  executionId: idSchema,
  command: z.string(),
  status: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out']),
  exitCode: z.number().int().nullable(),
  finishedAt: isoTimestampSchema
});

export const sshHostSchema = sshHostFieldsSchema.extend({
  id: idSchema,
  projectId: idSchema,
  createdAt: isoTimestampSchema,
  /** The environment's name, resolved by main. Read-only: it is changed through `environmentId`. */
  environment: z.string().nullable(),
  connection: sshConnectionSchema,
  lastCommand: sshLastCommandSchema.nullable(),
  /** `none` until a one-shot command has run; then whether the latest one succeeded. */
  operational: z.enum(['none', 'healthy', 'failing'])
});

export const sshListInputSchema = z.object({ projectId: idSchema });
export const sshCreateInputSchema = sshHostFieldsSchema.extend({ projectId: idSchema });
export const sshUpdateInputSchema = sshHostFieldsSchema.extend({ id: idSchema });
export const sshHostIdInputSchema = z.object({ id: idSchema });

export const sshRunCommandInputSchema = z.object({
  id: idSchema,
  command: z.string().min(1, 'a command is required').max(SSH_COMMAND_MAX_CHARS).refine((value) => value.trim() !== '', 'a command is required'),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(SSH_COMMAND_MAX_TIMEOUT_SECONDS)
    .default(SSH_COMMAND_DEFAULT_TIMEOUT_SECONDS)
});

export const sshCommandResultSchema = z.object({
  executionId: idSchema,
  exitCode: z.number().int(),
  status: z.enum(['succeeded', 'failed']),
  stdout: z.string(),
  stderr: z.string(),
  /** Output passed the capture limit; the rest was dropped. */
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative()
});

export const sshHostKeySchema = z.object({
  type: z.string(),
  fingerprint: z.string()
});

export const sshScanResultSchema = z.object({
  /** Where ssh will actually connect, after ~/.ssh/config is applied. */
  hostname: z.string(),
  port: z.number().int(),
  keys: z.array(sshHostKeySchema).min(1)
});

export const sshTrustInputSchema = z.object({
  id: idSchema,
  /** The fingerprints the user was shown. Main trusts the host only if the key it fetches now matches them. */
  fingerprints: z.array(z.string().min(1).max(200)).min(1).max(16)
});

export const sshListExecutionsInputSchema = z.object({
  id: idSchema,
  limit: z.number().int().min(1).max(200).default(50)
});

export type SshProvider = z.infer<typeof sshProviderSchema>;
export type SshHost = z.infer<typeof sshHostSchema>;
export type SshConnection = z.infer<typeof sshConnectionSchema>;
export type SshConnectionState = z.infer<typeof sshConnectionStateSchema>;
export type SshLastCommand = z.infer<typeof sshLastCommandSchema>;
export type SshListInput = z.infer<typeof sshListInputSchema>;
export type SshCreateInput = z.infer<typeof sshCreateInputSchema>;
export type SshUpdateInput = z.infer<typeof sshUpdateInputSchema>;
export type SshHostIdInput = z.infer<typeof sshHostIdInputSchema>;
export type SshRunCommandInput = z.infer<typeof sshRunCommandInputSchema>;
export type SshCommandResult = z.infer<typeof sshCommandResultSchema>;
export type SshHostKey = z.infer<typeof sshHostKeySchema>;
export type SshScanResult = z.infer<typeof sshScanResultSchema>;
export type SshTrustInput = z.infer<typeof sshTrustInputSchema>;
export type SshListExecutionsInput = z.infer<typeof sshListExecutionsInputSchema>;
