import { EJSON, type Document } from 'bson';
import { parse as parseShellBson, ParseMode } from '@mongodb-js/shell-bson-parser';
import {
  MONGO_DOC_MAX_BYTES,
  type MongoDocument
} from '@shared/schemas/mongodb';
import { StewardServiceError } from '@shared/types/result';

/**
 * Text typed by the user (a filter, a document, a pipeline) is shell syntax: `{ age: { $gt: 5 } }`,
 * `ObjectId("…")`, `ISODate("…")`. It is parsed, never evaluated: the parser reads the syntax tree and
 * builds BSON values, and anything that is not data (a function call it does not know, `process`, a loop)
 * is refused. That is the difference between a query box and a remote-code box.
 */
function parseShell(text: string, what: string): unknown {
  try {
    return parseShellBson(text, { mode: ParseMode.Loose });
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : 'syntax error';
    throw new StewardServiceError('MONGO_QUERY_INVALID', `${what} is not valid`, reason);
  }
}

function isPlainObject(value: unknown): value is Document {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Empty text means "no condition" and yields `{}`. */
export function parseObjectText(text: string, what: string, allowEmpty = true): Document {
  if (text.trim() === '') {
    if (allowEmpty) return {};
    throw new StewardServiceError('MONGO_QUERY_INVALID', `${what} is empty`);
  }
  const value = parseShell(text, what);
  if (!isPlainObject(value)) throw new StewardServiceError('MONGO_QUERY_INVALID', `${what} must be an object like { field: value }`);
  return value;
}

export function parseArrayText(text: string, what: string): Document[] {
  const value = parseShell(text, what);
  if (!Array.isArray(value) || !value.every(isPlainObject)) {
    throw new StewardServiceError('MONGO_QUERY_INVALID', `${what} must be a list of objects like [ { … }, { … } ]`);
  }
  return value;
}

/** One document or a list of them. */
export function parseDocumentsText(text: string, what: string): Document[] {
  const value = parseShell(text, what);
  if (isPlainObject(value)) return [value];
  if (Array.isArray(value) && value.length > 0 && value.every(isPlainObject)) return value;
  throw new StewardServiceError('MONGO_QUERY_INVALID', `${what} must be a document or a list of documents`);
}

/** Canonical Extended JSON: every BSON type tagged, so it survives the trip to the renderer and back. */
export function toEjson(value: unknown): string {
  return EJSON.stringify(value as Document, { relaxed: false });
}

export function fromEjson(text: string, what: string): unknown {
  try {
    return EJSON.parse(text, { relaxed: false }) as unknown;
  } catch {
    throw new StewardServiceError('VALIDATION_FAILED', `${what} could not be read`);
  }
}

export function toMongoDocument(document: Document): MongoDocument {
  const json = toEjson(document);
  const sizeBytes = Buffer.byteLength(json);
  if (sizeBytes <= MONGO_DOC_MAX_BYTES) return { json, tooLarge: false, sizeBytes };
  // Too big to ship to the screen: only the id goes, and the page will not offer to edit it.
  const id = (document as { _id?: unknown })['_id'];
  return { json: toEjson({ _id: id }), tooLarge: true, sizeBytes };
}
