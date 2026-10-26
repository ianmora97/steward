import { REDIS_CLI_MAX_BYTES, REDIS_CLI_MAX_ELEMENTS } from '@shared/schemas/redis';
import type { RedisReply } from './redis-pool';

/** A bulk string the way redis-cli prints it: quoted, readable text as text, other bytes escaped. */
export function quoteBulk(value: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    let out = '';
    for (const byte of value) {
      out += byte >= 0x20 && byte < 0x7f && byte !== 0x22 && byte !== 0x5c ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, '0')}`;
    }
    return `"${out}"`;
  }
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

export interface FormattedReply {
  output: string;
  truncated: boolean;
}

/** Formats a reply like redis-cli, stopping at the byte and element limits and saying so. */
export function formatReply(reply: RedisReply): FormattedReply {
  const lines: string[] = [];
  let bytes = 0;
  let elements = 0;
  let truncated = false;

  function emit(text: string): boolean {
    if (bytes + text.length > REDIS_CLI_MAX_BYTES || elements >= REDIS_CLI_MAX_ELEMENTS) {
      truncated = true;
      return false;
    }
    bytes += text.length + 1;
    elements += 1;
    lines.push(text);
    return true;
  }

  /** `lead` is everything that precedes the value on its first line: indentation and its numbering. */
  function visit(value: RedisReply, lead: string): boolean {
    if (value === null) return emit(`${lead}(nil)`);
    if (value instanceof Error) return emit(`${lead}(error) ${value.message}`);
    if (typeof value === 'number') return emit(`${lead}(integer) ${value}`);
    if (typeof value === 'string') return emit(`${lead}${value}`);
    if (Buffer.isBuffer(value)) return emit(`${lead}${quoteBulk(value)}`);
    if (value.length === 0) return emit(`${lead}(empty array)`);

    const indent = ' '.repeat(lead.length);
    for (let index = 0; index < value.length; index += 1) {
      const label = `${index + 1}) `;
      if (!visit(value[index] as RedisReply, `${index === 0 ? lead : indent}${label}`)) return false;
    }
    return true;
  }

  visit(reply, '');
  if (truncated) {
    lines.push(`… output truncated at ${REDIS_CLI_MAX_ELEMENTS} elements or ${Math.round(REDIS_CLI_MAX_BYTES / 1024)} KB`);
  }
  return { output: lines.join('\n'), truncated };
}
