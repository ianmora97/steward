import { ipcMain } from 'electron';
import { assertChannelCoverage, buildHandlerDefinitions, runHandler, type IpcContext } from './handlers';

/**
 * Binds the channel definitions to Electron's `ipcMain`.
 *
 * Nothing else in the main process calls `ipcMain.handle`, so the set of
 * reachable operations is exactly the set declared in handlers.ts.
 */
export function registerIpcHandlers(context: IpcContext): void {
  const definitions = buildHandlerDefinitions(context);
  assertChannelCoverage(definitions);

  for (const definition of definitions) {
    ipcMain.handle(definition.channel, async (_event, payload: unknown) =>
      runHandler(definition, payload)
    );
  }
}
