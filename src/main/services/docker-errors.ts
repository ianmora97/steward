import type { DockerState } from '@shared/schemas/docker';
import type { StewardErrorCode } from '@shared/types/result';
import { redactSecrets } from './git-errors';

export interface ClassifiedDockerFailure {
  code: StewardErrorCode;
  state: DockerState;
  message: string;
  hint: string | null;
}

const MAX_MESSAGE = 300;

/** The first useful line of stderr, redacted and capped: enough to act on, never a wall of output. */
function firstLine(stderr: string): string {
  const line =
    redactSecrets(stderr)
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate !== '') ?? '';
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE)}…` : line;
}

/**
 * Turns the stderr of a failed `docker` run into one of the outcomes the page
 * tells apart. Docker's wording is English unless localized; the patterns cover
 * the Linux socket, the Windows named pipe and a missing remote binary.
 */
export function classifyDockerFailure(stderr: string): ClassifiedDockerFailure {
  if (/permission denied.*(docker\.sock|docker API)|Got permission denied while trying to connect/i.test(stderr)) {
    return {
      code: 'DOCKER_PERMISSION',
      state: 'permission_denied',
      message: 'This user cannot talk to the Docker daemon',
      hint: 'Add the user to the `docker` group (then sign in again), or use an account that can run `docker ps`.'
    };
  }
  if (
    /Cannot connect to the Docker daemon|error during connect|daemon is not running|failed to connect to the docker api|docker_engine.*(cannot find|not found)|Is the docker daemon running/i.test(
      stderr
    )
  ) {
    return {
      code: 'DOCKER_DAEMON_DOWN',
      state: 'daemon_down',
      message: 'The Docker daemon is not running',
      hint: 'Start Docker Desktop (or `sudo systemctl start docker` on a server) and refresh.'
    };
  }
  if (/docker: (command )?not found|docker.*is not recognized|executable file not found|docker: No such file/i.test(stderr)) {
    return {
      code: 'DOCKER_NOT_FOUND',
      state: 'not_installed',
      message: 'Docker is not installed here',
      hint: 'Install Docker, and make sure `docker` is on the PATH of a non-interactive shell.'
    };
  }
  if (/No such (container|image|volume|network|object)|not found: manifest unknown/i.test(stderr)) {
    return { code: 'NOT_FOUND', state: 'error', message: firstLine(stderr), hint: null };
  }
  return { code: 'DOCKER_FAILED', state: 'error', message: firstLine(stderr) || 'docker reported an error', hint: null };
}
