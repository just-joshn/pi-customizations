import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, test } from 'vitest';
import { inspectApkSignatureFromPath } from '../src/analysis/apk-signature.ts';
import { inspectSqliteDatabaseFromPath } from '../src/analysis/sqlite-database.ts';
import { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectDevicetree } from '../src/tools/devicetree-tools.ts';
import { inspectModelArtifact } from '../src/tools/model-artifact-tools.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };
const V2 = 0x7109871a;
const V3 = 0xf05368c0;
const V31 = 0x1b93ad61;

const u32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};

const u64 = (value: number | bigint): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const pair = (id: number, value: Buffer): Buffer => Buffer.concat([u64(4 + value.length), u32(id), value]);
const schemeValue = (signers: readonly Buffer[]): Buffer => Buffer.concat([u32(Buffer.concat(signers).length), ...signers]);

const apkWithPairs = (pairs: readonly Buffer[]): Buffer => {
  const pairBytes = Buffer.concat(pairs);
  const size = pairBytes.length + 24;
  const block = Buffer.concat([u64(size), pairBytes, u64(size), Buffer.from('APK Sig Block 42')]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(0, 12);
  eocd.writeUInt32LE(block.length, 16);
  return Buffer.concat([block, eocd]);
};

const trailingValue = (bytes: string): Buffer => Buffer.concat([schemeValue([]), Buffer.from(bytes, 'hex')]);

const modelError = async (bytes: Buffer): Promise<ReaError['payload']> => {
  const targets = await tempTargets();
  const path = await targets.write('broken.gguf', bytes);

  try {
    await inspectModelArtifact(new ReaSession(runtime), { path });
  } catch (error) {
    expect(error).toBeInstanceOf(ReaError);
    return (error as ReaError).payload;
  }
  throw new Error('inspect_model_artifact returned instead of throwing');
};

const ggufHeader = (version: number, tensorCount: number | bigint, metadataCount: number | bigint): Buffer => Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(version), u64(tensorCount), u64(metadataCount)]);

const ggufString = (text: string): Buffer => {
  const data = Buffer.from(text, 'utf8');
  return Buffer.concat([u64(data.length), data]);
};

const ggufTensor = (name: string, shape: readonly number[], typeId: number, dataOffset: number | bigint): Buffer => Buffer.concat([ggufString(name), u32(shape.length), ...shape.map((dim) => u64(dim)), u32(typeId), u64(dataOffset)]);

test('reports trailing signing-block bytes as uninterpreted and limits them', async () => {
  const targets = await tempTargets();
  const bytes = apkWithPairs([pair(V2, trailingValue('deadbeef'))]);
  const path = await targets.write('trailing.apk', bytes);

  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2).toStrictEqual({ present: true, signers: [], uninterpreted_bytes: 4 });
  expect(record.posture.schemes_agree_on_signer).toBeNull();
  expect(record.posture.strongest_scheme).toBe('v2');
  expect(record.limitations[0]).toBe('4 bytes outside known signing fields were not interpreted; suffixes do not by themselves establish malformed signing.');
  expect(record.limitations).toHaveLength(6);
});

test('sums uninterpreted bytes across present block schemes', async () => {
  const targets = await tempTargets();
  const bytes = apkWithPairs([pair(V2, trailingValue('deadbeef')), pair(V3, trailingValue('cafebabe'))]);
  const path = await targets.write('trailing-two.apk', bytes);

  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2.uninterpreted_bytes).toBe(4);
  expect(record.schemes.v3.uninterpreted_bytes).toBe(4);
  expect(record.posture.schemes_agree_on_signer).toBeNull();
  expect(record.posture.strongest_scheme).toBe('v3');
  expect(record.limitations[0]).toBe('8 bytes outside known signing fields were not interpreted; suffixes do not by themselves establish malformed signing.');
});

test('reports a declared empty v3.1 signer list with its trailing bytes', async () => {
  const targets = await tempTargets();
  const bytes = apkWithPairs([pair(V31, trailingValue('ff'))]);
  const path = await targets.write('trailing-v31.apk', bytes);

  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes['v3.1']).toStrictEqual({ present: true, signers: [], uninterpreted_bytes: 1 });
  expect(record.posture.schemes_agree_on_signer).toBeNull();
  expect(record.posture.strongest_scheme).toBe('v3.1');
  expect(record.limitations[0]).toBe('1 bytes outside known signing fields were not interpreted; suffixes do not by themselves establish malformed signing.');
});

test('reports an empty signer list without trailing bytes as zero uninterpreted', async () => {
  const targets = await tempTargets();
  const bytes = apkWithPairs([pair(V2, schemeValue([]))]);
  const path = await targets.write('empty-signers.apk', bytes);

  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2).toStrictEqual({ present: true, signers: [], uninterpreted_bytes: 0 });
  expect(record.posture.schemes_agree_on_signer).toBeNull();
  expect(record.limitations).toHaveLength(5);
});

test('maps a truncated GGUF header to the declared-extent target envelope', async () => {
  const payload = await modelError(Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(3), Buffer.from([1, 2, 3])]));

  expect(payload).toStrictEqual({
    code: 'target_unavailable',
    category: 'unsupported_target',
    message: 'Cannot open artifact: Declared header extent is outside the file.',
    retryable: false,
    remediation: { action: 'Review the reported file-format reason and select a supported, well-formed target.' },
    details: { path: expect.stringContaining('broken.gguf'), reason: 'Declared header extent is outside the file', constraint: 'file_format_rejected' },
  });
});

test('maps GGUF counts beyond exact integer precision to the host-precision envelope', async () => {
  const payload = await modelError(ggufHeader(3, 2n ** 63n - 1n, 0n));

  expect(payload).toStrictEqual({
    code: 'resource_constraint',
    category: 'resource_constraint',
    message: 'Header length/count exceeds exact host offset precision',
    retryable: false,
    remediation: {
      action: 'Exact host offset precision stops at 9007199254740991. This release has no runtime override. Additional host memory does not raise it. Repeating the unchanged request fails the same way.',
    },
    details: {
      operation: 'inspect_model_artifact',
      resource: 'memory',
      reason: 'Header length/count exceeds exact host offset precision',
      reported_limits: { maximum_exact_offset: 9007199254740991 },
    },
  });
});

test('maps GGUF counts above the analyzer cap to the retained-representation envelope', async () => {
  const payload = await modelError(ggufHeader(3, 0, 1_048_577));

  expect(payload).toStrictEqual({
    code: 'resource_constraint',
    category: 'resource_constraint',
    message: 'Model facts exceed the 32 MiB retained representation budget. This release has no runtime override.',
    retryable: false,
    remediation: {
      action: 'The retained model representation allowance is 33554432 bytes. This release has no runtime override. Additional host memory does not raise it. Repeating the unchanged request fails the same way.',
    },
    details: {
      operation: 'inspect_model_artifact',
      resource: 'memory',
      reason: 'Model facts exceed the 32 MiB retained representation budget. This release has no runtime override.',
      reported_limits: { maximum_representation_bytes: 33_554_432 },
    },
  });
});

test('maps an unsupported GGUF version to the version-bytes unsupported-target envelope', async () => {
  const payload = await modelError(ggufHeader(4, 0, 0));
  const path = (payload.details as { path: string }).path;

  expect(payload).toStrictEqual({
    code: 'unsupported_target',
    category: 'unsupported_target',
    message: `Unsupported target for inspect_model_artifact at ${path}: GGUF version bytes 04000000 are unsupported (little-endian 4, big-endian 67108864; byte order unknown); supported versions are 2 and 3`,
    retryable: false,
    remediation: { action: 'Select a target supported by this operation or choose an operation supporting the reported target format.' },
    details: {
      operation: 'inspect_model_artifact',
      path,
      reason: 'GGUF version bytes 04000000 are unsupported (little-endian 4, big-endian 67108864; byte order unknown); supported versions are 2 and 3',
    },
  });
});

test('maps a GGUF metadata key length beyond exact integer precision to the declared-extent envelope', async () => {
  const bytes = Buffer.concat([ggufHeader(3, 0, 1), u64(2n ** 63n - 1n)]);
  const payload = await modelError(bytes);

  expect(payload).toStrictEqual({
    code: 'target_unavailable',
    category: 'unsupported_target',
    message: 'Cannot open artifact: Declared header extent is outside the file.',
    retryable: false,
    remediation: { action: 'Review the reported file-format reason and select a supported, well-formed target.' },
    details: { path: expect.stringContaining('broken.gguf'), reason: 'Declared header extent is outside the file', constraint: 'file_format_rejected' },
  });
});

test('maps a GGUF array count beyond exact integer precision to the host-precision envelope', async () => {
  const metadata = Buffer.concat([ggufString('k'), u32(9), u32(0), u64(2n ** 63n - 1n)]);
  const payload = await modelError(Buffer.concat([ggufHeader(3, 0, 1), metadata]));

  expect(payload).toStrictEqual({
    code: 'resource_constraint',
    category: 'resource_constraint',
    message: 'Header length/count exceeds exact host offset precision',
    retryable: false,
    remediation: {
      action: 'Exact host offset precision stops at 9007199254740991. This release has no runtime override. Additional host memory does not raise it. Repeating the unchanged request fails the same way.',
    },
    details: {
      operation: 'inspect_model_artifact',
      resource: 'memory',
      reason: 'Header length/count exceeds exact host offset precision',
      reported_limits: { maximum_exact_offset: 9007199254740991 },
    },
  });
});

test('maps a GGUF tensor data offset beyond exact integer precision to the host-precision envelope', async () => {
  const payload = await modelError(Buffer.concat([ggufHeader(3, 1, 0), ggufTensor('t', [2], 0, 2n ** 63n - 1n)]));

  expect(payload).toStrictEqual({
    code: 'resource_constraint',
    category: 'resource_constraint',
    message: 'Header length/count exceeds exact host offset precision',
    retryable: false,
    remediation: {
      action: 'Exact host offset precision stops at 9007199254740991. This release has no runtime override. Additional host memory does not raise it. Repeating the unchanged request fails the same way.',
    },
    details: {
      operation: 'inspect_model_artifact',
      resource: 'memory',
      reason: 'Header length/count exceeds exact host offset precision',
      reported_limits: { maximum_exact_offset: 9007199254740991 },
    },
  });
});

test('reads SQLite integers beyond the safe JavaScript range as decimal strings', async () => {
  const targets = await tempTargets();
  const path = join(targets.dir, 'bigints.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE t (x INTEGER, y TEXT)');
    const insert = db.prepare('INSERT INTO t VALUES (?, ?)');
    insert.run(9_223_372_036_854_775_807n, 'max');
    insert.run(-9_223_372_036_854_775_808n, 'min');
    insert.run(9_007_199_254_740_993n, 'unsafe');
  } finally {
    db.close();
  }

  const { record } = await inspectSqliteDatabaseFromPath(path, { table: 't' });

  expect(record.rows?.values.map((row) => row[0])).toStrictEqual([
    { type: 'integer', value: '9223372036854775807' },
    { type: 'integer', value: '-9223372036854775808' },
    { type: 'integer', value: '9007199254740993' },
  ]);
});

test('wraps a corrupt SQLite page in the oracle invalid_request envelope', async () => {
  const targets = await tempTargets();
  const path = join(targets.dir, 'corrupt.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE t (a INTEGER, b TEXT)');
    const insert = db.prepare('INSERT INTO t VALUES (?, ?)');
    for (let value = 0; value < 200; value += 1) insert.run(value, 'x'.repeat(50));
  } finally {
    db.close();
  }
  const bytes = await readFile(path);
  const pageSize = bytes.readUInt16BE(16);
  bytes.fill(0xde, pageSize, pageSize * 2);
  await writeFile(path, bytes);

  let payload: ReaError['payload'] | undefined;
  try {
    await inspectSqliteDatabaseFromPath(path, { table: 't' });
  } catch (error) {
    payload = (error as ReaError).payload;
  }

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for inspect_sqlite_database; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'inspect_sqlite_database' },
    details: {
      operation: 'inspect_sqlite_database',
      issues: [
        {
          path: ['path'],
          reason: 'invalid_format',
          message: `Selected SQLite database is invalid (database disk image is malformed): ${path}`,
        },
      ],
      captured_output: { stdout: '', stderr: '', truncated: false },
    },
  });
});

const sqlite3 = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' });

test.skipIf(sqlite3.status !== 0)('rejects a NULL sqlite_schema table before reporting a table kind', async () => {
  const targets = await tempTargets();
  const path = join(targets.dir, 'null-schema.db');
  const created = spawnSync('sqlite3', [path, 'CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1);']);
  expect(created.status).toBe(0);
  const nulled = spawnSync('sqlite3', [path, "PRAGMA writable_schema=ON; UPDATE sqlite_schema SET sql=NULL WHERE name='t';"]);
  expect(nulled.status).toBe(0);

  let payload: ReaError['payload'] | undefined;
  try {
    await inspectSqliteDatabaseFromPath(path);
  } catch (error) {
    payload = (error as ReaError).payload;
  }

  expect(payload?.code).toBe('invalid_request');
  expect(payload?.category).toBe('invalid_input');
  expect(payload?.details?.['operation']).toBe('inspect_sqlite_database');
  const issues = (payload?.details?.['issues'] ?? []) as { reason: string; message: string }[];
  const issue = issues[0];
  expect(issue?.reason).toBe('invalid_format');
  expect(issue?.message).toContain('Selected SQLite database is invalid (malformed database schema (t)');
  expect(issue?.message).toContain(path);
});

test('inspect_devicetree resolves a relative path against the supplied session cwd', async () => {
  const targets = await tempTargets();
  const bytes = await readFile(fixturePath('targets/devicetree/board.dtb'));
  await targets.write('board.dtb', bytes);

  const result = await inspectDevicetree(new ReaSession(runtime), { path: 'board.dtb' }, { cwd: targets.dir });
  const record = (result.structuredContent as { normalized_result: { artifact: { path: string; bytes: number } } }).normalized_result;

  expect(record.artifact.path).toBe(join(targets.dir, 'board.dtb'));
  expect(record.artifact.bytes).toBe(bytes.length);
});
