import { z } from 'zod';
import { absolutePathSchema, idSchema, isoTimestampSchema } from './common';

export const TERMINAL_LOG_CAP_BYTES = 5 * 1024 * 1024;
export const TERMINAL_RING_BYTES = 1024 * 1024;
export const TERMINAL_MAX_SESSIONS = 8;

const profileIdSchema = z.string().min(1).max(80);

const dimensionSchema = z.number().int().min(1).max(1000);

export const terminalSessionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  /** Null for a remote shell, which has no local folder. */
  repositoryId: idSchema.nullable(),
  /** Set for a shell on an SSH host: everything typed in it runs there, not on this machine. */
  sshHostId: idSchema.nullable(),
  executionId: idSchema,
  shell: z.string(),
  profileName: z.string(),
  cwd: z.string(),
  status: z.enum(['running', 'exited']),
  exitCode: z.number().int().nullable(),
  /** The log file stopped growing at the cap; the live ring keeps rolling. */
  truncated: z.boolean(),
  startedAt: isoTimestampSchema
});

export const terminalCreateInputSchema = z
  .object({
    projectId: idSchema,
    /** A local shell opens in this repository's folder. */
    repositoryId: idSchema.optional(),
    /** A remote shell: main starts the system `ssh` for this saved host. */
    sshHostId: idSchema.optional(),
    /** Omitted = the project's default profile. The renderer names a profile; main resolves the executable. */
    profileId: profileIdSchema.optional(),
    cols: dimensionSchema,
    rows: dimensionSchema
  })
  .refine((input) => (input.repositoryId === undefined) !== (input.sshHostId === undefined), {
    message: 'choose either a repository or an SSH host'
  });

/** Keystrokes for an existing session. It never starts a process. */
export const terminalWriteInputSchema = z.object({
  sessionId: idSchema,
  data: z.string().max(64 * 1024)
});

export const terminalResizeInputSchema = z.object({
  sessionId: idSchema,
  cols: dimensionSchema,
  rows: dimensionSchema
});

export const terminalSessionIdInputSchema = z.object({ sessionId: idSchema });
export const terminalListInputSchema = z.object({ projectId: idSchema });
export const terminalGetSettingsInputSchema = z.object({ projectId: idSchema });

/** A shell the user can open. `detected` ones come from this machine; `custom` ones are saved by the user and are global. */
export const terminalProfileSchema = z.object({
  id: profileIdSchema,
  name: z.string().min(1).max(60),
  file: z.string(),
  args: z.array(z.string()),
  kind: z.enum(['detected', 'custom'])
});

export const terminalSaveProfileInputSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(60),
  shellPath: absolutePathSchema,
  shellArgs: z.array(z.string().max(256)).max(16)
});

export const terminalDeleteProfileInputSchema = z.object({ profileId: profileIdSchema });

export const terminalSettingsSchema = z.object({
  defaultProfileId: profileIdSchema.nullable()
});

export const terminalSetSettingsInputSchema = terminalSettingsSchema.extend({ projectId: idSchema });

export const terminalAttachResultSchema = z.object({
  session: terminalSessionSchema,
  buffer: z.string(),
  /** Total characters the session had produced when `buffer` was taken; lets the renderer drop events already in it. */
  offset: z.number().int().nonnegative()
});

export type TerminalSession = z.infer<typeof terminalSessionSchema>;
export type TerminalCreateInput = z.infer<typeof terminalCreateInputSchema>;
export type TerminalWriteInput = z.infer<typeof terminalWriteInputSchema>;
export type TerminalResizeInput = z.infer<typeof terminalResizeInputSchema>;
export type TerminalSessionIdInput = z.infer<typeof terminalSessionIdInputSchema>;
export type TerminalListInput = z.infer<typeof terminalListInputSchema>;
export type TerminalGetSettingsInput = z.infer<typeof terminalGetSettingsInputSchema>;
export type TerminalProfile = z.infer<typeof terminalProfileSchema>;
export type TerminalSaveProfileInput = z.infer<typeof terminalSaveProfileInputSchema>;
export type TerminalDeleteProfileInput = z.infer<typeof terminalDeleteProfileInputSchema>;
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;
export type TerminalSetSettingsInput = z.infer<typeof terminalSetSettingsInputSchema>;
export type TerminalAttachResult = z.infer<typeof terminalAttachResultSchema>;

export interface TerminalDataEvent {
  sessionId: string;
  data: string;
  /** Characters the session had produced before `data`. */
  offset: number;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number | null;
}
