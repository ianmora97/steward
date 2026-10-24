import type { Document } from 'bson';
import { formatCompact, toDisplayNode } from '@shared/mongo/shell-format';
import type { MongoSchemaField } from '@shared/schemas/mongodb';
import { toEjson } from './mongo-ejson';

const MAX_FIELDS = 500;
const SAMPLES_PER_FIELD = 3;

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date) && !('_bsontype' in value);
}

/** The BSON type of a value as the driver hands it over. Int32 and Double are both plain numbers there. */
function typeOf(value: unknown): string {
  if (value === null) return 'Null';
  if (value === undefined) return 'Undefined';
  if (Array.isArray(value)) return 'Array';
  if (value instanceof Date) return 'Date';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'boolean') return 'Boolean';
  if (typeof value === 'number') return 'Number';
  if (typeof value === 'bigint') return 'Int64';
  if (typeof value === 'object' && '_bsontype' in value) {
    const tag = String((value as { _bsontype: unknown })._bsontype);
    if (tag === 'Long') return 'Int64';
    if (tag === 'BSONRegExp') return 'Regex';
    return tag;
  }
  return 'Object';
}

interface FieldStats {
  docs: number;
  occurrences: number;
  types: Map<string, number>;
  samples: string[];
}

function sampleText(value: unknown): string {
  try {
    const wrapped = JSON.parse(toEjson({ v: value })) as { v: unknown };
    return formatCompact(toDisplayNode(wrapped.v), 40);
  } catch {
    return '…';
  }
}

/**
 * What a sample of documents looks like: for every field path (arrays shown as `tags[]`), how many documents
 * have it, which types it takes and a few example values. It describes the sample, not the whole collection.
 */
export function analyzeSchema(documents: readonly Document[]): MongoSchemaField[] {
  const stats = new Map<string, FieldStats>();

  for (const document of documents) {
    const seenInDocument = new Set<string>();

    const visit = (path: string, value: unknown): void => {
      if (!stats.has(path) && stats.size >= MAX_FIELDS) return;
      let entry = stats.get(path);
      if (entry === undefined) {
        entry = { docs: 0, occurrences: 0, types: new Map(), samples: [] };
        stats.set(path, entry);
      }
      if (!seenInDocument.has(path)) {
        seenInDocument.add(path);
        entry.docs += 1;
      }
      entry.occurrences += 1;
      const type = typeOf(value);
      entry.types.set(type, (entry.types.get(type) ?? 0) + 1);
      if (entry.samples.length < SAMPLES_PER_FIELD && type !== 'Object' && type !== 'Array') {
        const text = sampleText(value);
        if (!entry.samples.includes(text)) entry.samples.push(text);
      }

      if (Array.isArray(value)) {
        for (const item of value) visit(`${path}[]`, item);
      } else if (isPlain(value)) {
        for (const [key, inner] of Object.entries(value)) visit(`${path}.${key}`, inner);
      }
    };

    for (const [key, value] of Object.entries(document)) visit(key, value);
  }

  const total = documents.length === 0 ? 1 : documents.length;
  return [...stats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, entry]) => ({
      path,
      presentPercent: Math.round((entry.docs / total) * 1000) / 10,
      types: [...entry.types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, percent: Math.round((count / entry.occurrences) * 1000) / 10 })),
      samples: entry.samples
    }));
}
