import { StewardServiceError } from '@shared/types/result';
import { linkExecutionToDeploy } from '../db/deployment.repo';
import type { SqlDatabase } from '../db/driver';
import type { DeploymentRunner } from './deployment-runner';
import type { SshService } from './ssh.service';

/**
 * Printed to stderr by the composed command the moment it begins. It is how a
 * dropped connection is told apart from a command that never started: an ssh
 * exit of 255 after the marker may be the connection dying mid-run, not a failure.
 */
export const START_MARKER = 'steward: command started';

const MARKER_COMMAND = `printf '%s\\n' '${START_MARKER}' >&2`;

function singleQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** A leading `~` must stay outside the quotes or the shell will not expand it. */
function quoteDirectory(directory: string): string {
  if (directory === '~') return '~';
  if (directory.startsWith('~/')) return `~/${singleQuote(directory.slice(2))}`;
  return singleQuote(directory);
}

/**
 * With a directory the command runs inside a group after `cd`, so a failed `cd`
 * stops everything (a second line of a multi-line command can never run in the
 * wrong place) and the start marker is only printed once the command can run.
 * The directory is quoted; the command is passed as written.
 */
export function composeRemoteCommand(command: string, remoteDir: string | null): string {
  if (remoteDir === null) return `${MARKER_COMMAND}\n${command}`;
  return `cd ${quoteDirectory(remoteDir)} && {\n${MARKER_COMMAND}\n${command}\n}`;
}

/**
 * Deploys by running the target's fixed command on its server. Exit code 0 is the
 * only evidence of success. The result is `failed` only when there is evidence the
 * command did not work or never ran; a timeout, or a connection that ended after the
 * command had started, leaves it `unknown`, because it may still be running or done.
 */
export function createSshRunner(deps: { db: SqlDatabase; ssh: SshService }): DeploymentRunner {
  return {
    prepare: (target) => {
      if (target.kind !== 'ssh_command' || target.sshHostId === null) {
        return Promise.reject(
          new StewardServiceError('TARGET_BROKEN', 'this target has no server to run on', 'Edit it and choose a server.')
        );
      }
      const hostId = target.sshHostId;
      const { command, remoteDir, timeoutSeconds } = target.config;
      const remoteCommand = composeRemoteCommand(command, remoteDir);

      return Promise.resolve({
        ref: null,
        execute: async (context) => {
          context.update({ status: 'in_progress' });

          let outcome;
          try {
            outcome = await deps.ssh.runDeploy({
              hostId,
              command: remoteCommand,
              timeoutSeconds,
              startMarker: START_MARKER,
              onExecutionStarted: (executionId) => {
                linkExecutionToDeploy(deps.db, executionId, context.deployment.environmentId, target.id);
                context.update({ executionId });
              }
            });
          } catch (error) {
            // ssh could not even be started, so nothing ran on the server.
            context.settle({
              status: 'failed',
              notes: error instanceof StewardServiceError ? error.message : 'ssh could not be started'
            });
            return;
          }

          const lostTrack = (): void =>
            context.settle({
              status: 'unknown',
              notes:
                'The connection ended before the command reported how it finished. It may have completed on the server. Check the server.'
            });

          if (outcome.timedOut) {
            context.settle({
              status: 'unknown',
              notes: `The command did not finish within ${timeoutSeconds} s. It may still be running on the server.`
            });
          } else if (outcome.exitCode === 0) {
            context.settle({ status: 'succeeded', source: 'exit_code' });
          } else if (outcome.commandStarted) {
            // 255 is ssh's own failure code and also what a dying connection gives; null is a killed ssh.
            if (outcome.exitCode === null || outcome.exitCode === 255) lostTrack();
            else {
              context.settle({
                status: 'failed',
                source: 'exit_code',
                notes: `The command exited with code ${outcome.exitCode}.`
              });
            }
          } else if (outcome.exitCode === null) {
            lostTrack();
          } else {
            // The command never began: a refused connection, authentication, host key, or a directory that does not exist.
            context.settle({
              status: 'failed',
              source: outcome.failureCode === null ? 'exit_code' : null,
              notes: outcome.failureMessage ?? `The command did not start (exit code ${outcome.exitCode}).`
            });
          }
        }
      });
    }
  };
}
