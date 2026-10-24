/**
 * Quoting for the one place a string is parsed by a shell: the command text sent
 * to a remote host over ssh. Anything that is not a fixed word of Steward's own
 * must pass through here (after its schema has validated it).
 */
export function singleQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** A remote command line built from words, each quoted, so a value can never become syntax. */
export function remoteCommandLine(words: readonly string[]): string {
  return words.map(singleQuote).join(' ');
}
