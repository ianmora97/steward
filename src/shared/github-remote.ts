export interface GithubRepoRef {
  owner: string;
  name: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const SCP_FORM = /^[A-Za-z0-9_.-]+@github\.com:([^/]+)\/([^/]+?)\/?$/i;

function toRef(owner: string | undefined, name: string | undefined): GithubRepoRef | null {
  if (owner === undefined || name === undefined) return null;
  const repo = name.endsWith('.git') ? name.slice(0, -4) : name;
  for (const segment of [owner, repo]) {
    if (!SEGMENT.test(segment) || segment === '.' || segment === '..') return null;
  }
  return { owner, name: repo };
}

/**
 * Reads owner/name out of a stored remote URL. Only the exact host `github.com`
 * qualifies: the host comes from `URL` parsing, so `github.com.evil.io` and
 * `https://github.com@evil.io/…` are rejected. Credentials embedded in the URL
 * are ignored and never returned.
 */
export function parseGithubRemote(url: string | null): GithubRepoRef | null {
  if (url === null) return null;
  const text = url.trim();

  const scp = SCP_FORM.exec(text);
  if (scp !== null) return toRef(scp[1], scp[2]);

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') return null;
  if (parsed.hostname.toLowerCase() !== 'github.com') return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 2) return null;
  return toRef(segments[0], segments[1]);
}
