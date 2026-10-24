/**
 * Shape check for a branch or tag name, following the rules of `git check-ref-format`.
 * It is the gate the renderer-facing schemas use; the remote still has the last
 * word, so a name that passes here can be rejected by GitHub.
 */
export function isValidGitRefName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (name === '@' || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) {
    return false;
  }
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;

  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || '~^:?*[\\'.includes(char)) return false;
  }

  return name.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'));
}
