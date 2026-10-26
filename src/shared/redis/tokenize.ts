/**
 * Splits a console line into Redis arguments the way redis-cli does: spaces separate, double quotes allow the
 * usual escapes (`\n`, `\t`, `\xHH`, `\"`, `\\`), single quotes only allow `\'`. There is no shell here: the
 * result is an array handed to the connected server, never text for an operating system.
 */
export type TokenizeResult = { ok: true; args: string[] } | { ok: false; error: string };

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', a: '\x07' };

function isHex(char: string | undefined): boolean {
  return char !== undefined && /^[0-9a-fA-F]$/.test(char);
}

export function tokenizeCommand(line: string): TokenizeResult {
  const args: string[] = [];
  let index = 0;
  const length = line.length;

  while (index < length) {
    while (index < length && /\s/.test(line.charAt(index))) index += 1;
    if (index >= length) break;

    let current = '';
    let inDouble = false;
    let inSingle = false;
    let done = false;

    while (!done) {
      const char = index < length ? line.charAt(index) : null;
      if (inDouble) {
        if (char === null) return { ok: false, error: 'unbalanced double quotes' };
        if (char === '\\' && index + 1 < length) {
          const next = line.charAt(index + 1);
          if (next === 'x' && isHex(line[index + 2]) && isHex(line[index + 3])) {
            current += String.fromCharCode(Number.parseInt(line.slice(index + 2, index + 4), 16));
            index += 4;
          } else {
            current += SIMPLE_ESCAPES[next] ?? next;
            index += 2;
          }
        } else if (char === '"') {
          const after = index + 1 < length ? line.charAt(index + 1) : null;
          if (after !== null && !/\s/.test(after)) return { ok: false, error: 'a closing quote must be followed by a space' };
          done = true;
          index += 1;
        } else {
          current += char;
          index += 1;
        }
      } else if (inSingle) {
        if (char === null) return { ok: false, error: 'unbalanced single quotes' };
        if (char === '\\' && line.charAt(index + 1) === "'") {
          current += "'";
          index += 2;
        } else if (char === "'") {
          const after = index + 1 < length ? line.charAt(index + 1) : null;
          if (after !== null && !/\s/.test(after)) return { ok: false, error: 'a closing quote must be followed by a space' };
          done = true;
          index += 1;
        } else {
          current += char;
          index += 1;
        }
      } else if (char === null || /\s/.test(char)) {
        done = true;
      } else if (char === '"') {
        inDouble = true;
        index += 1;
      } else if (char === "'") {
        inSingle = true;
        index += 1;
      } else {
        current += char;
        index += 1;
      }
    }
    args.push(current);
  }

  return { ok: true, args };
}
