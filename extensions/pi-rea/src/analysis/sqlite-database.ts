
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { capabilityUnavailable, invalidRequest } from '../contract/errors.ts';

export const SQLITE_LIMITATIONS = [
  'Inspects an offline stable file set. Filesystem identity checks detect observed acquisition changes; they do not establish an atomic snapshot of an actively changing database. Supply an application-created backup or quiescent database/WAL pair.',
  'The source database and WAL are never opened by SQLite or modified. A private copy may acquire its own WAL-index sidecar and is removed after inspection.',
  'SQLite reports current schema and selected committed rows from its valid database/WAL state. Deleted records, uncommitted or invalid WAL tails, encrypted databases, forensic recovery, and full integrity verification are outside this profile.',
  'Stored CREATE statements preserve index/view/trigger definitions. Views, triggers, and virtual/shadow table rows are not executed; virtual-table column expansion is unsupported.',
  "Selected rows have unspecified order and are a bounded sample. Text display may replace invalid sequences; bytes_hex and encoding preserve SQLite's text byte representation, not original on-disk page offsets.",
  'Resource boundaries: at most two concurrent inspections per provider; combined input 256 MiB per inspection, complete worker JSON 16 MiB, native SQLite value/record and SQL statement lengths 16 MiB, owned-worker JavaScript heap 256 MiB. The parent applies a separate supervised worker deadline, reported in worker_timeout_ms. These are distinct from total resident memory; an overall native SQLite heap cap is not claimed. Failures return no partial success.',
] as const;

export interface SqliteInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly wal: { readonly path: string; readonly sha256: string; readonly bytes: number } | null;
  readonly engine: { readonly name: 'SQLite'; readonly version: string };
  readonly worker_timeout_ms: number;
  readonly database_encoding: 'UTF-8' | 'UTF-16le' | 'UTF-16be';
  readonly schema: {
    readonly scope: 'inventory' | 'selected_table' | 'database';
    readonly completeness: 'complete';
    readonly tables: readonly SqliteTable[];
    readonly indexes: readonly SqliteIndex[];
    readonly views: readonly SqliteView[];
    readonly triggers: readonly SqliteTrigger[];
  };
  readonly rows: {
    readonly table: string;
    readonly columns: readonly string[];
    readonly values: readonly (readonly SqliteCell[])[];
    readonly truncated: boolean;
    readonly examined_rows: number;
  } | null;
  readonly limitations: readonly string[];
}

interface SqliteIndex {
  readonly name: string;
  readonly table: string;
  readonly root_page: number;
  readonly sql?: string | null;
}

interface SqliteView {
  readonly name: string;
  readonly sql?: string | null;
}

interface SqliteTrigger {
  readonly name: string;
  readonly table: string;
  readonly sql?: string | null;
}

interface SqliteTable {
  readonly name: string;
  readonly sql?: string | null;
  readonly root_page: number;
  readonly kind: 'table' | 'virtual' | 'shadow' | 'unknown';
  readonly without_rowid: boolean;
  readonly strict: boolean;
  readonly column_count: number | null;
  readonly columns_completeness: 'complete' | 'unsupported' | 'not_requested';
  readonly columns: readonly {
    readonly cid: number;
    readonly name: string;
    readonly declared_type: string;
    readonly not_null: boolean;
    readonly default_sql: string | null;
    readonly primary_key_position: number;
    readonly hidden: 0 | 1 | 2 | 3;
  }[];
}

type SqliteCell =
  | { readonly type: 'null' }
  | { readonly type: 'integer'; readonly value: string }
  | { readonly type: 'real'; readonly value: number | 'Infinity' | '-Infinity' | '-0' }
  | { readonly type: 'text'; readonly value: string; readonly bytes_hex: string; readonly encoding: 'UTF-8' | 'UTF-16le' | 'UTF-16be' }
  | { readonly type: 'blob'; readonly bytes_hex: string; readonly bytes: number; readonly truncated: boolean };

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_sqlite_database',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256File = async (path: string): Promise<{ sha256: string; bytes: number }> => {
  const handle = await open(path, 'r');
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
    }
    return { sha256: hash.digest('hex'), bytes };
  } finally {
    await handle.close();
  }
};

const nodeSupportsSqliteLimits = async (): Promise<{ ok: boolean; version: string | null; detail: string }> => {
  try {
    const mod = await import('node:sqlite');
    const DatabaseSync = (mod as { DatabaseSync?: new (path: string, options?: { readOnly?: boolean }) => {
      readonly limits?: unknown;
      prepare: (sql: string) => { all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown };
      exec: (sql: string) => void;
      close: () => void;
    } }).DatabaseSync;
    if (DatabaseSync === undefined) return { ok: false, version: null, detail: 'node:sqlite DatabaseSync is unavailable' };
    const db = new DatabaseSync(':memory:');
    try {
      if (db.limits === undefined || db.limits === null) {
        return { ok: false, version: null, detail: 'DatabaseSync.limits is missing; need Node.js 24.x >=24.15 or 26+' };
      }
      const row = db.prepare('select sqlite_version() as v').get() as { v?: string };
      return { ok: true, version: typeof row?.v === 'string' ? row.v : 'unknown', detail: 'ok' };
    } finally {
      db.close();
    }
  } catch (error) {
    return { ok: false, version: null, detail: error instanceof Error ? error.message : String(error) };
  }
};

const tableKind = (sql: string | null, name: string): SqliteTable['kind'] => {
  if (sql === null) return name.startsWith('sqlite_') ? 'unknown' : 'unknown';
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.includes('virtual table')) return 'virtual';
  return 'table';
};

const encodeCell = (value: unknown, encoding: SqliteInspection['database_encoding']): SqliteCell => {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) return { type: 'integer', value: String(value) };
    if (Object.is(value, -0)) return { type: 'real', value: '-0' };
    if (value === Number.POSITIVE_INFINITY) return { type: 'real', value: 'Infinity' };
    if (value === Number.NEGATIVE_INFINITY) return { type: 'real', value: '-Infinity' };
    return { type: 'real', value };
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return { type: 'text', value, bytes_hex: bytes.toString('hex'), encoding };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    const limit = 4096;
    const truncated = bytes.length > limit;
    const slice = truncated ? bytes.subarray(0, limit) : bytes;
    return { type: 'blob', bytes_hex: slice.toString('hex'), bytes: bytes.length, truncated };
  }
  return { type: 'text', value: String(value), bytes_hex: Buffer.from(String(value), 'utf8').toString('hex'), encoding };
};

export interface SqliteOptions {
  readonly workerTimeoutMs?: number;
  readonly table?: string;
  readonly columns?: readonly string[];
  readonly schemaScope?: 'inventory' | 'selected_table' | 'database';
  readonly rowLimit?: number;
  readonly cwd?: string;
}

export const inspectSqliteDatabaseFromPath = async (
  path: string,
  options: SqliteOptions = {},
): Promise<{ record: SqliteInspection; path: string; resolvedPath: string }> => {
  const support = await nodeSupportsSqliteLimits();
  if (!support.ok) {
    throw capabilityUnavailable(
      `inspect_sqlite_database requires Node.js 24.x >=24.15 or 26+ with native DatabaseSync.limits support (${support.detail}).`,
      { operation: 'inspect_sqlite_database', reason: 'runtime_prerequisite', detail: support.detail },
    );
  }

  const workerTimeoutMs = options.workerTimeoutMs ?? 30_000;
  if (!Number.isInteger(workerTimeoutMs) || workerTimeoutMs < 1) throw inputError(path, 'invalid_value', 'worker_timeout_ms must be a positive integer.');
  const rowLimit = options.rowLimit ?? 20;
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 10_000) throw inputError(path, 'invalid_value', 'row_limit must be an integer between 1 and 10000.');
  if (options.columns !== undefined && options.table === undefined) throw inputError(path, 'invalid_value', 'columns requires table.');
  if (options.rowLimit !== undefined && options.table === undefined) throw inputError(path, 'invalid_value', 'row_limit requires table.');
  if (options.schemaScope === 'selected_table' && options.table === undefined) throw inputError(path, 'invalid_value', 'schema_scope=selected_table requires table.');

  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let header: Buffer;
  try {
    const handle = await open(resolvedPath, 'r');
    try {
      header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, 16, 0);
      if (bytesRead < 16 || header.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
        throw inputError(path, 'invalid_format', 'the file is not a SQLite database snapshot.');
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'payload' in error) throw error;
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }

  const artifact = await sha256File(resolvedPath);
  let wal: SqliteInspection['wal'] = null;
  try {
    const walPath = `${resolvedPath}-wal`;
    const info = await stat(walPath);
    if (info.isFile()) {
      const digest = await sha256File(walPath);
      wal = { path: `${path}-wal`, sha256: digest.sha256, bytes: digest.bytes };
    }
  } catch {
    wal = null;
  }

  const mod = await import('node:sqlite');
  const DatabaseSync = (mod as { DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    prepare: (sql: string) => { all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown };
    close: () => void;
  } }).DatabaseSync;
  const db = new DatabaseSync(resolvedPath, { readOnly: true });
  try {
    const encodingRow = db.prepare('pragma encoding').get() as { encoding?: string } | undefined;
    const encodingRaw = encodingRow?.encoding ?? 'UTF-8';
    const database_encoding: SqliteInspection['database_encoding'] =
      encodingRaw === 'UTF-16le' || encodingRaw === 'UTF-16be' ? encodingRaw : 'UTF-8';

    const tableList = db
      .prepare(`select name, type, ncol, wr, strict from pragma_table_list where schema = 'main'`)
      .all() as { name: string; type: string; ncol: number; wr: number; strict: number }[];
    const tableMeta = new Map(tableList.map((row) => [row.name, row]));

    const scope: SqliteInspection['schema']['scope'] =
      options.schemaScope ?? (options.table === undefined ? 'inventory' : 'selected_table');
    const selected = options.table;
    const declaration = scope === 'inventory' ? '' : ', sql';
    const selection =
      scope === 'selected_table' ? ` where tbl_name = ${quoteLiteral(selected ?? '')}` : '';
    const master = db
      .prepare(
        `select type, name, tbl_name, rootpage${declaration} from main.sqlite_schema${selection}`,
      )
      .all() as { type: string; name: string; tbl_name: string; rootpage: number; sql?: string | null }[];

    const tables: SqliteTable[] = [];
    const indexes: SqliteIndex[] = [];
    const views: SqliteView[] = [];
    const triggers: SqliteTrigger[] = [];

    for (const entry of master) {
      if (entry.type === 'index') {
        if (scope === 'inventory' || scope === 'database' || entry.tbl_name === selected) {
          indexes.push({
            name: entry.name,
            table: entry.tbl_name,
            root_page: entry.rootpage,
            ...(scope === 'inventory' ? {} : { sql: entry.sql ?? null }),
          });
        }
        continue;
      }
      if (entry.type === 'view') {
        if (scope === 'inventory' || scope === 'database') {
          views.push({
            name: entry.name,
            ...(scope === 'inventory' ? {} : { sql: entry.sql ?? null }),
          });
        }
        continue;
      }
      if (entry.type === 'trigger') {
        if (scope === 'inventory' || scope === 'database') {
          triggers.push({
            name: entry.name,
            table: entry.tbl_name,
            ...(scope === 'inventory' ? {} : { sql: entry.sql ?? null }),
          });
        }
        continue;
      }
      if (entry.type !== 'table') continue;
      if (scope === 'selected_table' && entry.name !== selected) continue;

      const listed = tableMeta.get(entry.name);
      const includeColumns = scope !== 'inventory' && (scope === 'database' || entry.name === selected);
      let columns: SqliteTable['columns'] = [];
      let columnsCompleteness: SqliteTable['columns_completeness'] = scope === 'inventory' ? 'not_requested' : 'complete';
      if (includeColumns) {
        const pragma = db.prepare(`pragma table_xinfo(${quoteIdent(entry.name)})`).all() as {
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
          hidden: number;
        }[];
        columns = pragma.map((col) => ({
          cid: col.cid,
          name: col.name,
          declared_type: col.type ?? '',
          not_null: col.notnull === 1,
          default_sql: col.dflt_value,
          primary_key_position: col.pk,
          hidden: ([0, 1, 2, 3].includes(col.hidden) ? col.hidden : 0) as 0 | 1 | 2 | 3,
        }));
        columnsCompleteness = listed?.type === 'virtual' ? 'unsupported' : 'complete';
      }

      const sqlLower = (entry.sql ?? '').toLowerCase();
      const kindFromList =
        listed?.type === 'virtual' ? 'virtual' : listed?.type === 'table' ? 'table' : tableKind(entry.sql ?? null, entry.name);
      const columnCount =
        listed === undefined
          ? null
          : listed.type === 'virtual' && listed.ncol === 0
            ? null
            : listed.ncol;
      tables.push({
        name: entry.name,
        ...(scope === 'inventory' ? {} : { sql: entry.sql ?? null }),
        root_page: entry.rootpage,
        kind: kindFromList,
        without_rowid: listed !== undefined ? listed.wr !== 0 : sqlLower.includes('without rowid'),
        strict: listed !== undefined ? listed.strict !== 0 : /\bstrict\b/i.test(entry.sql ?? ''),
        column_count: columnCount,
        columns_completeness: columnsCompleteness,
        columns,
      });
    }

    if (selected !== undefined && !tables.some((table) => table.name === selected) && scope === 'selected_table') {
      throw inputError(path, 'invalid_value', `table ${selected} was not found as an ordinary table.`);
    }

    let rows: SqliteInspection['rows'] = null;
    if (selected !== undefined) {
      const table = tables.find((entry) => entry.name === selected);
      if (table === undefined || table.kind !== 'table') {
        throw inputError(path, 'invalid_value', 'row sampling requires an ordinary table.');
      }
      const columnNames =
        options.columns ??
        (table.columns.length > 0
          ? table.columns.filter((col) => col.hidden === 0).map((col) => col.name)
          : ((db.prepare(`pragma table_xinfo(${quoteIdent(selected)})`).all() as { name: string; hidden: number }[])
              .filter((col) => col.hidden === 0)
              .map((col) => col.name)));
      if (columnNames.length === 0) throw inputError(path, 'invalid_value', 'no visible columns available to sample.');
      const sql = `select ${columnNames.map(quoteIdent).join(', ')} from ${quoteIdent(selected)} limit ?`;
      const rawRows = db.prepare(sql).all(rowLimit) as Record<string, unknown>[];
      rows = {
        table: selected,
        columns: [...columnNames],
        values: rawRows.map((row) => columnNames.map((name) => encodeCell(row[name], database_encoding))),
        truncated: rawRows.length >= rowLimit,
        examined_rows: rawRows.length,
      };
    }

    return {
      record: {
        artifact: { path, sha256: artifact.sha256, bytes: artifact.bytes },
        wal,
        engine: { name: 'SQLite', version: support.version ?? 'unknown' },
        worker_timeout_ms: workerTimeoutMs,
        database_encoding,
        schema: {
          scope,
          completeness: 'complete',
          tables,
          indexes,
          views,
          triggers,
        },
        rows,
        limitations: [...SQLITE_LIMITATIONS],
      },
      path,
      resolvedPath,
    };
  } finally {
    db.close();
  }
};

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
