import { StewardServiceError } from '@shared/types/result';
import type { RedisReply } from './redis-pool';

/** A server error that arrived inside a reply (as in the middle of a pipeline) is raised like any other. */
export function raise(reply: RedisReply): RedisReply {
  if (reply instanceof Error) throw reply;
  return reply;
}

export function asText(reply: RedisReply | undefined): string {
  if (reply === null || reply === undefined) return '';
  if (reply instanceof Error) throw reply;
  if (Buffer.isBuffer(reply)) return reply.toString('utf8');
  if (typeof reply === 'number') return String(reply);
  if (typeof reply === 'string') return reply;
  throw new StewardServiceError('REDIS_FAILED', 'The server answered in a shape Steward did not expect');
}

export function asBuffer(reply: RedisReply | undefined): Buffer {
  if (reply === null || reply === undefined) return Buffer.alloc(0);
  if (reply instanceof Error) throw reply;
  if (Buffer.isBuffer(reply)) return reply;
  if (typeof reply === 'number') return Buffer.from(String(reply));
  if (typeof reply === 'string') return Buffer.from(reply, 'utf8');
  throw new StewardServiceError('REDIS_FAILED', 'The server answered in a shape Steward did not expect');
}

export function asNumber(reply: RedisReply | undefined): number {
  if (reply === null || reply === undefined) return 0;
  if (reply instanceof Error) throw reply;
  if (typeof reply === 'number') return reply;
  if (Buffer.isBuffer(reply) || typeof reply === 'string') {
    const value = Number(reply.toString());
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

export function asArray(reply: RedisReply | undefined): RedisReply[] {
  if (reply === null || reply === undefined) return [];
  if (reply instanceof Error) throw reply;
  return Array.isArray(reply) ? reply : [];
}

/** `INFO` text → sections → fields. */
export function parseInfo(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = 'default';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      current = line.slice(1).trim().toLowerCase();
      sections[current] ??= {};
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    (sections[current] ??= {})[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return sections;
}

export function infoField(sections: Record<string, Record<string, string>>, section: string, field: string): string | undefined {
  return sections[section]?.[field];
}

/** `key=value,key=value` (the format of `INFO keyspace`). */
export function parseKeyValueList(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of text.split(',')) {
    const separator = part.indexOf('=');
    if (separator > 0) result[part.slice(0, separator)] = part.slice(separator + 1);
  }
  return result;
}

/** Glob characters in a user-supplied text, escaped so SCAN MATCH treats it literally. */
export function escapeGlob(text: string): string {
  return text.replace(/[\\*?[\]]/g, (char) => `\\${char}`);
}
