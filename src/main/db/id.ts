import { randomBytes } from 'node:crypto';

/**
 * UUID v7: 48-bit big-endian millisecond timestamp, then randomness.
 * Ids therefore sort by creation time, which keeps primary-key indexes compact
 * and makes `ORDER BY id` a usable fallback ordering.
 *
 * Generated in the main process only; the renderer never invents ids.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function nowIso(): string {
  return new Date().toISOString();
}
