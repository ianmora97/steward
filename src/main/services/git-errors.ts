import type { StewardErrorCode } from '@shared/types/result';

/**
 * Turns Git's failure text into a code the UI can act on.
 *
 * Git's messages are the only signal for most of these, so the patterns are
 * kept in one place and covered by tests. Locale is forced to C when Git is
 * spawned (see git-exec.ts), which is what makes matching English text sound.
 */
export interface ClassifiedFailure {
  code: StewardErrorCode;
  message: string;
  hint?: string;
}

const MAX_DETAIL_CHARS = 2000;

/** Removes credentials embedded in URLs and caps length. Output reaches the renderer and the database. */
export function redact(text: string): string {
  return redactSecrets(text).slice(0, MAX_DETAIL_CHARS).trim();
}

/** Same masking without the cap or trim, for streams where whitespace and length must survive. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***')
    .replace(/(authorization:\s*)\S+(\s+\S+)?/gi, '$1***');
}

export function classifyGitFailure(stdout: string, stderr: string): ClassifiedFailure {
  const text = `${stderr}\n${stdout}`;

  if (/CONFLICT \(|Automatic merge failed|fix conflicts and then commit/i.test(text)) {
    return {
      code: 'GIT_MERGE_CONFLICT',
      message: 'The merge stopped because of conflicts',
      hint: 'Resolve the conflicted files, stage them and commit, or abort the merge to go back to where you were.'
    };
  }
  if (/non-fast-forward|\(fetch first\)|Updates were rejected because the (tip|remote contains)/i.test(text)) {
    return {
      code: 'GIT_NON_FAST_FORWARD',
      message: 'The remote has commits you do not have, so the push was rejected',
      hint: 'Pull first to bring those commits in, then push again. Steward never force-pushes.'
    };
  }
  if (/no tracking information|has no upstream branch|no upstream configured/i.test(text)) {
    return {
      code: 'GIT_NO_REMOTE',
      message: 'This branch has no upstream',
      hint: 'Push it once to set an upstream.'
    };
  }
  if (/already exists/i.test(text)) {
    return { code: 'CONFLICT', message: 'A branch with that name already exists' };
  }
  if (/Not possible to fast-forward|have diverged|Diverging branches/i.test(text)) {
    return {
      code: 'GIT_DIVERGED',
      message: 'Your branch and its upstream have diverged, so a fast-forward pull is not possible',
      hint: 'Pull with merge to combine them, which may produce conflicts to resolve.'
    };
  }
  if (
    /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \((publickey|password)|HTTP 40[13]|returned error: 40[13]|Invalid username or (password|token)/i.test(
      text
    )
  ) {
    return {
      code: 'GIT_AUTH_FAILED',
      message: 'The remote rejected your credentials',
      hint: 'Sign in with your Git credential helper or SSH agent in a terminal, then retry. Steward does not prompt for or store Git passwords.'
    };
  }
  if (/Repository not found|does not appear to be a git repository|HTTP 404|returned error: 404/i.test(text)) {
    return {
      code: 'GIT_REMOTE_NOT_FOUND',
      message: 'The remote repository was not found',
      hint: 'Check the remote URL, and that your account can access the repository.'
    };
  }
  if (
    /Could not resolve host|unable to access|Connection (timed out|refused|reset)|Network is unreachable|Failed to connect|Operation timed out|early EOF|Could not read from remote/i.test(
      text
    )
  ) {
    return {
      code: 'GIT_NETWORK_FAILED',
      message: 'Steward could not reach the remote',
      hint: 'Check your network connection and the remote URL, then retry.'
    };
  }
  if (/not fully merged/i.test(text)) {
    return {
      code: 'GIT_UNMERGED_BRANCH',
      message: 'That branch has commits that are not merged anywhere else',
      hint: 'Deleting it would lose those commits. Force delete only if you are sure.'
    };
  }
  if (/would be overwritten by (checkout|merge)|Please commit your changes or stash them|local changes/i.test(text)) {
    return {
      code: 'GIT_LOCAL_CHANGES',
      message: 'Uncommitted changes would be overwritten',
      hint: 'Commit or discard the conflicting changes first.'
    };
  }
  if (/Please tell me who you are|Author identity unknown|unable to auto-detect email address/i.test(text)) {
    return {
      code: 'GIT_IDENTITY_MISSING',
      message: 'Git does not know who you are',
      hint: 'Set user.name and user.email with `git config --global user.name "…"` and `git config --global user.email "…"`.'
    };
  }
  if (/nothing to commit|no changes added to commit/i.test(text)) {
    return { code: 'GIT_NOTHING_TO_COMMIT', message: 'There is nothing staged to commit' };
  }
  if (/not a valid branch name|is not a valid ref|invalid reference|not a valid object name|unknown revision/i.test(text)) {
    return { code: 'GIT_INVALID_REF', message: 'That is not a valid branch or reference name' };
  }
  if (/not a git repository/i.test(text)) {
    return {
      code: 'NOT_A_GIT_REPOSITORY',
      message: 'That folder is no longer a Git repository',
      hint: 'The folder may have been moved or its .git directory removed.'
    };
  }

  return { code: 'GIT_FAILED', message: 'Git reported an error' };
}
