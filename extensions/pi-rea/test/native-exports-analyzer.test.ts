import { expect, test } from 'vitest';
import { inspectNativeExportsFromPath } from '../src/analysis/native-exports.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectNativeExports } from '../src/tools/native-exports-tools.ts';
import { tempTargets } from './support/temp-targets.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const MAGIC = [0x7f, 0x45, 0x4c, 0x46];

const elf64 = (options: { machine: number; little?: boolean; shoff?: number; shnum?: number; length?: number }): Buffer => {
  const little = options.little ?? true;
  const bytes = Buffer.alloc(options.length ?? 64);
  bytes.set([...MAGIC, 2, little ? 1 : 2, 1], 0);
  if (little) bytes.writeUInt16LE(options.machine, 18);
  else bytes.writeUInt16BE(options.machine, 18);
  if (bytes.length >= 48) {
    if (little) bytes.writeBigUInt64LE(BigInt(options.shoff ?? 0), 40);
    else bytes.writeBigUInt64BE(BigInt(options.shoff ?? 0), 40);
  }
  if (bytes.length >= 62) {
    if (little) bytes.writeUInt16LE(options.shnum ?? 0, 60);
    else bytes.writeUInt16BE(options.shnum ?? 0, 60);
  }
  return bytes;
};

const elf32 = (options: { machine: number; little?: boolean; shoff?: number; shnum?: number; length?: number }): Buffer => {
  const little = options.little ?? true;
  const bytes = Buffer.alloc(options.length ?? 52);
  bytes.set([...MAGIC, 1, little ? 1 : 2, 1], 0);
  if (little) bytes.writeUInt16LE(options.machine, 18);
  else bytes.writeUInt16BE(options.machine, 18);
  if (bytes.length >= 36) {
    if (little) bytes.writeUInt32LE(options.shoff ?? 0, 32);
    else bytes.writeUInt32BE(options.shoff ?? 0, 32);
  }
  if (bytes.length >= 50) {
    if (little) bytes.writeUInt16LE(options.shnum ?? 0, 48);
    else bytes.writeUInt16BE(options.shnum ?? 0, 48);
  }
  return bytes;
};

const payloadOf = async (run: () => Promise<unknown>): Promise<ReaError['payload']> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the analyzer returned instead of throwing');
};

test('reports an unsupported ELF without section headers', async () => {
  const targets = await tempTargets();
  const path = await targets.write('no-sections', elf64({ machine: 62 }));
  const { record, resolvedPath } = await inspectNativeExportsFromPath(path);

  expect(resolvedPath).toBe(path);
  expect(record.artifact).toStrictEqual({ path, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: 64 });
  expect(record).toMatchObject({
    format: 'elf',
    architecture: 'amd64',
    bits: 64,
    byte_order: 'little',
    exports: [],
    issues: [],
    coverage: { status: 'unsupported', examined_entries: 0, exports: 0 },
  });
  expect(record.coverage.reason).toBe('The ELF has no section headers; enumerating dynamic symbols from the dynamic segment is not implemented');
});

test('reports a complete ELF inventory when section headers are declared', async () => {
  const targets = await tempTargets();
  const path = await targets.write('with-sections', elf64({ machine: 183, shoff: 64, shnum: 3 }));
  const { record } = await inspectNativeExportsFromPath(path);

  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 0, exports: 0 });
  expect(record.architecture).toBe('aarch64');
  expect(record.limitations[0]).toBe('The ELF has no dynamic symbol table, so it exports no dynamic symbols.');
});

test('reads a big-endian 64-bit ELF header', async () => {
  const targets = await tempTargets();
  const path = await targets.write('big-endian', elf64({ machine: 3, little: false, shoff: 64, shnum: 1 }));
  const { record } = await inspectNativeExportsFromPath(path);

  expect(record.byte_order).toBe('big');
  expect(record.bits).toBe(64);
  expect(record.architecture).toBe('x86');
  expect(record.coverage.status).toBe('complete');
});

test('reads a 32-bit ELF header whose section count does not fit', async () => {
  const targets = await tempTargets();
  const path = await targets.write('elf32-short', elf32({ machine: 40, shoff: 52, length: 40 }));
  const { record } = await inspectNativeExportsFromPath(path);

  expect(record.bits).toBe(32);
  expect(record.architecture).toBe('arm');
  expect(record.coverage.status).toBe('unsupported');
});

test('reports an unknown machine as unknown architecture', async () => {
  const targets = await tempTargets();
  const path = await targets.write('unknown-machine', elf32({ machine: 4242, shoff: 52, shnum: 2 }));
  const { record } = await inspectNativeExportsFromPath(path);

  expect(record.architecture).toBe('unknown');
  expect(record.bits).toBe(32);
  expect(record.coverage.status).toBe('complete');
});

test('reports a truncated 64-bit header as an unsupported ELF', async () => {
  const targets = await tempTargets();
  const path = await targets.write('truncated', elf64({ machine: 62, length: 44 }));
  const { record } = await inspectNativeExportsFromPath(path);

  expect(record.bits).toBe(64);
  expect(record.coverage.status).toBe('unsupported');
});

test('refuses PE export enumeration', async () => {
  const targets = await tempTargets();
  const path = await targets.write('pe.exe', Buffer.from([0x4d, 0x5a, 0x00, 0x00]));
  const payload = await payloadOf(() => inspectNativeExportsFromPath(path));

  expect(payload.code).toBe('unsupported_target');
  expect(payload.details).toMatchObject({ reason: 'pe_not_implemented', path });
});

test('refuses a format that is neither ELF nor PE', async () => {
  const targets = await tempTargets();
  const path = await targets.write('note.txt', 'not a binary');
  const payload = await payloadOf(() => inspectNativeExportsFromPath(path));

  expect(payload.code).toBe('unsupported_target');
  expect(payload.details).toMatchObject({ reason: 'unsupported_format', path });
});

test('rejects an empty path', async () => {
  const payload = await payloadOf(() => inspectNativeExportsFromPath(''));
  expect(payload).toMatchObject({ code: 'invalid_request', details: { operation: 'inspect_native_exports', parameter: 'path' } });
});

test('rejects the leading bytes of an ELF without the full magic', async () => {
  const targets = await tempTargets();
  const path = await targets.write('short-magic', Buffer.from([0x7f, 0x45, 0x4c]));
  const payload = await payloadOf(() => inspectNativeExportsFromPath(path));

  expect(payload.details).toMatchObject({ reason: 'unsupported_format' });
});

test('rejects an artifact larger than max_file_bytes', async () => {
  const targets = await tempTargets();
  const path = await targets.write('big', elf64({ machine: 62 }));
  const payload = await payloadOf(() => inspectNativeExportsFromPath(path, { max_file_bytes: 8 }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'Selected artifact exceeds max_file_bytes=8.',
    details: { operation: 'inspect_native_exports', parameter: 'max_file_bytes' },
  });
});

test('resolves a relative path against the supplied cwd', async () => {
  const targets = await tempTargets();
  await targets.write('relative-elf', elf64({ machine: 62, shoff: 64, shnum: 1 }));
  const { resolvedPath, record } = await inspectNativeExportsFromPath('relative-elf', { cwd: targets.dir });

  expect(resolvedPath).toBe(`${targets.dir}/relative-elf`);
  expect(record.artifact.path).toBe(resolvedPath);
});

test('records Evidence through the inspect_native_exports tool', async () => {
  const targets = await tempTargets();
  const path = await targets.write('tool-elf', elf64({ machine: 62, shoff: 64, shnum: 1 }));
  const session = new ReaSession(runtime);
  const result = await inspectNativeExports(session, { path });

  const record = result.structuredContent as {
    operation: string;
    parameters: { path: string; max_file_bytes: number };
    normalized_result: { format: string; architecture: string; coverage: { status: string } };
  };
  expect(record.operation).toBe('inspect_native_exports');
  expect(record.parameters).toStrictEqual({ path, max_file_bytes: 268_435_456 });
  expect(record.normalized_result).toMatchObject({ format: 'elf', architecture: 'amd64', coverage: { status: 'complete' } });
  expect(session.evidence.size).toBe(1);
});
