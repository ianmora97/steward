import { redactSecrets } from './git-errors';

const ESC = String.fromCharCode(27);
// CSI sequences (colours, cursor moves) and any other lone escape. Built from
// a char code so the source holds no control character for the linter to flag.
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const LONE_ESC = new RegExp(ESC, 'g');
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g');

/**
 * Makes a job log safe to show as plain text: no colour codes, no carriage-return
 * progress redraws, no control characters, and no token-shaped strings.
 */
export function cleanLog(text: string): string {
  return redactSecrets(
    text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => {
        const redraw = line.lastIndexOf('\r');
        return redraw === -1 ? line : line.slice(redraw + 1);
      })
      .join('\n')
      .replace(CSI, '')
      .replace(LONE_ESC, '')
      .replace(CONTROL, '')
  );
}
