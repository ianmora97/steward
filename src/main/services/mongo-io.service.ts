import { createReadStream, createWriteStream, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { EJSON, type Document } from 'bson';
import { toDisplayNode } from '@shared/mongo/shell-format';
import type {
  MongoExportFormat,
  MongoExportInput,
  MongoExportResult,
  MongoImportInput,
  MongoImportResult,
  MongoPickedFile,
  MongoPickFileInput
} from '@shared/schemas/mongodb';
import { StewardServiceError } from '@shared/types/result';
import { uuidv7 } from '../db/id';
import { validateExistingFile } from '../security/paths';
import { fromEjson, parseObjectText, toEjson } from './mongo-ejson';
import type { MongoDataService } from './mongo-data.service';
import { translateMongoError } from './mongo-errors';

const IMPORT_MAX_BYTES = 200 * 1024 * 1024;
const IMPORT_BATCH = 1000;
const EXPORT_HEADER_SAMPLE = 100;
const PENDING_FILES_MAX = 20;

/** The native dialogs, supplied by the Electron layer so this module stays free of Electron. */
export interface MongoDialogs {
  pickFile: (purpose: MongoPickFileInput['purpose']) => Promise<string | null>;
  chooseSavePath: (defaultName: string, label: string, extensions: string[]) => Promise<string | null>;
}

export interface MongoIoDeps {
  data: MongoDataService;
  dialogs: MongoDialogs;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvEscape(text: string): string {
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A value as one CSV cell: plain text for scalars, canonical JSON for anything nested. */
function csvCell(value: unknown): string {
  if (value === undefined) return '';
  const canonical = JSON.parse(toEjson({ v: value })) as { v: unknown };
  const node = toDisplayNode(canonical.v);
  if (node.kind !== 'scalar') return csvEscape(JSON.stringify(canonical.v));
  switch (node.type) {
    case 'string':
      return csvEscape(JSON.parse(node.text) as string);
    case 'objectid':
    case 'date':
    case 'uuid':
      return csvEscape(node.text.slice(node.text.indexOf('"') + 1, node.text.lastIndexOf('"')));
    case 'null':
      return '';
    default:
      return csvEscape(node.text);
  }
}

/** Reads RFC 4180 text into rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** CSV has no types: numbers, booleans and ISO dates are recognised, everything else stays text. */
function inferCell(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) return new Date(value);
  return value;
}

function csvToDocuments(text: string): Document[] {
  const [header, ...rows] = parseCsv(text);
  if (header === undefined) return [];
  return rows.map((row) => {
    const document: Document = {};
    header.forEach((column, index) => {
      const cell = row[index];
      if (column !== '' && cell !== undefined && cell !== '') document[column] = inferCell(cell);
    });
    return document;
  });
}

// ── service ──────────────────────────────────────────────────────────────────

export function createMongoIoService(deps: MongoIoDeps) {
  const { data, dialogs } = deps;
  // An import file is chosen in one call and read in another; the renderer only ever holds this token.
  const pendingFiles = new Map<string, { path: string; name: string }>();

  async function pickFile(input: MongoPickFileInput): Promise<MongoPickedFile> {
    const chosen = await dialogs.pickFile(input.purpose);
    if (chosen === null) return { cancelled: true, value: null, fileName: null };
    const path = validateExistingFile(chosen).path;
    if (input.purpose !== 'import') return { cancelled: false, value: path, fileName: basename(path) };

    if (pendingFiles.size >= PENDING_FILES_MAX) {
      const oldest = pendingFiles.keys().next().value;
      if (oldest !== undefined) pendingFiles.delete(oldest);
    }
    const token = uuidv7();
    pendingFiles.set(token, { path, name: basename(path) });
    return { cancelled: false, value: token, fileName: basename(path) };
  }

  // ── export ─────────────────────────────────────────────────────────────────

  const EXTENSIONS: Record<MongoExportFormat, { ext: string; label: string }> = {
    json: { ext: 'json', label: 'JSON (Extended JSON array)' },
    ndjson: { ext: 'ndjson', label: 'JSON Lines (one document per line)' },
    csv: { ext: 'csv', label: 'CSV' }
  };

  async function exportQuery(input: MongoExportInput): Promise<MongoExportResult> {
    const { client, record } = await data.connect(input.connectionId);
    const filter = parseObjectText(input.filter, 'The filter');
    const projection = input.project?.trim() ? parseObjectText(input.project, 'The projection') : undefined;
    const sort = input.sort?.trim() ? parseObjectText(input.sort, 'The sort') : undefined;

    const target = EXTENSIONS[input.format];
    const path = await dialogs.chooseSavePath(`${input.collection}.${target.ext}`, target.label, [target.ext]);
    if (path === null) return { cancelled: true, path: null, count: 0 };

    const out = createWriteStream(path, { encoding: 'utf8' });
    const write = async (text: string): Promise<void> => {
      if (!out.write(text)) await once(out, 'drain');
    };

    let count = 0;
    try {
      await data.guard(record, async () => {
        const cursor = data.collectionOf(client, input).find(filter, {
          ...(projection === undefined ? {} : { projection }),
          ...(sort === undefined ? {} : { sort }),
          ...(input.maxTimeMS === undefined ? {} : { maxTimeMS: input.maxTimeMS }),
          promoteValues: false
        });
        try {
          if (input.format === 'json') await write('[\n');
          let columns: string[] | null = null;
          const head: Document[] = [];

          const emit = async (document: Document): Promise<void> => {
            if (input.format === 'json') await write(`${count === 0 ? '' : ',\n'}${toEjson(document)}`);
            else if (input.format === 'ndjson') await write(`${toEjson(document)}\n`);
            else await write(`${(columns ?? []).map((column) => csvCell(document[column])).join(',')}\n`);
            count += 1;
          };

          for await (const document of cursor) {
            if (input.format === 'csv' && columns === null) {
              // The header comes from the first documents; fields that first appear later are not exported.
              head.push(document);
              if (head.length < EXPORT_HEADER_SAMPLE) continue;
              columns = [...new Set(head.flatMap((item) => Object.keys(item)))];
              await write(`${columns.map(csvEscape).join(',')}\n`);
              for (const item of head) await emit(item);
              continue;
            }
            await emit(document);
          }
          if (input.format === 'csv' && columns === null) {
            columns = [...new Set(head.flatMap((item) => Object.keys(item)))];
            await write(`${columns.map(csvEscape).join(',')}\n`);
            for (const item of head) await emit(item);
          }
          if (input.format === 'json') await write('\n]\n');
        } finally {
          await cursor.close().catch(() => undefined);
        }
      });
    } finally {
      out.end();
      await once(out, 'close').catch(() => undefined);
    }
    return { cancelled: false, path, count };
  }

  // ── import ─────────────────────────────────────────────────────────────────

  async function* readDocuments(path: string, format: MongoExportFormat): AsyncGenerator<{ document?: Document; error?: string }> {
    if (format === 'ndjson') {
      const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
      let number = 0;
      for await (const line of lines) {
        number += 1;
        if (line.trim() === '') continue;
        try {
          yield { document: fromEjson(line, `line ${number}`) as Document };
        } catch {
          yield { error: `line ${number} is not valid JSON` };
        }
      }
      return;
    }
    const text = readFileSync(path, 'utf8');
    if (format === 'csv') {
      for (const document of csvToDocuments(text)) yield { document };
      return;
    }
    let parsed: unknown;
    try {
      parsed = EJSON.parse(text, { relaxed: false });
    } catch {
      yield { error: 'the file is not valid JSON' };
      return;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) yield { document: item as Document };
      else yield { error: 'an item of the file is not a document' };
    }
  }

  async function importFile(input: MongoImportInput): Promise<MongoImportResult> {
    const { client, record } = await data.connect(input.connectionId);
    data.assertWritable(record);
    const file = pendingFiles.get(input.fileToken);
    if (file === undefined) {
      throw new StewardServiceError('NOT_FOUND', 'That file is no longer selected', 'Choose the file again.');
    }
    if (statSync(file.path).size > IMPORT_MAX_BYTES) {
      throw new StewardServiceError('VALIDATION_FAILED', 'That file is too large to import from here', 'The limit is 200 MB; split it first.');
    }

    return data.audited(record, 'import', `${input.db}.${input.collection}`, async () => {
      const collection = data.collectionOf(client, input);
      let inserted = 0;
      let failed = 0;
      let firstError: string | null = null;
      let batch: Document[] = [];

      const flush = async (): Promise<void> => {
        if (batch.length === 0) return;
        const current = batch;
        batch = [];
        try {
          const result = await collection.insertMany(current, { ordered: false });
          inserted += result.insertedCount;
        } catch (error) {
          const partial = (error as { result?: { insertedCount?: number }; insertedCount?: number } | null) ?? {};
          const done = partial.result?.insertedCount ?? partial.insertedCount ?? 0;
          inserted += done;
          failed += current.length - done;
          firstError ??= translateMongoError(error, record.hostDisplay).message;
        }
      };

      for await (const item of readDocuments(file.path, input.format)) {
        if (item.document === undefined) {
          failed += 1;
          firstError ??= item.error ?? 'a row could not be read';
          continue;
        }
        batch.push(item.document);
        if (batch.length >= IMPORT_BATCH) await flush();
      }
      await flush();
      pendingFiles.delete(input.fileToken);
      return { insertedCount: inserted, failedCount: failed, firstError };
    });
  }

  return { pickFile, exportQuery, importFile };
}

export type MongoIoService = ReturnType<typeof createMongoIoService>;
