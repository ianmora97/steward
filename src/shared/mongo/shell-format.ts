/**
 * Documents cross the process boundary as canonical Extended JSON: every BSON type is a tagged object
 * (`{"$oid": …}`, `{"$numberLong": …}`), so nothing is lost on the way, unlike `structuredClone`. This module
 * turns that into what a person reads and edits: shell syntax (`ObjectId("…")`, `ISODate("…")`,
 * `NumberLong("…")`). The text it produces is what main's parser accepts back, so a document edited here keeps
 * the types of the fields that were not touched.
 *
 * It is pure and has no dependency on `bson`, so the renderer can use it.
 */

export type ScalarType =
  | 'string'
  | 'int32'
  | 'int64'
  | 'double'
  | 'decimal'
  | 'boolean'
  | 'null'
  | 'objectid'
  | 'date'
  | 'binary'
  | 'uuid'
  | 'regex'
  | 'timestamp'
  | 'minkey'
  | 'maxkey'
  | 'undefined'
  | 'code'
  | 'symbol';

export type DisplayNode =
  | { kind: 'object'; entries: [string, DisplayNode][] }
  | { kind: 'array'; items: DisplayNode[] }
  | { kind: 'scalar'; type: ScalarType; text: string };

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalar(type: ScalarType, text: string): DisplayNode {
  return { kind: 'scalar', type, text };
}

function uuidFromBase64(base64: string): string | null {
  try {
    const raw = atob(base64);
    if (raw.length !== 16) return null;
    const hex = Array.from(raw, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

function dateText(milliseconds: number): string {
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? `ISODate("invalid")` : `ISODate("${date.toISOString()}")`;
}

/** A tagged object like `{"$oid": "…"}` becomes a scalar; anything else is not a BSON wrapper. */
function wrapper(value: Json): DisplayNode | null {
  const keys = Object.keys(value);
  const only = keys.length === 1 ? keys[0] : undefined;

  switch (only) {
    case '$oid':
      return typeof value['$oid'] === 'string' ? scalar('objectid', `ObjectId("${value['$oid']}")`) : null;
    case '$numberInt':
      return scalar('int32', String(value['$numberInt']));
    case '$numberLong':
      return scalar('int64', `NumberLong("${String(value['$numberLong'])}")`);
    case '$numberDecimal':
      return scalar('decimal', `Decimal128("${String(value['$numberDecimal'])}")`);
    case '$numberDouble': {
      const text = String(value['$numberDouble']);
      // 3.0 would read back as the integer 3, so a whole-number double is written Double(3).
      if (/^-?\d+\.0$/.test(text)) return scalar('double', `Double(${text.slice(0, -2)})`);
      if (text === 'Infinity' || text === '-Infinity' || text === 'NaN') return scalar('double', text);
      return scalar('double', text);
    }
    case '$date': {
      const inner = value['$date'];
      if (typeof inner === 'string') {
        const parsed = Date.parse(inner);
        return scalar('date', Number.isNaN(parsed) ? `ISODate("${inner}")` : dateText(parsed));
      }
      if (isRecord(inner) && typeof inner['$numberLong'] === 'string') return scalar('date', dateText(Number(inner['$numberLong'])));
      if (typeof inner === 'number') return scalar('date', dateText(inner));
      return null;
    }
    case '$binary': {
      const inner = value['$binary'];
      if (!isRecord(inner) || typeof inner['base64'] !== 'string') return null;
      const subType = typeof inner['subType'] === 'string' ? inner['subType'] : '00';
      if (subType === '04') {
        const uuid = uuidFromBase64(inner['base64']);
        if (uuid !== null) return scalar('uuid', `UUID("${uuid}")`);
      }
      return scalar('binary', `BinData(${Number.parseInt(subType, 16) || 0}, "${inner['base64']}")`);
    }
    case '$regularExpression': {
      const inner = value['$regularExpression'];
      if (!isRecord(inner) || typeof inner['pattern'] !== 'string') return null;
      const options = typeof inner['options'] === 'string' ? inner['options'] : '';
      return scalar('regex', `/${inner['pattern']}/${options}`);
    }
    case '$timestamp': {
      const inner = value['$timestamp'];
      if (!isRecord(inner)) return null;
      return scalar('timestamp', `Timestamp(${String(inner['t'])}, ${String(inner['i'])})`);
    }
    case '$minKey':
      return scalar('minkey', 'MinKey()');
    case '$maxKey':
      return scalar('maxkey', 'MaxKey()');
    case '$undefined':
      return scalar('undefined', 'undefined');
    case '$symbol':
      return scalar('symbol', JSON.stringify(String(value['$symbol'])));
    case '$code':
      return scalar('code', `Code(${JSON.stringify(String(value['$code']))})`);
    default:
      return null;
  }
}

export function toDisplayNode(value: unknown): DisplayNode {
  if (value === null || value === undefined) return scalar('null', 'null');
  if (typeof value === 'string') return scalar('string', JSON.stringify(value));
  if (typeof value === 'boolean') return scalar('boolean', String(value));
  if (typeof value === 'number') return scalar(Number.isInteger(value) ? 'int32' : 'double', String(value));
  if (Array.isArray(value)) return { kind: 'array', items: value.map(toDisplayNode) };
  if (isRecord(value)) {
    const wrapped = wrapper(value);
    if (wrapped !== null) return wrapped;
    return { kind: 'object', entries: Object.entries(value).map(([key, inner]) => [key, toDisplayNode(inner)]) };
  }
  return scalar('string', JSON.stringify(String(value)));
}

/** The document as shell-syntax text, indented. This is what the editor shows and what main parses back. */
export function formatNode(node: DisplayNode, indent = 2, level = 0): string {
  if (node.kind === 'scalar') return node.text;
  const pad = ' '.repeat(indent * (level + 1));
  const close = ' '.repeat(indent * level);
  if (node.kind === 'array') {
    if (node.items.length === 0) return '[]';
    return `[\n${node.items.map((item) => `${pad}${formatNode(item, indent, level + 1)}`).join(',\n')}\n${close}]`;
  }
  if (node.entries.length === 0) return '{}';
  return `{\n${node.entries
    .map(([key, inner]) => `${pad}${JSON.stringify(key)}: ${formatNode(inner, indent, level + 1)}`)
    .join(',\n')}\n${close}}`;
}

/** One line, shortened: for table cells and list previews. */
export function formatCompact(node: DisplayNode, max = 80): string {
  let text: string;
  if (node.kind === 'scalar') text = node.text;
  else if (node.kind === 'array') text = `[ ${node.items.length} item${node.items.length === 1 ? '' : 's'} ]`;
  else text = `{ ${node.entries.length} field${node.entries.length === 1 ? '' : 's'} }`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function parseDocumentJson(json: string): unknown {
  return JSON.parse(json) as unknown;
}

/** A canonical-EJSON document as editable shell text. */
export function documentToShellText(json: string): string {
  return formatNode(toDisplayNode(parseDocumentJson(json)));
}

/** The `_id` of a document, as shell text for display. */
export function documentIdText(json: string): string {
  const value = parseDocumentJson(json);
  if (!isRecord(value) || !('_id' in value)) return '—';
  return formatCompact(toDisplayNode(value['_id']), 60);
}

/** The `_id` exactly as the server sent it, ready to send back for an edit or a delete. */
export function documentIdEjson(json: string): string | null {
  const value = parseDocumentJson(json);
  if (!isRecord(value) || !('_id' in value)) return null;
  return JSON.stringify(value['_id']);
}

/** Top-level field names across some documents, in first-seen order: the columns of the table view. */
export function columnsOf(documents: readonly string[], limit = 200): string[] {
  const seen = new Set<string>();
  for (const json of documents.slice(0, limit)) {
    const value = parseDocumentJson(json);
    if (isRecord(value)) for (const key of Object.keys(value)) seen.add(key);
  }
  return [...seen];
}
