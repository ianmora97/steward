import type { SshConnectionState } from '@shared/schemas/ssh';
import type { StewardErrorCode } from '@shared/types/result';

export interface ClassifiedSshFailure {
  code: StewardErrorCode;
  state: SshConnectionState;
  message: string;
  hint?: string;
}

/**
 * Turns an ssh failure into one of the distinct outcomes the UI tells apart.
 * Only meaningful when ssh itself failed (exit code 255): a remote command's own
 * stderr must never be read as a connection problem. Locale is not forced, so
 * the patterns cover OpenSSH's English text, which it uses unless localized.
 */
export function classifySshFailure(stderr: string, timedOut: boolean): ClassifiedSshFailure {
  if (timedOut) {
    return {
      code: 'SSH_TIMEOUT',
      state: 'timeout',
      message: 'The connection timed out',
      hint: 'The host did not answer in time. Check that it is up and reachable, or raise the timeout for slow commands.'
    };
  }
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Offending .* key/i.test(stderr)) {
    return {
      code: 'SSH_HOST_KEY_CHANGED',
      state: 'host_key_changed',
      message: "The host's key is different from the one you trusted",
      hint: 'This can mean the server was reinstalled, or that someone is intercepting the connection. Steward will not connect until you remove the old key.'
    };
  }
  if (/Host key verification failed|No .* host key is known|host key.*not (known|trusted)/i.test(stderr)) {
    return {
      code: 'SSH_HOST_KEY_UNKNOWN',
      state: 'host_key_unknown',
      message: 'This host has not been trusted yet',
      hint: 'Review its fingerprint and decide whether to trust it.'
    };
  }
  if (/UNPROTECTED PRIVATE KEY FILE|bad permissions|Permissions .* are too open/i.test(stderr)) {
    return {
      code: 'SSH_FAILED',
      state: 'error',
      message: 'ssh refuses to use that key file because other users can read it',
      hint: 'Restrict the key file to your user. On Windows: right-click it → Properties → Security → Advanced, disable inheritance and keep only your account.'
    };
  }
  if (/Load key .*(invalid format|No such file|Permission denied)|Identity file .* not accessible/i.test(stderr)) {
    return {
      code: 'SSH_FAILED',
      state: 'error',
      message: 'ssh could not read the key file',
      hint: 'Check that the file still exists and is an OpenSSH or PEM private key.'
    };
  }
  if (/Permission denied|Too many authentication failures|no supported authentication methods/i.test(stderr)) {
    return {
      code: 'SSH_AUTH_FAILED',
      state: 'auth_failed',
      message: 'The host rejected your credentials',
      hint: 'Steward connects without prompts: load your key into ssh-agent or ~/.ssh/config, or open a shell to sign in with a password.'
    };
  }
  if (
    /Could not resolve hostname|Name or service not known|Connection refused|No route to host|Network is unreachable|Connection timed out|Operation timed out|Connection (closed|reset)|Unable to negotiate|kex_exchange_identification|Bad port/i.test(
      stderr
    )
  ) {
    return {
      code: 'SSH_UNREACHABLE',
      state: 'unreachable',
      message: 'Steward could not reach the host',
      hint: 'Check the host name and port, your network or VPN, and that the SSH server is running.'
    };
  }
  return { code: 'SSH_FAILED', state: 'error', message: 'ssh reported an error' };
}
