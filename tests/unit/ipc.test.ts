import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StewardDatabase } from '@main/db/connection';
import {
  assertChannelCoverage,
  buildHandlerDefinitions,
  runHandler,
  type IpcContext,
  type IpcHandlerDefinition
} from '@main/ipc/handlers';
import { IPC_CHANNELS, type AppInfo } from '@shared/types/ipc';
import { StewardServiceError } from '@shared/types/result';
import { createTestDatabase } from '../helpers/database';

const appInfo: AppInfo = {
  appVersion: '0.1.0',
  electronVersion: '45.0.0',
  chromeVersion: '0',
  nodeVersion: process.versions.node,
  platform: process.platform,
  databasePath: ':memory:',
  schemaVersion: 1,
  databaseDriver: 'node:sqlite',
  gitAvailable: true,
  gitVersion: '2.39.2'
};

describe('ipc boundary', () => {
  let database: StewardDatabase;
  let cleanup: () => void;
  let context: IpcContext;
  let definitions: IpcHandlerDefinition[];

  function definitionFor(channel: string): IpcHandlerDefinition {
    const found = definitions.find((definition) => definition.channel === channel);
    if (found === undefined) throw new Error(`no handler for ${channel}`);
    return found;
  }

  beforeEach(() => {
    ({ database, cleanup } = createTestDatabase());
    context = {
      database,
      readAppInfo: async () => appInfo,
      pickDirectory: async () => ({ cancelled: true, localPath: null })
    };
    definitions = buildHandlerDefinitions(context);
  });

  afterEach(() => cleanup());

  it('registers exactly one schema-backed handler per declared channel', () => {
    expect(() => assertChannelCoverage(definitions)).not.toThrow();
    expect(definitions).toHaveLength(Object.keys(IPC_CHANNELS).length);
    expect(definitions.every((definition) => typeof definition.schema.safeParse === 'function')).toBe(true);
  });

  it('rejects a handler for an undeclared channel', () => {
    const rogue = {
      channel: 'shell:exec' as never,
      schema: z.object({}),
      handle: () => undefined
    } satisfies IpcHandlerDefinition;

    expect(() => assertChannelCoverage([...definitions, rogue])).toThrow(/undeclared channel/);
  });

  it('rejects duplicate handlers and missing handlers', () => {
    expect(() => assertChannelCoverage([...definitions, definitionFor(IPC_CHANNELS.tabsList)])).toThrow(
      /duplicate handler/
    );
    expect(() => assertChannelCoverage(definitions.slice(1))).toThrow(/without handlers/);
  });

  it('turns a malformed payload into VALIDATION_FAILED without reaching the service', () => {
    return (async () => {
      const result = await runHandler(definitionFor(IPC_CHANNELS.projectsCreate), { name: '' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.details).toContain('name');
    })();
  });

  it('rejects a payload of the wrong shape entirely', async () => {
    const result = await runHandler(definitionFor(IPC_CHANNELS.projectsDelete), 'not-an-object');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns typed data on success', async () => {
    const created = await runHandler(definitionFor(IPC_CHANNELS.projectsCreate), { name: 'Billing' });
    expect(created.success).toBe(true);

    const listed = await runHandler(definitionFor(IPC_CHANNELS.projectsList), {});
    expect(listed.success).toBe(true);
    if (listed.success) expect((listed.data as Array<{ name: string }>)[0]?.name).toBe('Billing');
  });

  it('preserves the code and message of an expected service failure', async () => {
    const result = await runHandler(definitionFor(IPC_CHANNELS.projectsDelete), {
      id: '0192f0c0-dead-7000-8000-000000000000'
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toMatch(/no longer exists/);
    }
  });

  it('does not leak the text of an unexpected error', async () => {
    const leaky: IpcHandlerDefinition = {
      channel: IPC_CHANNELS.appGetInfo,
      schema: z.object({}),
      handle: () => {
        throw new Error('token=ghp_SECRETVALUE at C:\\Users\\ianmo\\secret');
      }
    };

    const result = await runHandler(leaky, {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('UNKNOWN');
      expect(JSON.stringify(result.error)).not.toContain('ghp_SECRETVALUE');
      expect(JSON.stringify(result.error)).not.toContain('C:\\Users');
    }
  });

  it('passes a StewardServiceError through with its details', async () => {
    const failing: IpcHandlerDefinition = {
      channel: IPC_CHANNELS.appGetInfo,
      schema: z.object({}),
      handle: () => {
        throw new StewardServiceError('GIT_NOT_FOUND', 'Git was not found', 'Install Git and retry.');
      }
    };

    const result = await runHandler(failing, {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({
        code: 'GIT_NOT_FOUND',
        message: 'Git was not found',
        details: 'Install Git and retry.'
      });
    }
  });

  it('treats a cancelled folder pick as a normal outcome', async () => {
    const result = await runHandler(definitionFor(IPC_CHANNELS.repositoriesPickDirectory), {});

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ cancelled: true, localPath: null });
  });
});
