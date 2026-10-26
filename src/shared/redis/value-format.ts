/**
 * Turns a value that arrived as base64 into what the user asked to see. Pure, so the page can use it
 * directly: nothing here touches Node.
 */
export type ValueFormat = 'text' | 'json' | 'hex' | 'base64' | 'binary';

export function decodeBase64(encoded: string): Uint8Array {
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let raw = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    raw += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(raw);
}

/** Text → base64 as UTF-8, the way the editors send what the user typed. */
export function encodeTextBase64(text: string): string {
  return encodeBase64(new TextEncoder().encode(text));
}

/** The bytes as UTF-8 text, or null when they are not valid UTF-8 (binary). */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function toHex(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.subarray(offset, offset + 16);
    const hex = [...slice].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...slice].map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`);
  }
  return lines.join('\n');
}

export function isBinary(bytes: Uint8Array): boolean {
  return decodeUtf8(bytes) === null;
}

/** JSON with indentation, or null when it does not parse. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return null;
  }
}

/** The best default for a value: JSON when it parses, hex when it is binary, plain text otherwise. */
export function detectFormat(bytes: Uint8Array): ValueFormat {
  const text = decodeUtf8(bytes);
  if (text === null) return 'binary';
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && prettyJson(trimmed) !== null) return 'json';
  return 'text';
}

export function formatValue(bytes: Uint8Array, format: ValueFormat): string {
  switch (format) {
    case 'hex':
    case 'binary':
      return toHex(bytes);
    case 'base64':
      return encodeBase64(bytes);
    case 'json': {
      const text = decodeUtf8(bytes);
      if (text === null) return toHex(bytes);
      return prettyJson(text) ?? text;
    }
    case 'text':
      return decodeUtf8(bytes) ?? toHex(bytes);
  }
}

/** Short single-line preview of a base64 value, for lists and tables. */
export function previewValue(encoded: string, max = 120): string {
  const bytes = decodeBase64(encoded);
  const text = decodeUtf8(bytes);
  if (text === null) return `‹binary, ${bytes.length} bytes›`;
  const single = text.replace(/\s+/g, ' ');
  return single.length > max ? `${single.slice(0, max)}…` : single;
}
