import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, onTestFinished, test, vi } from 'vitest';
import { exportWebScripts } from '../src/analysis/export-web-scripts.ts';
import { extractZipArtifact } from '../src/analysis/extract-artifact.ts';
import { inspectModelArtifactFromPath } from '../src/analysis/model-artifact.ts';
import { inspectPythonPycFromPath, type PycOptions } from '../src/analysis/python-pyc.ts';
import { inspectSqliteDatabaseFromPath, type SqliteOptions } from '../src/analysis/sqlite-database.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { extractArtifact, inspectArtifact } from '../src/tools/artifact-tools.ts';
import { inspectModelArtifact } from '../src/tools/model-artifact-tools.ts';
import { inspectPythonPyc } from '../src/tools/python-pyc-tools.ts';
import { openBinary } from '../src/tools/session-tools.ts';
import { inspectSqliteDatabase } from '../src/tools/sqlite-tools.ts';
import { exportWebScriptsTool } from '../src/tools/web-script-tools.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const sha256Hex = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex');

const emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const rejectionOf = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('the analyzer returned instead of throwing');
};

const payloadOf = async (run: () => Promise<unknown>): Promise<ReaError['payload']> => ((await rejectionOf(run)) as ReaError).payload;

const byte = (...values: readonly number[]): Buffer => Buffer.from(values);

const i32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
};

const u32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const u64 = (value: number | bigint): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const f32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(value);
  return buffer;
};

const f64 = (value: number): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(value);
  return buffer;
};

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// SQLite

const sqliteDatabase = async (dir: string, name: string, statements: readonly string[], encoding?: 'UTF-16le' | 'UTF-16be'): Promise<string> => {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  try {
    if (encoding !== undefined) db.exec(`pragma encoding = '${encoding}'`);
    for (const statement of statements) db.exec(statement);
  } finally {
    db.close();
  }
  return path;
};

const sqliteInputError = (path: string, reason: string, detail: string) => ({
  code: 'invalid_request',
  category: 'invalid_input',
  retryable: true,
  message: 'The inspection input is not usable. Check the argument and retry.',
  details: {
    operation: 'inspect_sqlite_database',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  },
});

const usersTable = {
  name: 'users',
  sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, email TEXT UNIQUE)',
  root_page: expect.any(Number),
  kind: 'table',
  without_rowid: false,
  strict: false,
  column_count: 4,
  columns_completeness: 'complete',
  columns: [
    { cid: 0, name: 'id', declared_type: 'INTEGER', not_null: false, default_sql: null, primary_key_position: 1, hidden: 0 },
    { cid: 1, name: 'name', declared_type: 'TEXT', not_null: true, default_sql: null, primary_key_position: 0, hidden: 0 },
    { cid: 2, name: 'age', declared_type: 'INTEGER', not_null: false, default_sql: null, primary_key_position: 0, hidden: 0 },
    { cid: 3, name: 'email', declared_type: 'TEXT', not_null: false, default_sql: null, primary_key_position: 0, hidden: 0 },
  ],
};

test('sqlite inventories tables, indexes, views, triggers from fixture.db', async () => {
  const path = fixturePath('targets/fixture.db');
  const { record, resolvedPath } = await inspectSqliteDatabaseFromPath(path);

  expect(resolvedPath).toBe(path);
  expect(record.artifact).toStrictEqual({ path, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: 20_480 });
  expect(record.wal).toBeNull();
  expect(record.engine).toStrictEqual({ name: 'SQLite', version: expect.stringMatching(/^3\./) });
  expect(record.worker_timeout_ms).toBe(30_000);
  expect(record.database_encoding).toBe('UTF-8');
  expect(record.schema).toStrictEqual({
    scope: 'inventory',
    completeness: 'complete',
    tables: [
      { name: 'users', root_page: expect.any(Number), kind: 'table', without_rowid: false, strict: false, column_count: 4, columns_completeness: 'not_requested', columns: [] },
      { name: 'audit_log', root_page: expect.any(Number), kind: 'table', without_rowid: false, strict: false, column_count: 3, columns_completeness: 'not_requested', columns: [] },
    ],
    indexes: [
      { name: 'sqlite_autoindex_users_1', table: 'users', root_page: expect.any(Number) },
      { name: 'idx_users_name', table: 'users', root_page: expect.any(Number) },
    ],
    views: [{ name: 'adults' }],
    triggers: [{ name: 'users_audit', table: 'users' }],
  });
  expect(record.rows).toBeNull();
  expect(record.limitations).toHaveLength(6);
});

test('sqlite database scope returns exact DDL declarations', async () => {
  const path = fixturePath('targets/fixture.db');
  const { record } = await inspectSqliteDatabaseFromPath(path, { schemaScope: 'database' });

  expect(record.schema.tables[0]).toStrictEqual(usersTable);
  expect(record.schema.tables[1]).toStrictEqual({
    name: 'audit_log',
    sql: 'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, action TEXT, at TEXT)',
    root_page: expect.any(Number),
    kind: 'table',
    without_rowid: false,
    strict: false,
    column_count: 3,
    columns_completeness: 'complete',
    columns: [
      { cid: 0, name: 'id', declared_type: 'INTEGER', not_null: false, default_sql: null, primary_key_position: 1, hidden: 0 },
      { cid: 1, name: 'action', declared_type: 'TEXT', not_null: false, default_sql: null, primary_key_position: 0, hidden: 0 },
      { cid: 2, name: 'at', declared_type: 'TEXT', not_null: false, default_sql: null, primary_key_position: 0, hidden: 0 },
    ],
  });
  expect(record.schema.indexes).toStrictEqual([
    { name: 'sqlite_autoindex_users_1', table: 'users', root_page: expect.any(Number), sql: null },
    { name: 'idx_users_name', table: 'users', root_page: expect.any(Number), sql: 'CREATE INDEX idx_users_name ON users(name)' },
  ]);
  expect(record.schema.views).toStrictEqual([{ name: 'adults', sql: 'CREATE VIEW adults AS SELECT * FROM users WHERE age >= 18' }]);
  expect(record.schema.triggers).toStrictEqual([
    {
      name: 'users_audit',
      table: 'users',
      sql: "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN INSERT INTO audit_log(action, at) VALUES ('insert new', datetime('now')); END",
    },
  ]);
  expect(record.rows).toBeNull();
});

test('sqlite samples typed cells for selected columns', async () => {
  const path = fixturePath('targets/fixture.db');
  const { record } = await inspectSqliteDatabaseFromPath(path, { table: 'users', columns: ['id', 'name'], rowLimit: 3 });

  expect(record.schema.scope).toBe('selected_table');
  expect(record.schema.tables.map((table) => table.name)).toStrictEqual(['users']);
  expect(record.schema.indexes).toStrictEqual([
    { name: 'sqlite_autoindex_users_1', table: 'users', root_page: expect.any(Number), sql: null },
    { name: 'idx_users_name', table: 'users', root_page: expect.any(Number), sql: 'CREATE INDEX idx_users_name ON users(name)' },
  ]);
  expect(record.schema.views).toStrictEqual([]);
  expect(record.schema.triggers).toStrictEqual([]);
  const rows = record.rows;
  expect(rows?.columns).toStrictEqual(['id', 'name']);
  expect(rows?.examined_rows).toBe(3);
  expect(rows?.truncated).toBe(true);
  const pairs = (rows?.values ?? []).map((row) => row.map((cell) => ('value' in cell ? String(cell.value) : cell.type))).sort();
  expect(pairs).toStrictEqual([
    ['1', 'user1'],
    ['10', 'user10'],
    ['11', 'user11'],
  ]);
  expect((rows?.values ?? []).find((row) => row[0]?.type === 'integer' && row[0].value === '1')).toStrictEqual([
    { type: 'integer', value: '1' },
    { type: 'text', value: 'user1', bytes_hex: '7573657231', encoding: 'UTF-8' },
  ]);
});

test('sqlite marks an untruncated sample when row_limit exceeds rows', async () => {
  const path = fixturePath('targets/fixture.db');
  const { record } = await inspectSqliteDatabaseFromPath(path, { table: 'users', columns: ['id'], rowLimit: 100 });

  expect(record.rows).toMatchObject({ truncated: false, examined_rows: 25 });
  const ids = (record.rows?.values ?? []).map((row) => Number(row[0]?.type === 'integer' ? row[0].value : '0')).sort((left, right) => left - right);
  expect(ids).toStrictEqual(Array.from({ length: 25 }, (_, index) => index + 1));
});

test('sqlite falls back to pragma columns when the table is inventoried', async () => {
  const path = fixturePath('targets/fixture.db');
  const { record } = await inspectSqliteDatabaseFromPath(path, { table: 'users', schemaScope: 'inventory' });

  expect(record.schema.scope).toBe('inventory');
  expect(record.schema.tables.map((table) => table.columns)).toStrictEqual([[], []]);
  expect(record.rows).toMatchObject({ table: 'users', columns: ['id', 'name', 'age', 'email'], examined_rows: 20, truncated: true });
  expect(record.rows?.values[0]?.[1]).toStrictEqual({ type: 'text', value: 'user1', bytes_hex: '7573657231', encoding: 'UTF-8' });
});

test('sqlite encodes each cell type including infinities', async () => {
  const targets = await tempTargets();
  const path = await sqliteDatabase(targets.dir, 'cells.db', [
    'CREATE TABLE cells (label TEXT, real_value REAL, blob_value BLOB, int_value INTEGER)',
    "INSERT INTO cells VALUES ('one', 1.5, zeroblob(5000), NULL)",
    "INSERT INTO cells VALUES ('two', 9e999, x'00ff', -7)",
    "INSERT INTO cells VALUES ('three', -9e999, NULL, 9007199254740991)",
  ]);

  const { record } = await inspectSqliteDatabaseFromPath(path, { table: 'cells', rowLimit: 3 });

  expect(record.rows?.values[0]).toStrictEqual([
    { type: 'text', value: 'one', bytes_hex: '6f6e65', encoding: 'UTF-8' },
    { type: 'real', value: 1.5 },
    { type: 'blob', bytes_hex: '00'.repeat(4096), bytes: 5000, truncated: true },
    { type: 'null' },
  ]);
  expect(record.rows?.values[1]).toStrictEqual([
    { type: 'text', value: 'two', bytes_hex: '74776f', encoding: 'UTF-8' },
    { type: 'real', value: 'Infinity' },
    { type: 'blob', bytes_hex: '00ff', bytes: 2, truncated: false },
    { type: 'integer', value: '-7' },
  ]);
  expect(record.rows?.values[2]).toStrictEqual([{ type: 'text', value: 'three', bytes_hex: '7468726565', encoding: 'UTF-8' }, { type: 'real', value: '-Infinity' }, { type: 'null' }, { type: 'integer', value: '9007199254740991' }]);
});

test('sqlite reports fts5 virtual tables beside shadow tables', async () => {
  const targets = await tempTargets();
  const path = await sqliteDatabase(targets.dir, 'fts.db', ['CREATE VIRTUAL TABLE notes USING fts5(title)', "INSERT INTO notes VALUES ('hello')", 'CREATE TABLE plain (value TEXT)', 'CREATE VIEW plain_view AS SELECT value FROM plain']);

  const { record } = await inspectSqliteDatabaseFromPath(path, { schemaScope: 'database' });
  const notes = record.schema.tables.find((table) => table.name === 'notes');
  expect(notes).toMatchObject({ kind: 'virtual', column_count: 3, columns_completeness: 'unsupported', without_rowid: false, strict: false });
  expect(notes?.columns.map((column) => column.hidden)).toStrictEqual([0, 1, 1]);
  const shadow = record.schema.tables.find((table) => table.name === 'notes_data');
  expect(shadow).toMatchObject({
    kind: 'table',
    sql: "CREATE TABLE 'notes_data'(id INTEGER PRIMARY KEY, block BLOB)",
    column_count: 2,
    columns_completeness: 'complete',
    without_rowid: false,
  });

  const payload = await payloadOf(() => inspectSqliteDatabaseFromPath(path, { table: 'notes' }));
  expect(payload).toMatchObject(sqliteInputError(path, 'invalid_value', 'row sampling requires an ordinary table.'));

  const viewPayload = await payloadOf(() => inspectSqliteDatabaseFromPath(path, { table: 'plain_view', schemaScope: 'database' }));
  expect(viewPayload).toMatchObject(sqliteInputError(path, 'invalid_value', 'row sampling requires an ordinary table.'));

  const missingPayload = await payloadOf(() => inspectSqliteDatabaseFromPath(path, { table: 'absent' }));
  expect(missingPayload).toMatchObject(sqliteInputError(path, 'invalid_value', 'table absent was not found as an ordinary table.'));

  const noColumnsPayload = await payloadOf(() => inspectSqliteDatabaseFromPath(path, { table: 'notes_data', columns: [] }));
  expect(noColumnsPayload).toMatchObject(sqliteInputError(path, 'invalid_value', 'no visible columns available to sample.'));
});

test('sqlite reports the STRICT, WITHOUT ROWID flags', async () => {
  const targets = await tempTargets();
  const path = await sqliteDatabase(targets.dir, 'strict.db', ['CREATE TABLE strict_table (id INTEGER PRIMARY KEY, label TEXT) STRICT, WITHOUT ROWID']);

  const { record } = await inspectSqliteDatabaseFromPath(path, { schemaScope: 'database' });

  expect(record.schema.tables[0]).toMatchObject({ name: 'strict_table', strict: true, without_rowid: true, column_count: 2, kind: 'table' });
});

test('sqlite records the WAL sidecar digest as an observation', async () => {
  const targets = await tempTargets();
  const path = await targets.write('copy.db', await readFile(fixturePath('targets/fixture.db')));
  await targets.write('copy.db-wal', Buffer.alloc(0));

  const { record } = await inspectSqliteDatabaseFromPath(path);

  expect(record.wal).toStrictEqual({ path: `${path}-wal`, sha256: emptySha256, bytes: 0 });
});

test.for([{ database: 'UTF-16le' }, { database: 'UTF-16be' }] as const)('sqlite records $database database encoding', async (encodingCase) => {
  const targets = await tempTargets();
  const path = await sqliteDatabase(targets.dir, 'encoded.db', ['CREATE TABLE labels (value TEXT)', "INSERT INTO labels VALUES ('ü')"], encodingCase.database);

  const { record } = await inspectSqliteDatabaseFromPath(path, { table: 'labels' });

  expect(record.database_encoding).toBe(encodingCase.database);
  expect(record.rows?.values[0]?.[0]).toStrictEqual({ type: 'text', value: 'ü', bytes_hex: 'c3bc', encoding: encodingCase.database });
});

test('sqlite resolves a relative path against the supplied cwd', async () => {
  const targets = await tempTargets();
  await targets.write('relative.db', await readFile(fixturePath('targets/fixture.db')));

  const { record, path, resolvedPath } = await inspectSqliteDatabaseFromPath('relative.db', { cwd: targets.dir, workerTimeoutMs: 1234 });

  expect(path).toBe('relative.db');
  expect(resolvedPath).toBe(join(targets.dir, 'relative.db'));
  expect(record.artifact.path).toBe('relative.db');
  expect(record.worker_timeout_ms).toBe(1234);
});

const sqliteOptionCases: readonly { name: string; options: SqliteOptions; detail: string }[] = [
  { name: 'a zero worker timeout', options: { workerTimeoutMs: 0 }, detail: 'worker_timeout_ms must be a positive integer.' },
  { name: 'a fractional worker timeout', options: { workerTimeoutMs: 1.5 }, detail: 'worker_timeout_ms must be a positive integer.' },
  { name: 'a zero row limit', options: { rowLimit: 0 }, detail: 'row_limit must be an integer between 1 and 10000.' },
  { name: 'a row limit above the cap', options: { rowLimit: 10_001 }, detail: 'row_limit must be an integer between 1 and 10000.' },
  { name: 'columns without a table', options: { columns: ['id'] }, detail: 'columns requires table.' },
  { name: 'a row limit without a table', options: { rowLimit: 2 }, detail: 'row_limit requires table.' },
  { name: 'a selected table scope without a table', options: { schemaScope: 'selected_table' }, detail: 'schema_scope=selected_table requires table.' },
];

test.for(sqliteOptionCases)('sqlite rejects $name', async (optionCase) => {
  const path = '/tmp/pi-rea-no-such-database.db';

  const payload = await payloadOf(() => inspectSqliteDatabaseFromPath(path, optionCase.options));

  expect(payload).toMatchObject(sqliteInputError(path, 'invalid_value', optionCase.detail));
});

test('sqlite rejects a missing database path', async () => {
  const targets = await tempTargets();
  const path = join(targets.dir, 'missing.db');

  const payload = await payloadOf(() => inspectSqliteDatabaseFromPath(path));

  expect(payload).toMatchObject(sqliteInputError(path, 'invalid_value', 'no file exists there'));
});

test('sqlite rejects a directory path', async () => {
  const targets = await tempTargets();

  const payload = await payloadOf(() => inspectSqliteDatabaseFromPath(targets.dir));

  expect(payload).toMatchObject(sqliteInputError(targets.dir, 'invalid_value', 'it could not be read (EISDIR: illegal operation on a directory, read)'));
});

test('sqlite rejects a file without the SQLite header', async () => {
  const targets = await tempTargets();
  const path = await targets.write('text.db', 'this is not a database file at all');

  const payload = await payloadOf(() => inspectSqliteDatabaseFromPath(path));

  expect(payload).toMatchObject(sqliteInputError(path, 'invalid_format', 'the file is not a SQLite database snapshot.'));
});

test('sqlite rejects a truncated SQLite header', async () => {
  const targets = await tempTargets();
  const path = await targets.write('short.db', 'SQLite format 3');

  const payload = await payloadOf(() => inspectSqliteDatabaseFromPath(path));

  expect(payload).toMatchObject(sqliteInputError(path, 'invalid_format', 'the file is not a SQLite database snapshot.'));
});

// Python .pyc

const PYC_313 = 168_627_699;
const PYC_310 = 218_958_447;
const BYTECODE = byte(0x64, 0x00, 0x53, 0x00);

const marshalFlag = (type: string, ref = false): Buffer => byte(type.charCodeAt(0) | (ref ? 0x80 : 0));

const sized = (type: string, data: Buffer): Buffer => Buffer.concat([marshalFlag(type), i32(data.length), data]);

const marshal = {
  none: (): Buffer => marshalFlag('N'),
  zero: (): Buffer => marshalFlag('0'),
  true: (): Buffer => marshalFlag('T'),
  false: (): Buffer => marshalFlag('F'),
  int: (value: number, ref = false): Buffer => Buffer.concat([marshalFlag('i', ref), i32(value)]),
  long: (digits: number): Buffer => Buffer.concat([marshalFlag('l'), i32(digits), Buffer.alloc(Math.abs(digits) * 2)]),
  float: (value: number): Buffer => Buffer.concat([marshalFlag('g'), f64(value)]),
  bytes: (data: Buffer): Buffer => sized('s', data),
  str: (text: string): Buffer => sized('u', Buffer.from(text, 'utf8')),
  ascii: (text: string): Buffer => sized('A', Buffer.from(text, 'ascii')),
  unicode: (text: string): Buffer => sized('t', Buffer.from(text, 'utf8')),
  shortAscii: (text: string): Buffer => Buffer.concat([marshalFlag('z'), byte(text.length), Buffer.from(text, 'ascii')]),
  tuple: (...items: readonly Buffer[]): Buffer => Buffer.concat([marshalFlag(')'), byte(items.length), ...items]),
  list: (...items: readonly Buffer[]): Buffer => Buffer.concat([marshalFlag('['), i32(items.length), ...items]),
  dict: (pairs: readonly (readonly [string, Buffer])[]): Buffer => Buffer.concat([marshalFlag('{'), ...pairs.flatMap(([key, value]) => [marshal.str(key), value]), marshal.none()]),
  code: (body: Buffer): Buffer => Buffer.concat([marshalFlag('c'), body]),
  ref: (index: number): Buffer => Buffer.concat([marshalFlag('r'), i32(index)]),
};

interface ModernFields {
  readonly argcount?: number;
  readonly posonly?: number;
  readonly kwonly?: number;
  readonly stacksize?: number;
  readonly codeFlags?: number;
  readonly code?: Buffer;
  readonly consts?: Buffer;
  readonly names?: Buffer;
  readonly localsplusnames?: Buffer;
  readonly localspluskinds?: Buffer;
  readonly filename?: Buffer;
  readonly name?: Buffer;
  readonly qualname?: Buffer;
  readonly firstlineno?: number;
  readonly linetable?: Buffer;
  readonly exceptiontable?: Buffer;
}

const modernBody = (fields: ModernFields = {}): Buffer =>
  Buffer.concat([
    i32(fields.argcount ?? 0),
    i32(fields.posonly ?? 0),
    i32(fields.kwonly ?? 0),
    i32(fields.stacksize ?? 1),
    i32(fields.codeFlags ?? 0x40),
    fields.code ?? marshal.bytes(BYTECODE),
    fields.consts ?? marshal.tuple(),
    fields.names ?? marshal.tuple(),
    fields.localsplusnames ?? marshal.tuple(),
    fields.localspluskinds ?? marshal.bytes(Buffer.alloc(0)),
    fields.filename ?? marshal.str('demo.py'),
    fields.name ?? marshal.str('<module>'),
    fields.qualname ?? marshal.str('<module>'),
    i32(fields.firstlineno ?? 1),
    fields.linetable ?? marshal.bytes(Buffer.alloc(0)),
    fields.exceptiontable ?? marshal.bytes(Buffer.alloc(0)),
  ]);

interface LegacyFields {
  readonly argcount?: Buffer;
  readonly posonly?: Buffer;
  readonly kwonly?: Buffer;
  readonly nlocals?: Buffer;
  readonly stacksize?: Buffer;
  readonly codeFlags?: Buffer;
  readonly code?: Buffer;
  readonly consts?: Buffer;
  readonly names?: Buffer;
  readonly varnames?: Buffer;
  readonly freevars?: Buffer;
  readonly cellvars?: Buffer;
  readonly filename?: Buffer;
  readonly name?: Buffer;
  readonly firstlineno?: Buffer;
  readonly lnotab?: Buffer;
}

const legacyBody = (fields: LegacyFields = {}): Buffer =>
  Buffer.concat([
    fields.argcount ?? marshal.int(0),
    fields.posonly ?? marshal.int(0),
    fields.kwonly ?? marshal.int(0),
    fields.nlocals ?? marshal.int(2),
    fields.stacksize ?? marshal.int(1),
    fields.codeFlags ?? marshal.int(0x40),
    fields.code ?? marshal.bytes(BYTECODE),
    fields.consts ?? marshal.tuple(),
    fields.names ?? marshal.tuple(),
    fields.varnames ?? marshal.tuple(marshal.str('a'), marshal.str('b')),
    fields.freevars ?? marshal.tuple(),
    fields.cellvars ?? marshal.tuple(),
    fields.filename ?? marshal.str('legacy.py'),
    fields.name ?? marshal.str('<module>'),
    fields.firstlineno ?? marshal.int(1),
    fields.lnotab ?? marshal.bytes(Buffer.alloc(4)),
  ]);

const pycHeader = (magic: number, options: { flags?: number; tail?: Buffer; mtime?: number; size?: number } = {}): Buffer => {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(magic, 0);
  header.writeUInt32LE(options.flags ?? 0, 4);
  if (options.tail === undefined) {
    header.writeUInt32LE(options.mtime ?? 1_700_000_000, 8);
    header.writeUInt32LE(options.size ?? 42, 12);
  } else {
    options.tail.copy(header, 8);
  }
  return header;
};

const marshalPyc = (magic: number, root: Buffer, options: { flags?: number; tail?: Buffer } = {}): Buffer => Buffer.concat([pycHeader(magic, options), root]);

const pycFile = (magic: number, codeBody: Buffer, options: { flags?: number; tail?: Buffer } = {}): Buffer => marshalPyc(magic, marshal.code(codeBody), options);

const pycInputError = (path: string, reason: string, detail: string) => ({
  code: 'invalid_request',
  category: 'invalid_input',
  details: {
    operation: 'inspect_python_pyc',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  },
});

test('pyc reads the sample.pyc header plus nested code objects', async () => {
  const path = fixturePath('targets/pyc/sample.pyc');
  const { record, resolvedPath } = await inspectPythonPycFromPath(path);

  expect(resolvedPath).toBe(path);
  expect(record.artifact).toStrictEqual({ path, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: 352 });
  expect(record.header).toStrictEqual({
    magic: 3571,
    python_version: '3.13',
    code_layout: 'py311',
    flags: 0,
    hash_based: false,
    check_source: false,
    source_hash_hex: null,
    source_mtime: 1_793_160_668,
    source_size: 61,
  });
  expect(record.code_objects.map((code) => [code.name, code.nested_code])).toStrictEqual([
    ['<module>', [1]],
    ['greet', []],
  ]);
  expect(record.code_objects[1]).toMatchObject({ qualname: 'greet', firstlineno: 1, filename: fixturePath('targets/pyc/sample.py') });
  expect(record.coverage).toMatchObject({ status: 'complete', code_objects: 2, marshal_bytes: 336 });
  expect(record.limitations).toHaveLength(4);
});

test('pyc reports a hash-based header with an embedded source hash', async () => {
  const targets = await tempTargets();
  const path = await targets.write('hash.pyc', pycFile(PYC_313, modernBody(), { flags: 0x3, tail: Buffer.from('0123456789abcdef', 'hex') }));

  const { record } = await inspectPythonPycFromPath(path);

  expect(record.header).toStrictEqual({
    magic: PYC_313 & 0xffff,
    python_version: '3.13',
    code_layout: 'py311',
    flags: 3,
    hash_based: true,
    check_source: true,
    source_hash_hex: '0123456789abcdef',
    source_mtime: null,
    source_size: null,
  });
});

test('pyc counts marshal objects plus depth for a modern module', async () => {
  const targets = await tempTargets();
  const body = modernBody();
  const path = await targets.write('modern.pyc', pycFile(PYC_313, body));

  const { record } = await inspectPythonPycFromPath(path);

  expect(record.coverage).toStrictEqual({ status: 'complete', objects: 11, code_objects: 1, marshal_bytes: body.length + 1, marshal_depth: 1 });
  expect(record.code_objects[0]).toStrictEqual({
    name: '<module>',
    qualname: '<module>',
    filename: 'demo.py',
    firstlineno: 1,
    argcount: 0,
    posonlyargcount: 0,
    kwonlyargcount: 0,
    nlocals: null,
    stacksize: 1,
    flags: 0x40,
    names: [],
    varnames: null,
    freevars: null,
    cellvars: null,
    localsplusnames: [],
    localspluskinds_hex: '',
    bytecode: { bytes: 4, sha256: sha256Hex(BYTECODE) },
    consts: [],
    nested_code: [],
  });
});

test('pyc decodes a legacy 3.10 code layout', async () => {
  const targets = await tempTargets();
  const body = legacyBody();
  const path = await targets.write('legacy.pyc', pycFile(PYC_310, body));

  const { record } = await inspectPythonPycFromPath(path);

  expect(record.header).toMatchObject({ python_version: '3.10', code_layout: 'legacy', source_mtime: 1_700_000_000, source_size: 42 });
  expect(record.coverage).toStrictEqual({ status: 'complete', objects: 19, code_objects: 1, marshal_bytes: body.length + 1, marshal_depth: 2 });
  expect(record.code_objects[0]).toStrictEqual({
    name: '<module>',
    qualname: null,
    filename: 'legacy.py',
    firstlineno: 1,
    argcount: 0,
    posonlyargcount: 0,
    kwonlyargcount: 0,
    nlocals: 2,
    stacksize: 1,
    flags: 0x40,
    names: [],
    varnames: ['a', 'b'],
    freevars: [],
    cellvars: [],
    localsplusnames: null,
    localspluskinds_hex: null,
    bytecode: { bytes: 4, sha256: sha256Hex(BYTECODE) },
    consts: [],
    nested_code: [],
  });
});

test('pyc summarises every constant kind in a modern code object', async () => {
  const targets = await tempTargets();
  const body = modernBody({
    consts: marshal.tuple(
      marshal.none(),
      marshal.zero(),
      marshal.true(),
      marshal.false(),
      marshal.int(7, true),
      marshal.float(1.5),
      marshal.long(2),
      marshal.str('hello'),
      marshal.shortAscii('abc'),
      marshal.ascii('ascii'),
      marshal.unicode('utf'),
      marshal.bytes(Buffer.from('raw', 'ascii')),
      marshal.list(marshal.int(1)),
      Buffer.concat([marshalFlag('('), i32(1), marshal.int(2)]),
      marshal.dict([['k', marshal.int(2)]]),
      marshal.code(modernBody({ name: marshal.str('inner'), firstlineno: 5 })),
      marshal.ref(0),
    ),
  });
  const path = await targets.write('consts.pyc', pycFile(PYC_313, body));

  const { record } = await inspectPythonPycFromPath(path);

  expect(record.code_objects[0]?.consts).toStrictEqual([
    { kind: 'none' },
    { kind: 'none' },
    { kind: 'bool', value: true },
    { kind: 'bool', value: false },
    { kind: 'int', value: 7 },
    { kind: 'float', value: 1.5 },
    { kind: 'long' },
    { kind: 'str', bytes: 5, truncated: false, value: 'hello' },
    { kind: 'str', bytes: 3, truncated: false, value: 'abc' },
    { kind: 'str', bytes: 5, truncated: false, value: 'ascii' },
    { kind: 'str', bytes: 3, truncated: false, value: 'utf' },
    { kind: 'other' },
    { kind: 'other' },
    { kind: 'other' },
    { kind: 'other' },
    { kind: 'code', name: 'inner', firstlineno: 5 },
    { kind: 'int', value: 7 },
  ]);
  expect(record.code_objects[0]?.nested_code).toStrictEqual([1]);
});

test('pyc refuses a string constant above max_string_bytes', async () => {
  const targets = await tempTargets();
  const body = modernBody({
    consts: marshal.tuple(marshal.str('abcdefghij')),
    filename: marshal.str('a.py'),
    name: marshal.str('m'),
    qualname: marshal.str('q'),
  });
  const path = await targets.write('long.pyc', pycFile(PYC_313, body));

  const payload = await payloadOf(() => inspectPythonPycFromPath(path, { maxStringBytes: 4 }));

  expect(payload).toMatchObject(pycInputError(path, 'invalid_format', 'string length out of range'));
});

test('pyc hashes bytecode read from a string or sequence constant', async () => {
  const targets = await tempTargets();
  const fromString = await targets.write('string.pyc', pycFile(PYC_313, modernBody({ code: marshal.str('ABCD') })));
  const fromList = await targets.write('list.pyc', pycFile(PYC_313, modernBody({ code: marshal.list(marshal.int(100)) })));

  const stringRecord = await inspectPythonPycFromPath(fromString);
  const listRecord = await inspectPythonPycFromPath(fromList);

  expect(stringRecord.record.code_objects[0]?.bytecode).toStrictEqual({ bytes: 4, sha256: sha256Hex('ABCD') });
  expect(listRecord.record.code_objects[0]?.bytecode).toStrictEqual({ bytes: 0, sha256: emptySha256 });
});

test('pyc falls back when name fields are not strings', async () => {
  const targets = await tempTargets();
  const path = await targets.write('fallback.pyc', pycFile(PYC_310, legacyBody({ argcount: marshal.none(), varnames: marshal.int(5), filename: marshal.none(), name: marshal.none() })));

  const { record } = await inspectPythonPycFromPath(path);

  expect(record.code_objects[0]).toMatchObject({ name: '<module>', qualname: null, filename: '', argcount: 0, varnames: [] });
});

test('pyc zero-fills non-numeric legacy code counts', async () => {
  const targets = await tempTargets();
  const path = await targets.write('counts.pyc', pycFile(PYC_310, legacyBody({ posonly: marshal.none(), kwonly: marshal.none(), stacksize: marshal.none(), codeFlags: marshal.none() })));

  const { record } = await inspectPythonPycFromPath(path);

  expect(record.code_objects[0]).toMatchObject({ argcount: 0, posonlyargcount: 0, kwonlyargcount: 0, stacksize: 0, flags: 0, nlocals: 2 });
});

test('pyc flattens nested code objects into stable indexes', async () => {
  const targets = await tempTargets();
  const inner = (name: string): Buffer => marshal.code(modernBody({ name: marshal.str(name) }));
  const path = await targets.write('nested.pyc', pycFile(PYC_313, modernBody({ consts: marshal.tuple(inner('first'), marshal.int(1), inner('second')) })));

  const { record } = await inspectPythonPycFromPath(path);

  expect(record.code_objects.map((code) => [code.name, code.nested_code])).toStrictEqual([
    ['<module>', [1, 2]],
    ['first', []],
    ['second', []],
  ]);
  expect(record.coverage.code_objects).toBe(3);
});

test('pyc records localsplus kinds as hex when present', async () => {
  const targets = await tempTargets();
  const body = modernBody({ localsplusnames: marshal.tuple(marshal.str('a'), marshal.str('b')), localspluskinds: marshal.bytes(byte(0x10, 0x20)) });
  const path = await targets.write('locals.pyc', pycFile(PYC_313, body));

  const { record } = await inspectPythonPycFromPath(path);

  expect(record.code_objects[0]).toMatchObject({ localsplusnames: ['a', 'b'], localspluskinds_hex: '1020' });
});

const pycErrorCases: readonly { name: string; detail: string; reason: string; bytes: Buffer; options?: PycOptions }[] = [
  { name: 'a truncated header', detail: 'pyc header must be 16 bytes.', reason: 'invalid_format', bytes: Buffer.alloc(15) },
  { name: 'an unknown magic word', detail: 'unsupported pyc magic 0x1.', reason: 'invalid_format', bytes: pycFile(1, modernBody()) },
  { name: 'a non-code marshal root', detail: 'top-level marshal object is not a code object.', reason: 'invalid_format', bytes: marshalPyc(PYC_313, marshal.int(4)) },
  {
    name: 'a truncated marshal stream',
    detail: 'marshal stream truncated',
    reason: 'invalid_format',
    bytes: Buffer.concat([pycHeader(PYC_313), marshalFlag('c'), byte(1, 2, 3)]),
  },
  { name: 'an unsupported marshal type', detail: 'unsupported marshal type 36 ($)', reason: 'invalid_format', bytes: marshalPyc(PYC_313, byte(36, 0, 0, 0, 0)) },
  { name: 'an unsupported binary marshal type', detail: 'unsupported marshal type 1 (bin)', reason: 'invalid_format', bytes: marshalPyc(PYC_313, byte(1)) },
  { name: 'a marshal ref outside the table', detail: 'marshal ref out of range', reason: 'invalid_format', bytes: marshalPyc(PYC_313, marshal.ref(0)) },
  {
    name: 'a marshal object count above max_objects',
    detail: 'marshal exceeds max_objects=1',
    reason: 'invalid_format',
    bytes: pycFile(PYC_313, modernBody()),
    options: { maxObjects: 1 },
  },
  {
    name: 'a marshal nesting depth above max_depth',
    detail: 'marshal exceeds max_depth=1',
    reason: 'invalid_format',
    bytes: pycFile(PYC_313, modernBody({ consts: marshal.tuple(marshal.code(modernBody())) })),
    options: { maxDepth: 1 },
  },
  {
    name: 'a string length above max_string_bytes',
    detail: 'string length out of range',
    reason: 'invalid_format',
    bytes: pycFile(PYC_313, modernBody()),
    options: { maxStringBytes: 2 },
  },
  {
    name: 'a short string length above max_string_bytes',
    detail: 'string length out of range',
    reason: 'invalid_format',
    bytes: pycFile(
      PYC_313,
      modernBody({
        code: marshal.bytes(byte(0)),
        consts: marshal.tuple(marshal.shortAscii('abc')),
        filename: marshal.str('a'),
        name: marshal.str('b'),
        qualname: marshal.str('c'),
      }),
    ),
    options: { maxStringBytes: 2 },
  },
  {
    name: 'a negative sequence size',
    detail: 'sequence size out of range',
    reason: 'invalid_format',
    bytes: pycFile(PYC_313, modernBody({ consts: Buffer.concat([marshalFlag('['), i32(-1)]) })),
  },
  {
    name: 'a file above max_file_bytes',
    detail: 'file exceeds max_file_bytes=31',
    reason: 'invalid_value',
    bytes: pycFile(PYC_313, modernBody()),
    options: { maxFileBytes: 31 },
  },
];

test.for(pycErrorCases)('pyc rejects $name', async (errorCase) => {
  const targets = await tempTargets();
  const path = await targets.write('broken.pyc', errorCase.bytes);

  const payload = await payloadOf(() => inspectPythonPycFromPath(path, errorCase.options ?? {}));

  expect(payload).toMatchObject(pycInputError(path, errorCase.reason, errorCase.detail));
});

test('pyc rejects a missing file', async () => {
  const targets = await tempTargets();
  const path = join(targets.dir, 'missing.pyc');

  const payload = await payloadOf(() => inspectPythonPycFromPath(path));

  expect(payload).toMatchObject(pycInputError(path, 'invalid_value', 'no file exists there'));
});

test('pyc rejects a directory path', async () => {
  const targets = await tempTargets();

  const payload = await payloadOf(() => inspectPythonPycFromPath(targets.dir));

  expect(payload).toMatchObject(pycInputError(targets.dir, 'invalid_value', 'it could not be read (EISDIR: illegal operation on a directory, read)'));
});

// Model artifacts

const ggufString = (text: string): Buffer => {
  const data = Buffer.from(text, 'utf8');
  return Buffer.concat([u64(data.length), data]);
};

interface GgufEntry {
  readonly key: string;
  readonly type: number;
  readonly value: Buffer;
}

const ggufEntry = (key: string, type: number, value: Buffer): Buffer => Buffer.concat([ggufString(key), u32(type), value]);

const ggufFile = (version: number, entries: readonly Buffer[], tensors: readonly Buffer[]): Buffer => Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(version), u64(tensors.length), u64(entries.length), ...entries, ...tensors]);

const ggufTensor = (name: string, shape: readonly number[], typeId: number, dataOffset: number): Buffer => Buffer.concat([ggufString(name), u32(shape.length), ...shape.map((dim) => u64(dim)), u32(typeId), u64(dataOffset)]);

const safetensorsFile = (header: Record<string, unknown>, data: Buffer = Buffer.alloc(0)): Buffer => {
  const text = Buffer.from(JSON.stringify(header), 'utf8');
  return Buffer.concat([u64(text.length), text, data]);
};

const modelInputError = (path: string, reason: string, detail: string) => ({
  code: 'invalid_request',
  category: 'invalid_input',
  details: {
    operation: 'inspect_model_artifact',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  },
});

test('model decodes every GGUF metadata value type', async () => {
  const targets = await tempTargets();
  const entries: readonly GgufEntry[] = [
    { key: 'u8', type: 0, value: byte(255) },
    { key: 'i8', type: 1, value: byte(0xff) },
    { key: 'u16', type: 2, value: byte(0xff, 0xff) },
    { key: 'i16', type: 3, value: byte(0x00, 0x80) },
    { key: 'u32', type: 4, value: u32(4_294_967_295) },
    { key: 'i32', type: 5, value: i32(-2_147_483_648) },
    { key: 'f32', type: 6, value: f32(1.5) },
    { key: 'bool-true', type: 7, value: byte(2) },
    { key: 'bool-false', type: 7, value: byte(0) },
    { key: 'string', type: 8, value: ggufString('hello') },
    { key: 'array', type: 9, value: Buffer.concat([u32(4), u64(3), u32(1), u32(2), u32(3)]) },
    { key: 'array-long', type: 9, value: Buffer.concat([u32(0), u64(10), ...Array.from({ length: 10 }, (_, index) => byte(index))]) },
    { key: 'u64', type: 10, value: u64(18_446_744_073_709_551_615n) },
    { key: 'i64', type: 11, value: byte(0, 0, 0, 0, 0, 0, 0, 0x80) },
    { key: 'f64', type: 12, value: f64(2.5) },
  ];
  const bytes = ggufFile(
    3,
    entries.map((entry) => ggufEntry(entry.key, entry.type, entry.value)),
    [],
  );
  const path = await targets.write('types.gguf', bytes);

  const { record } = await inspectModelArtifactFromPath(path);

  expect(record.metadata.map((entry) => [entry.index, entry.key, entry.type, entry.value, entry.element_type, entry.element_count, entry.preview_complete])).toStrictEqual([
    [0, 'u8', 'UINT8', 255, null, null, true],
    [1, 'i8', 'INT8', -1, null, null, true],
    [2, 'u16', 'UINT16', 65_535, null, null, true],
    [3, 'i16', 'INT16', -32_768, null, null, true],
    [4, 'u32', 'UINT32', 4_294_967_295, null, null, true],
    [5, 'i32', 'INT32', -2_147_483_648, null, null, true],
    [6, 'f32', 'FLOAT32', 1.5, null, null, true],
    [7, 'bool-true', 'BOOL', true, null, null, true],
    [8, 'bool-false', 'BOOL', false, null, null, true],
    [9, 'string', 'STRING', 'hello', null, null, true],
    [10, 'array', 'ARRAY', [1, 2, 3], 'UINT32', 3, true],
    [11, 'array-long', 'ARRAY', [0, 1, 2, 3, 4, 5, 6, 7], 'UINT8', 10, false],
    [12, 'u64', 'UINT64', '18446744073709551615', null, null, true],
    [13, 'i64', 'INT64', '-9223372036854775808', null, null, true],
    [14, 'f64', 'FLOAT64', 2.5, null, null, true],
  ]);
  expect(record.artifact).toStrictEqual({
    path,
    file_size: bytes.length,
    header_sha256: sha256Hex(bytes),
    header_length: bytes.length,
    sha256: null,
    bytes_read: bytes.length,
    read_scope: 'header',
  });
  expect(record.tensors).toStrictEqual([]);
  expect(record.totals).toStrictEqual({ confidence: 'derived', parameter_count: '0', tensor_bytes: 0, by_type: [] });
});

test('model derives tensor totals from declared shapes', async () => {
  const targets = await tempTargets();
  const tensors = [ggufTensor('weight', [2, 2], 0, 0), ggufTensor('bias', [4], 1, 16)];
  const bytes = ggufFile(2, [], tensors);
  const path = await targets.write('totals.gguf', bytes);

  const { record } = await inspectModelArtifactFromPath(path);

  expect(record.version).toBe(2);
  expect(record.alignment).toBe(32);
  expect(record.tensor_data_offset % 32).toBe(0);
  expect(record.artifact.header_length).toBe(bytes.length);
  expect(record.tensor_data_offset).toBeGreaterThanOrEqual(record.artifact.header_length);
  expect(record.tensors).toStrictEqual([
    {
      index: 0,
      name: 'weight',
      type: 'F32',
      type_id: 0,
      shape: ['2', '2'],
      data_offset: 0,
      file_offset: record.tensor_data_offset,
      byte_length: 16,
      parameter_count: '4',
      byte_length_state: 'derived',
      storage_validation: 'consistent',
      source_offset: expect.any(Number),
      source_length: expect.any(Number),
      json_pointer: null,
    },
    expect.objectContaining({ index: 1, name: 'bias', type: 'F16', file_offset: record.tensor_data_offset + 16, byte_length: 8, parameter_count: '4' }),
  ]);
  expect(record.totals).toStrictEqual({
    confidence: 'derived',
    parameter_count: '8',
    tensor_bytes: 24,
    by_type: [
      { type: 'F32', tensors: 1, parameter_count: '4', bytes: 16 },
      { type: 'F16', tensors: 1, parameter_count: '4', bytes: 8 },
    ],
  });
  expect(record.coverage).toStrictEqual({
    header: 'complete',
    tensor_data: 'not-interpreted',
    array_values: 'complete',
    tensor_ranges: 'complete',
    storage_sizes: 'complete',
  });
});

test('model marks quantized storage as unknown', async () => {
  const targets = await tempTargets();
  const path = await targets.write('quant.gguf', ggufFile(3, [], [ggufTensor('q', [8], 2, 0)]));

  const { record } = await inspectModelArtifactFromPath(path);

  expect(record.tensors[0]).toMatchObject({ type: 'Q4_0', byte_length: null, byte_length_state: 'unknown', storage_validation: 'unknown' });
  expect(record.totals).toStrictEqual({
    confidence: 'unknown',
    parameter_count: '8',
    tensor_bytes: null,
    by_type: [{ type: 'Q4_0', tensors: 1, parameter_count: '8', bytes: null }],
  });
  expect(record.coverage.storage_sizes).toBe('unknown');
});

test('model names an unknown GGML tensor type', async () => {
  const targets = await tempTargets();
  const path = await targets.write('unknown.gguf', ggufFile(3, [], [ggufTensor('x', [1], 99, 0)]));

  const { record } = await inspectModelArtifactFromPath(path);

  expect(record.tensors[0]).toMatchObject({ type: 'GGML_99', type_id: 99, byte_length: null, parameter_count: '1' });
  expect(record.totals.by_type).toStrictEqual([{ type: 'GGML_99', tensors: 1, parameter_count: '1', bytes: null }]);
});

test('model reads safetensors metadata plus declarations', async () => {
  const targets = await tempTargets();
  const header = {
    __metadata__: { format: 'pt', note: 7 },
    weight: { dtype: 'F32', shape: [2, 2], data_offsets: [0, 16] },
    weird: { dtype: 'WEIRD', shape: [3], data_offsets: [16, 19] },
    partial: { dtype: 'F32', shape: [2], data_offsets: [19, 23] },
  };
  const bytes = safetensorsFile(header, Buffer.alloc(23));
  const path = await targets.write('tensors.safetensors', bytes);
  const headerLength = Buffer.byteLength(JSON.stringify(header), 'utf8');

  const { record } = await inspectModelArtifactFromPath(path);

  expect(record.artifact).toStrictEqual({
    path,
    file_size: 8 + headerLength + 23,
    header_sha256: sha256Hex(bytes.subarray(0, 8 + headerLength)),
    header_length: 8 + headerLength,
    sha256: null,
    bytes_read: 8 + headerLength,
    read_scope: 'header',
  });
  expect(record.metadata).toStrictEqual([
    {
      index: 0,
      key: 'format',
      type: 'string',
      value: 'pt',
      element_type: null,
      element_count: null,
      preview_complete: true,
      source_offset: 8,
      source_length: headerLength,
      json_pointer: '/__metadata__/format',
    },
    expect.objectContaining({ index: 1, key: 'note', type: 'number', value: 7, json_pointer: '/__metadata__/note' }),
  ]);
  expect(record.tensors).toStrictEqual([
    {
      index: 0,
      name: 'weight',
      type: 'F32',
      type_id: null,
      shape: ['2', '2'],
      data_offset: 0,
      file_offset: 8 + headerLength,
      byte_length: 16,
      parameter_count: '4',
      byte_length_state: 'declared',
      storage_validation: 'consistent',
      source_offset: 8,
      source_length: headerLength,
      json_pointer: '/weight',
    },
    expect.objectContaining({ index: 1, name: 'weird', type: 'WEIRD', shape: ['3'], data_offset: 16, byte_length: 3, storage_validation: 'consistent' }),
    expect.objectContaining({ index: 2, name: 'partial', type: 'F32', shape: ['2'], data_offset: 19, byte_length: 4, storage_validation: 'unknown' }),
  ]);
  expect(record.totals).toStrictEqual({
    confidence: 'derived',
    parameter_count: '9',
    tensor_bytes: 23,
    by_type: [
      { type: 'F32', tensors: 2, parameter_count: '6', bytes: 20 },
      { type: 'WEIRD', tensors: 1, parameter_count: '3', bytes: 3 },
    ],
  });
  expect(record.coverage).toStrictEqual({
    header: 'complete',
    tensor_data: 'not-interpreted',
    array_values: 'complete',
    tensor_ranges: 'complete',
    storage_sizes: 'complete',
  });
});

test('model hashes the whole file in full mode', async () => {
  const path = fixturePath('targets/models/tiny.safetensors');

  const header = await inspectModelArtifactFromPath(path);
  const full = await inspectModelArtifactFromPath(path, { hash: 'full' });

  expect(header.record.artifact).toMatchObject({ sha256: null, bytes_read: 101, read_scope: 'header' });
  expect(full.record.artifact).toMatchObject({ sha256: sha256Hex(await readFile(path)), bytes_read: 117, read_scope: 'full', header_length: 101 });
  expect(full.record.coverage.tensor_data).toBe('hashed');
  expect(full.record.totals).toStrictEqual({
    confidence: 'derived',
    parameter_count: '4',
    tensor_bytes: 16,
    by_type: [{ type: 'F32', tensors: 1, parameter_count: '4', bytes: 16 }],
  });
});

test('model reads the tiny.gguf fixture header exactly', async () => {
  const path = fixturePath('targets/models/tiny.gguf');

  const { record } = await inspectModelArtifactFromPath(path);

  expect(record.artifact).toMatchObject({ header_length: 150, file_size: 176, bytes_read: 150, read_scope: 'header' });
  expect(record.tensor_data_offset).toBe(160);
  expect(record.metadata.map((entry) => [entry.key, entry.type, entry.value])).toStrictEqual([
    ['general.architecture', 'STRING', 'demo'],
    ['general.name', 'STRING', 'tiny'],
  ]);
  expect(record.tensors[0]).toMatchObject({ name: 'weight', type: 'F32', shape: ['2', '2'], file_offset: 160, byte_length: 16, source_offset: 104, source_length: 46 });
});

test('model hashes a GGUF file in full mode from a relative cwd', async () => {
  const targets = await tempTargets();
  const bytes = await readFile(fixturePath('targets/models/tiny.gguf'));
  await targets.write('tiny.gguf', bytes);

  const { record, resolvedPath } = await inspectModelArtifactFromPath('tiny.gguf', { hash: 'full', cwd: targets.dir });

  expect(resolvedPath).toBe(join(targets.dir, 'tiny.gguf'));
  expect(record.artifact).toStrictEqual({
    path: 'tiny.gguf',
    file_size: 176,
    header_sha256: sha256Hex(bytes.subarray(0, 150)),
    header_length: 150,
    sha256: sha256Hex(bytes),
    bytes_read: 176,
    read_scope: 'full',
  });
  expect(record.coverage.tensor_data).toBe('hashed');
});

const modelErrorCases: readonly { name: string; detail: string; reason: string; bytes: Buffer; options?: { hash: string } }[] = [
  { name: 'a GGUF magic without a header', detail: 'the file is not a GGUF container.', reason: 'invalid_format', bytes: Buffer.from('GGUF', 'ascii') },
  { name: 'a foreign magic', detail: 'safetensors header length is invalid.', reason: 'invalid_format', bytes: Buffer.concat([Buffer.from('NOPE', 'ascii'), Buffer.alloc(20)]) },
  { name: 'an unsupported GGUF version', detail: 'unsupported GGUF version 4.', reason: 'invalid_format', bytes: ggufFile(4, [], []) },
  {
    name: 'GGUF counts beyond the cap',
    detail: 'GGUF counts are out of range.',
    reason: 'invalid_format',
    bytes: Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(3), u64(0), u64(1_048_577)]),
  },
  {
    name: 'a tensor rank beyond the cap',
    detail: 'tensor rank is out of range.',
    reason: 'invalid_format',
    bytes: ggufFile(3, [], [Buffer.concat([ggufString('t'), u32(17)])]),
  },
  { name: 'a file too short for either format', detail: 'the file is neither GGUF nor safetensors.', reason: 'invalid_format', bytes: Buffer.from('nope', 'ascii') },
  { name: 'a zero safetensors header length', detail: 'safetensors header length is invalid.', reason: 'invalid_format', bytes: u64(0) },
  {
    name: 'a safetensors header past the file end',
    detail: 'safetensors header length is invalid.',
    reason: 'invalid_format',
    bytes: Buffer.concat([u64(100), Buffer.alloc(8)]),
  },
  {
    name: 'a non-JSON safetensors header',
    detail: 'safetensors header is not JSON.',
    reason: 'invalid_format',
    bytes: Buffer.concat([u64(4), Buffer.from('nope', 'ascii')]),
  },
  { name: 'a safetensors header array', detail: 'safetensors header must be an object.', reason: 'invalid_format', bytes: Buffer.concat([u64(3), Buffer.from('[1]', 'ascii')]) },
  { name: 'a non-object tensor declaration', detail: 'tensor declaration w is not an object.', reason: 'invalid_format', bytes: safetensorsFile({ w: 5 }) },
  {
    name: 'a tensor declaration without fields',
    detail: 'tensor declaration w is missing dtype/shape/data_offsets.',
    reason: 'invalid_format',
    bytes: safetensorsFile({ w: { dtype: 'F32' } }),
  },
  {
    name: 'a tensor declaration with one offset',
    detail: 'tensor declaration w is missing dtype/shape/data_offsets.',
    reason: 'invalid_format',
    bytes: safetensorsFile({ w: { dtype: 'F32', shape: [1], data_offsets: [0] } }),
  },
  {
    name: 'a tensor declaration with reversed offsets',
    detail: 'tensor w has invalid data_offsets.',
    reason: 'invalid_format',
    bytes: safetensorsFile({ w: { dtype: 'F32', shape: [1], data_offsets: [4, 0] } }),
  },
  {
    name: 'an unsupported hash mode',
    detail: 'hash must be header or full.',
    reason: 'invalid_value',
    bytes: safetensorsFile({ w: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } }),
    options: { hash: 'sha1' },
  },
];

test.for(modelErrorCases)('model rejects $name', async (errorCase) => {
  const targets = await tempTargets();
  const path = await targets.write('broken.model', errorCase.bytes);
  const options = (errorCase.options ?? {}) as { hash: 'header' | 'full' };

  const payload = await payloadOf(() => inspectModelArtifactFromPath(path, options));

  expect(payload).toMatchObject(modelInputError(path, errorCase.reason, errorCase.detail));
});

const modelReaderErrorCases: readonly { name: string; detail: string; bytes: Buffer }[] = [
  { name: 'a metadata key length beyond the cap', detail: 'string length out of range', bytes: Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(3), u64(0), u64(1), u64(2_000_000)]) },
  { name: 'a truncated metadata type word', detail: 'truncated at u32', bytes: Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(3), u64(0), u64(1), ggufString('k')]) },
  { name: 'an unsupported metadata type', detail: 'unsupported GGUF metadata type 13', bytes: ggufFile(3, [ggufEntry('k', 13, Buffer.alloc(0))], []) },
  { name: 'an array count beyond the cap', detail: 'array count out of range', bytes: ggufFile(3, [ggufEntry('k', 9, Buffer.concat([u32(4), u64(1_048_577)]))], []) },
  { name: 'a truncated tensor dimension', detail: 'truncated at u64', bytes: ggufFile(3, [], [Buffer.concat([ggufString('t'), u32(2), u64(2)])]) },
];

test.for(modelReaderErrorCases)('model raises a bare Error for $name', async (errorCase) => {
  const targets = await tempTargets();
  const path = await targets.write('broken.model', errorCase.bytes);

  const error = await rejectionOf(() => inspectModelArtifactFromPath(path));

  expect({ name: (error as Error).name, message: (error as Error).message }).toStrictEqual({ name: 'Error', message: errorCase.detail });
  expect((error as ReaError).payload).toBeUndefined();
});

test('model rejects a missing model file', async () => {
  const targets = await tempTargets();
  const path = join(targets.dir, 'missing.gguf');

  const payload = await payloadOf(() => inspectModelArtifactFromPath(path));

  expect(payload).toMatchObject(modelInputError(path, 'invalid_value', 'no file exists there'));
});

test('model rejects a directory path', async () => {
  const targets = await tempTargets();

  const payload = await payloadOf(() => inspectModelArtifactFromPath(targets.dir));

  expect(payload).toMatchObject(modelInputError(targets.dir, 'invalid_value', 'it could not be read (EISDIR: illegal operation on a directory, read)'));
});

// Web script export

const captureText = (body: Record<string, unknown>, overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    evidence_id: `ev_${'a'.repeat(64)}`,
    subject: {},
    provider: {},
    analysis_profile: {},
    predicate_type: 'rea.web-page-inspection',
    operation: 'inspect_web_page',
    parameters: {},
    raw_result: {},
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: {},
    limitations: [],
    relationship_coverage: {},
    locations: [],
    evidence_links: [],
    normalized_result: body,
    ...overrides,
  });

test('web export writes script sources with stable relative paths', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write(
    'capture.json',
    captureText({
      script_sources: [
        { url: 'https://example.com/app.js', text: 'export const a = 1;\n' },
        { url: 'https://example.com/app.js', text: 'duplicate();' },
        { text: 'inline();' },
        { source_url: 'https://example.com/dir/', source: 'dirIndex();' },
        { url: 'https://example.com/bare', bytes_utf8: 'bare();' },
        { url: 'https://example.com/y.js?v=2', text: 'versioned();' },
        { url: 'https://example.com/mod.mjs', text: 'esm();' },
        { url: 'https://example.com/mod.cjs', text: 'cjs();' },
        { url: 'https://example.com/deep/nested/leaf.js', text: 'leaf();' },
      ],
    }),
  );
  const output = join(targets.dir, 'out');

  const result = await exportWebScripts({ capture_path: capturePath, output_directory: output });

  expect(result.scripts.map((script) => script.relative_path)).toStrictEqual([
    'app.js',
    'app.1.js',
    `inline/${sha256Hex('inline-2.js').slice(0, 16)}.js`,
    'dir/index.js',
    'bare.js',
    `y.${sha256Hex('?v=2').slice(0, 8)}.js`,
    'mod.mjs',
    'mod.cjs',
    'deep/nested/leaf.js',
  ]);
  expect(result.scripts.every((script) => script.source === 'script_sources')).toBe(true);
  expect(result.scripts[1]).toStrictEqual({
    url: 'https://example.com/app.js',
    relative_path: 'app.1.js',
    sha256: sha256Hex('duplicate();'),
    bytes: 12,
    source: 'script_sources',
  });
  expect(await readFile(join(output, 'app.1.js'), 'utf8')).toBe('duplicate();');
  expect(await readFile(join(output, 'deep/nested/leaf.js'), 'utf8')).toBe('leaf();');
  expect(result.unavailable).toStrictEqual([]);
  expect(result.capture_kind).toBe('page-inspection');
  expect(result.source_evidence_id).toBe(`ev_${'a'.repeat(64)}`);
  expect(result.capture_sha256).toBe(sha256Hex(await readFile(capturePath, 'utf8')));
  expect(result.analysis_input).toStrictEqual({ input_path: output, format: 'directory' });
  expect(result.manifest_path).toBe(join(output, 'manifest.json'));
  const manifestText = await readFile(result.manifest_path, 'utf8');
  expect(result.manifest_sha256).toBe(sha256Hex(manifestText));
  expect(JSON.parse(manifestText)).toStrictEqual({
    capture_path: capturePath,
    capture_sha256: result.capture_sha256,
    capture_kind: 'page-inspection',
    source_evidence_id: `ev_${'a'.repeat(64)}`,
    scripts: result.scripts,
    unavailable: [],
  });
});

test('web export selects network bodies by MIME type or suffix', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write(
    'capture.json',
    captureText({
      network_requests: [
        { url: 'https://cdn.example.com/lib.js', response_body: 'lib();' },
        { url: 'https://cdn.example.com/data', response_body_text: 'mime();', mime_type: 'application/javascript' },
        { url: 'https://cdn.example.com/style.css', response_body: 'body{}', mime_type: 'text/css' },
        { url: 'https://cdn.example.com/logo.png', mime_type: 'image/png' },
        { response_body: 'skip();', mime_type: 'text/plain' },
        { response_body: 'anon();', resource_type: 'text/javascript' },
      ],
    }),
  );
  const output = join(targets.dir, 'out');

  const result = await exportWebScripts({ capture_path: capturePath, output_directory: output });

  expect(result.scripts.map((script) => [script.url, script.relative_path, script.source])).toStrictEqual([
    ['https://cdn.example.com/lib.js', 'lib.js', 'network_response_body'],
    ['https://cdn.example.com/data', 'data.js', 'network_response_body'],
    ['network-2.js', `inline/${sha256Hex('network-2.js').slice(0, 16)}.js`, 'network_response_body'],
  ]);
  expect(await readFile(join(output, 'lib.js'), 'utf8')).toBe('lib();');
});

test('web export reads the alternate network capture key', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write('capture.json', captureText({ network: [{ url: 'https://cdn.example.com/alt.js', response_body: 'alt();' }] }));

  const result = await exportWebScripts({ capture_path: capturePath, output_directory: join(targets.dir, 'out') });

  expect(result.scripts.map((script) => script.relative_path)).toStrictEqual(['alt.js']);
});

test('web export leaves the evidence id null for an anonymous capture', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write('capture.json', captureText({ script_sources: [{ url: 'https://example.com/anon.js', text: 'a();' }] }, { evidence_id: undefined }));

  const result = await exportWebScripts({ capture_path: capturePath, output_directory: join(targets.dir, 'out') });

  expect(result.source_evidence_id).toBeNull();
  expect(result.scripts.map((script) => script.relative_path)).toStrictEqual(['anon.js']);
});

test('web export lists captures without retained script bytes', async () => {
  const targets = await tempTargets();
  const missingText = await targets.write('missing.json', captureText({ script_sources: [{ url: 'https://example.com/a.js' }] }));
  const empty = await targets.write('empty.json', captureText({}));

  const missing = await exportWebScripts({ capture_path: missingText, output_directory: join(targets.dir, 'missing-out') });
  const emptyResult = await exportWebScripts({ capture_path: empty, output_directory: join(targets.dir, 'empty-out') });

  expect(missing.scripts).toStrictEqual([]);
  expect(missing.unavailable).toStrictEqual([{ url: 'https://example.com/a.js', reason: 'script_source_bytes_absent' }]);
  expect(missing.analysis_input).toBeNull();
  expect(emptyResult.unavailable).toStrictEqual([{ url: null, reason: 'no_retained_script_bytes' }]);
});

test.for([
  { name: 'a capture_browser_scenario operation', body: { script_sources: [{ url: 'https://example.com/s.js', text: 's();' }] }, operation: 'capture_browser_scenario' },
  { name: 'a scenario field inside the page inspection', body: { script_sources: [{ url: 'https://example.com/s.js', text: 's();' }], scenario: {} }, operation: 'inspect_web_page' },
] as const)('web export labels $name', async (scenarioCase) => {
  const targets = await tempTargets();
  const capturePath = await targets.write('capture.json', captureText(scenarioCase.body, { operation: scenarioCase.operation }));
  const output = join(targets.dir, 'out');

  const result = await exportWebScripts({ capture_path: capturePath, output_directory: output });

  expect(result.capture_kind).toBe('browser-scenario');
  const manifest = JSON.parse(await readFile(result.manifest_path, 'utf8')) as Record<string, unknown>;
  expect(manifest['capture_kind']).toBe('browser-scenario');
  expect(manifest['scripts']).toStrictEqual(result.scripts);
});

test.for([{ envelope: 'ok-data' }, { envelope: 'result' }] as const)('web export unwraps $envelope envelopes', async (envelopeCase) => {
  const targets = await tempTargets();
  const body = { evidence_id: `ev_${'b'.repeat(64)}`, script_sources: [{ url: 'https://example.com/env.js', text: 'env();' }] };
  const base = JSON.parse(captureText(body)) as Record<string, unknown>;
  const raw = envelopeCase.envelope === 'ok-data' ? { ...base, ok: true, data: body } : { ...base, result: body };
  const capturePath = await targets.write('capture.json', JSON.stringify(raw));

  const result = await exportWebScripts({ capture_path: capturePath, output_directory: join(targets.dir, 'out') });

  expect(result.scripts.map((script) => script.relative_path)).toStrictEqual(['env.js']);
  expect(result.source_evidence_id).toBe(`ev_${'b'.repeat(64)}`);
});

test('web export refuses an existing output directory', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write('capture.json', captureText({}));
  const output = join(targets.dir, 'existing');
  await mkdir(output);

  const payload = await payloadOf(() => exportWebScripts({ capture_path: capturePath, output_directory: output }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'export_web_scripts output_directory must be absent.',
    details: { operation: 'export_web_scripts', parameter: 'output_directory' },
  });
});

const webErrorCases: readonly { name: string; message: string; parameter: string; capture: string; output: string; contents?: string }[] = [
  { name: 'a relative capture path', message: 'export_web_scripts capture_path must be an absolute local path.', parameter: 'capture_path', capture: 'relative.json', output: 'absolute' },
  { name: 'an empty capture path', message: 'export_web_scripts capture_path must be an absolute local path.', parameter: 'capture_path', capture: '', output: 'absolute' },
  { name: 'a relative output directory', message: 'export_web_scripts output_directory must be an absolute local path.', parameter: 'output_directory', capture: 'capture.json', output: 'out' },
  {
    name: 'a non-JSON capture',
    message: 'export_web_scripts capture_path must contain JSON.',
    parameter: 'capture_path',
    capture: 'capture.json',
    output: 'absolute',
    contents: 'not json',
  },
];

test.for(webErrorCases)('web export rejects $name', async (errorCase) => {
  const targets = await tempTargets();
  const capturePath = errorCase.capture === 'capture.json' ? await targets.write('capture.json', errorCase.contents ?? captureText({})) : errorCase.capture;
  const output = errorCase.output === 'absolute' ? join(targets.dir, 'out') : errorCase.output;

  const payload = await payloadOf(() => exportWebScripts({ capture_path: capturePath, output_directory: output }));

  expect(payload).toMatchObject({ code: 'invalid_request', details: { operation: 'export_web_scripts', parameter: errorCase.parameter }, message: errorCase.message });
});

test('web export rejects an unreadable capture path', async () => {
  const targets = await tempTargets();
  const capturePath = join(targets.dir, 'missing.json');

  const payload = await payloadOf(() => exportWebScripts({ capture_path: capturePath, output_directory: join(targets.dir, 'out') }));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: `Selected capture could not be read (ENOENT): ${capturePath}`,
    retryable: true,
    remediation: { action: `Selected capture could not be read (ENOENT): ${capturePath}` },
    details: {
      operation: 'export_web_scripts',
      parameter: 'capture_path',
      issues: [{ path: ['capture_path'], reason: 'invalid_value', message: `Selected capture could not be read (ENOENT): ${capturePath}` }],
    },
  });
});

test('web export refuses an incomplete capture envelope', async () => {
  const targets = await tempTargets();
  const fixture = await targets.write('page.json', await readFile(fixturePath('targets/web/page-capture.json'), 'utf8'));

  const payload = await payloadOf(() => exportWebScripts({ capture_path: fixture, output_directory: join(targets.dir, 'out') }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    category: 'invalid_input',
    retryable: false,
    recovery: { kind: 'inspect_input_contract', operation: 'export_web_scripts' },
    details: { operation: 'export_web_scripts', issues: [{ path: ['capture_path'], reason: 'invalid_format' }] },
  });
  const issues = payload.details?.['issues'] as { message: string }[];
  expect(issues[0]?.message).toContain('Invalid option: expected one of \\"observed\\"|\\"derived\\"|\\"inferred\\"');
});

test('web export refuses a non-object capture document', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write('array.json', '[]');

  const payload = await payloadOf(() => exportWebScripts({ capture_path: capturePath, output_directory: join(targets.dir, 'out') }));

  expect(payload).toMatchObject({ code: 'invalid_request', retryable: false, details: { issues: [{ path: ['capture_path'], reason: 'invalid_format' }] } });
});

test('web export refuses an unfamiliar capture operation', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write('capture.json', captureText({}, { operation: 'inspect_pe_imports' }));

  const payload = await payloadOf(() => exportWebScripts({ capture_path: capturePath, output_directory: join(targets.dir, 'out') }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'Expected a valid inspect_web_page or capture_browser_scenario capture, with retained script sources or response bytes. Evidence envelopes must have a matching operation and semantic identifier.',
    details: { operation: 'export_web_scripts', parameter: 'capture_path' },
  });
});

test('web export refuses a non-object embedded capture body', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write('capture.json', JSON.stringify({ ...JSON.parse(captureText({})), ok: true, data: 42 }));

  const payload = await payloadOf(() => exportWebScripts({ capture_path: capturePath, output_directory: join(targets.dir, 'out') }));

  expect(payload).toMatchObject({ code: 'invalid_request', message: 'export_web_scripts capture must be a JSON object.' });
});

// Artifact extraction

interface ZipMember {
  readonly name: string;
  readonly data?: Buffer;
  readonly crc?: number;
}

const storedZip = (members: readonly ZipMember[], options: { corruptLocalAt?: number } = {}): { bytes: Buffer; localOffsets: number[] } => {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  const localOffsets: number[] = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const data = member.data ?? Buffer.alloc(0);
    const crc = member.crc ?? crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localOffsets.push(offset);
    const block = Buffer.concat([local, name, data]);
    chunks.push(block);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, name]));
    offset += block.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const bytes = Buffer.concat([...chunks, directory, end]);
  if (options.corruptLocalAt !== undefined) {
    const localOffset = localOffsets[options.corruptLocalAt];
    if (localOffset !== undefined) bytes.writeUInt32LE(0, localOffset);
  }
  return { bytes, localOffsets };
};

test('extract materializes the fixture.zip members', async () => {
  const bytes = await readFile(fixturePath('targets/fixture.zip'));
  const rootSha256 = sha256Hex(bytes);

  const result = await extractZipArtifact(bytes, { rootSha256, rootFormat: 'zip' });

  expect(result.artifacts.map((row) => [row.relative_path, row.bytes_written])).toStrictEqual([
    ['app.js', 26],
    ['manifest.json', 40],
  ]);
  expect(result.containment_verified).toBe(true);
  expect(result.manifest).toStrictEqual({
    manifest_id: `agm_${rootSha256}`,
    root_artifact_id: `art_${rootSha256}`,
    root_sha256: rootSha256,
    root_format: 'zip',
    graph_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    node_count: 3,
    occurrence_count: 3,
    edge_count: 2,
  });
  expect(result.extraction_manifest).toMatchObject({
    source_manifest_id: `agm_${rootSha256}`,
    output_root_alias: '$OUTPUT_ROOT',
    selected_occurrence_ids: [expect.stringMatching(/^occ_[a-f0-9]{64}$/), expect.stringMatching(/^occ_[a-f0-9]{64}$/)],
  });
  expect(result.cleanup).toStrictEqual({ attempted: false, verified: true, residual_paths: [] });
  expect(result.coverage).toStrictEqual({ scope: 'container-entries', status: 'complete' });
  expect(result.integrity_contradictions).toStrictEqual([]);
  expect(result.limitations).toHaveLength(3);
  const appJs = await readFile(join(result.output_root, 'app.js'));
  expect(appJs.toString('utf8')).toBe('export const answer = 42;\n');
  expect(result.artifacts[0]?.sha256).toBe(sha256Hex(appJs));
  await rm(result.output_root, { recursive: true, force: true });
});

test('extract skips directory members or unsafe paths', async () => {
  const rootSha256 = sha256Hex('root');
  const okData = Buffer.from('ok();', 'utf8');
  const { bytes, localOffsets } = storedZip([{ name: 'folder/' }, { name: '../evil.js', data: Buffer.from('evil();', 'utf8') }, { name: '/abs.js', data: Buffer.from('abs();', 'utf8') }, { name: 'nested/ok.js', data: okData }]);

  const result = await extractZipArtifact(bytes, { rootSha256, rootFormat: 'apk' });

  const okSha256 = sha256Hex(okData);
  const occurrence = `occ_${sha256Hex(`nested/ok.js:${localOffsets[3]}:${okData.length}`)}`;
  expect(result.artifacts).toStrictEqual([{ artifact_id: `art_${okSha256}`, relative_path: 'nested/ok.js', sha256: okSha256, bytes_written: 5, created: true }]);
  expect(result.extraction_manifest.selected_occurrence_ids).toStrictEqual([occurrence]);
  expect(result.manifest.graph_sha256).toBe(sha256Hex(JSON.stringify({ root: rootSha256, occurrences: [occurrence], artifacts: [okSha256] })));
  expect(result.extraction_manifest.files_sha256).toBe(sha256Hex(`nested/ok.js:${okSha256}`));
  expect(result.manifest.root_format).toBe('apk');
  await rm(result.output_root, { recursive: true, force: true });
});

test('extract refuses a CRC mismatch under the fail policy', async () => {
  const { bytes } = storedZip([{ name: 'crc.js', data: Buffer.from('crc();', 'utf8'), crc: 0xdeadbeef }]);

  const payload = await payloadOf(() => extractZipArtifact(bytes, { rootSha256: sha256Hex('root'), rootFormat: 'zip' }));

  expect(payload).toMatchObject({
    code: 'unsupported_target',
    category: 'unsupported_target',
    message: 'Declared artifact integrity does not match for crc.js.',
    details: { reason: 'crc32' },
  });
});

test('extract records a CRC mismatch then continues', async () => {
  const data = Buffer.from('crc();', 'utf8');
  const { bytes } = storedZip([{ name: 'crc.js', data, crc: 0xdeadbeef }]);

  const result = await extractZipArtifact(bytes, { rootSha256: sha256Hex('root'), rootFormat: 'zip', integrityPolicy: 'record-and-continue' });

  expect(result.integrity_contradictions).toStrictEqual([{ logical_path: 'crc.js', reason: 'crc32', check: 'crc32', calculated_sha256: sha256Hex(data) }]);
  expect(result.coverage).toStrictEqual({ scope: 'container-entries', status: 'partial' });
  expect(result.artifacts.map((row) => row.relative_path)).toStrictEqual(['crc.js']);
  expect(await readFile(join(result.output_root, 'crc.js'), 'utf8')).toBe('crc();');
  await rm(result.output_root, { recursive: true, force: true });
});

test('extract records an unreadable member then continues', async () => {
  const { bytes } = storedZip(
    [
      { name: 'bad.js', data: Buffer.from('bad();', 'utf8') },
      { name: 'good.js', data: Buffer.from('good();', 'utf8') },
    ],
    { corruptLocalAt: 0 },
  );

  const result = await extractZipArtifact(bytes, { rootSha256: sha256Hex('root'), rootFormat: 'zip', integrityPolicy: 'record-and-continue' });

  expect(result.integrity_contradictions).toStrictEqual([{ logical_path: 'bad.js', reason: 'malformed', check: 'member-read' }]);
  expect(result.artifacts.map((row) => row.relative_path)).toStrictEqual(['good.js']);
  expect(result.coverage.status).toBe('partial');
  await rm(result.output_root, { recursive: true, force: true });
});

test('extract refuses an unreadable member under the fail policy', async () => {
  const { bytes } = storedZip([{ name: 'bad.js', data: Buffer.from('bad();', 'utf8') }], { corruptLocalAt: 0 });

  const payload = await payloadOf(() => extractZipArtifact(bytes, { rootSha256: sha256Hex('root'), rootFormat: 'zip' }));

  expect(payload).toMatchObject({ code: 'unsupported_target', message: 'Declared artifact integrity does not match for bad.js.', details: { reason: 'malformed' } });
});

test('extract refuses bytes without an end-of-central-directory', async () => {
  const payload = await payloadOf(() => extractZipArtifact(Buffer.from('not a zip at all', 'utf8'), { rootSha256: sha256Hex('root'), rootFormat: 'zip' }));

  expect(payload).toStrictEqual({
    code: 'unsupported_target',
    category: 'unsupported_target',
    message: 'ZIP extraction failed: No ZIP end-of-central-directory record was found.',
    retryable: false,
    remediation: { action: 'ZIP extraction failed: No ZIP end-of-central-directory record was found.' },
    details: { reason: 'malformed' },
  });
});

// Tool wrappers

test('inspect_sqlite_database tool resolves a relative path by cwd', async () => {
  const targets = await tempTargets();
  await targets.write('tool.db', await readFile(fixturePath('targets/fixture.db')));
  const session = new ReaSession(runtime);

  const result = await inspectSqliteDatabase(session, { path: 'tool.db', table: 'users', row_limit: 2, schema_scope: 'selected_table' }, { cwd: targets.dir });
  const record = (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;

  expect(result.structuredContent).toMatchObject({
    operation: 'inspect_sqlite_database',
    parameters: { path: 'tool.db', table: 'users', row_limit: 2, schema_scope: 'selected_table' },
  });
  const rows = record['rows'] as { columns: string[]; values: { type: string; value?: string }[][]; truncated: boolean; examined_rows: number };
  expect(rows.columns).toStrictEqual(['id', 'name', 'age', 'email']);
  expect(rows.truncated).toBe(true);
  expect(rows.examined_rows).toBe(2);
  expect([...rows.values].sort((left, right) => Number(left[0]?.value) - Number(right[0]?.value))).toStrictEqual([
    [
      { type: 'integer', value: '1' },
      { type: 'text', value: 'user1', bytes_hex: '7573657231', encoding: 'UTF-8' },
      { type: 'integer', value: '11' },
      { type: 'text', value: 'user1@example.com', bytes_hex: '7573657231406578616d706c652e636f6d', encoding: 'UTF-8' },
    ],
    [
      { type: 'integer', value: '2' },
      { type: 'text', value: 'user2', bytes_hex: '7573657232', encoding: 'UTF-8' },
      { type: 'integer', value: '12' },
      { type: 'text', value: 'user2@example.com', bytes_hex: '7573657232406578616d706c652e636f6d', encoding: 'UTF-8' },
    ],
  ]);
  expect(session.evidence.size).toBe(1);
});

test('inspect_python_pyc tool records default budget parameters', async () => {
  const session = new ReaSession(runtime);

  const result = await inspectPythonPyc(session, { path: fixturePath('targets/pyc/sample.pyc'), detail: 'summary' });
  const record = (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;

  expect(result.structuredContent).toMatchObject({
    operation: 'inspect_python_pyc',
    parameters: {
      max_file_bytes: 16_777_216,
      max_objects: 16_384,
      max_depth: 64,
      max_string_bytes: 1_048_576,
      detail: 'summary',
    },
  });
  expect(record['header']).toMatchObject({ python_version: '3.13', code_layout: 'py311' });
  expect(session.evidence.size).toBe(1);
});

test('inspect_model_artifact tool reports header scope by default', async () => {
  const session = new ReaSession(runtime);

  const result = await inspectModelArtifact(session, { path: fixturePath('targets/models/tiny.gguf') });
  const record = (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;

  expect(result.structuredContent).toMatchObject({ operation: 'inspect_model_artifact', parameters: { hash: 'header' } });
  expect(record['artifact']).toMatchObject({ sha256: null, read_scope: 'header', header_length: 150 });
  expect(session.evidence.size).toBe(1);
});

test('export_web_scripts tool records the exported manifest', async () => {
  const targets = await tempTargets();
  const capturePath = await targets.write('capture.json', captureText({ script_sources: [{ url: 'https://example.com/tool.js', text: 'tool();' }] }));
  const session = new ReaSession(runtime);

  const result = await exportWebScriptsTool(session, { capture_path: capturePath, output_directory: join(targets.dir, 'out') });
  const record = (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;

  expect(result.structuredContent).toMatchObject({ operation: 'export_web_scripts', confidence: 'derived', authority: 'historical-reference' });
  expect(record['scripts']).toStrictEqual([{ url: 'https://example.com/tool.js', relative_path: 'tool.js', sha256: sha256Hex('tool();'), bytes: 7, source: 'script_sources' }]);
  expect(session.evidence.size).toBe(1);
});

test('extract_artifact tool materializes the open ZIP target', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/fixture.zip') });

  const result = await extractArtifact(session, {});
  const record = (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;

  expect(result.structuredContent).toMatchObject({ operation: 'extract_artifact', parameters: { integrity_policy: 'fail' } });
  expect((record['artifacts'] as { relative_path: string }[]).map((row) => row.relative_path)).toStrictEqual(['app.js', 'manifest.json']);
  expect(record['containment_verified']).toBe(true);
  expect(session.evidence.size).toBe(1);
  await rm(record['output_root'] as string, { recursive: true, force: true });
});

test('extract_artifact tool refuses an unopened session', async () => {
  const session = new ReaSession(runtime);

  const payload = await payloadOf(() => extractArtifact(session));

  expect(payload).toMatchObject({ code: 'target_unavailable', category: 'unavailable' });
  expect(session.evidence.size).toBe(0);
});

test('extract_artifact tool refuses a non-ZIP target', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/minimal-elf.bin') });

  const payload = await payloadOf(() => extractArtifact(session));

  expect(payload).toMatchObject({ code: 'unsupported_target', category: 'unsupported_target', details: { detected: 'elf' } });
});

test('inspect_artifact tool reports the root manifest observation', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/fixture.zip') });

  const result = await inspectArtifact(session, { detail: 'summary' });
  const record = (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;

  expect(result.structuredContent).toMatchObject({ operation: 'inspect_artifact', parameters: { integrity_policy: 'fail', detail: 'summary' } });
  expect((record['observations'] as { value: { node_count: number } }[])[0]?.value.node_count).toBe(3);
  expect((record['coverage'] as { status: string }).status).toBe('complete-within-substeps');
  expect(session.evidence.size).toBe(2);
});

test('extract leaves no output directory behind when the fail policy rejects a member', async () => {
  const targets = await tempTargets('pi-rea-extract-leak-');
  vi.stubEnv('TMPDIR', targets.dir);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const { bytes } = storedZip([{ name: 'crc.js', data: Buffer.from('crc();', 'utf8'), crc: 0xdeadbeef }]);

  await payloadOf(() => extractZipArtifact(bytes, { rootSha256: sha256Hex('root'), rootFormat: 'zip' }));

  const extracts = (await readdir(targets.dir)).filter((name) => name.startsWith('pi-rea-extracted-'));
  expect(extracts).toStrictEqual([]);
});
