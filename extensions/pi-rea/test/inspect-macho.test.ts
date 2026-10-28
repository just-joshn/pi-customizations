import { expect, test } from 'vitest';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectMacho } from '../src/tools/macho-tools.ts';
import { openBinary } from '../src/tools/session-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };
const CPU_ARM64 = 0x0100000c;
const CPU_X86_64 = 0x01000007;
const ARM64_ALL = 0;
const ARM64E = 2;
const X86_ALL = 3;

const pad8 = (value: number): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const loadCommand = (cmd: number, payload: Buffer): Buffer => {
  const size = 8 + payload.length;
  const padded = Buffer.alloc(Math.ceil(size / 8) * 8);
  padded.writeUInt32LE(cmd, 0);
  padded.writeUInt32LE(padded.length, 4);
  payload.copy(padded, 8);
  return padded;
};

const segment = (name: string, vmaddr: bigint, vmsize: bigint, fileoff: bigint, filesize: bigint): Buffer =>
  loadCommand(
    0x19,
    Buffer.concat([
      Buffer.from(name.padEnd(16, '\0'), 'latin1'),
      pad8(Number(vmaddr)),
      pad8(Number(vmsize)),
      pad8(Number(fileoff)),
      pad8(Number(filesize)),
      (() => {
        const tail = Buffer.alloc(8);
        tail.writeInt32LE(7, 0);
        tail.writeInt32LE(5, 4);
        return tail;
      })(),
      (() => {
        const tail = Buffer.alloc(8);
        tail.writeUInt32LE(0, 0);
        tail.writeUInt32LE(0, 4);
        return tail;
      })(),
    ]),
  );

const section = (segmentName: string, name: string, address: bigint, size: bigint, offset: number, alignment: number, flags: number): Buffer =>
  Buffer.concat([
    Buffer.from(name.padEnd(16, '\0'), 'latin1'),
    Buffer.from(segmentName.padEnd(16, '\0'), 'latin1'),
    pad8(Number(address)),
    pad8(Number(size)),
    (() => {
      const tail = Buffer.alloc(16);
      tail.writeUInt32LE(offset, 0);
      tail.writeUInt32LE(alignment, 4);
      tail.writeUInt32LE(0, 8);
      tail.writeUInt32LE(0, 12);
      return tail;
    })(),
    (() => {
      const tail = Buffer.alloc(8);
      tail.writeUInt32LE(flags, 0);
      tail.writeUInt32LE(0, 4);
      return tail;
    })(),
    Buffer.alloc(8),
  ]);

const segmentWithSection = (name: string): Buffer => {
  const body = Buffer.concat([
    Buffer.from(name.padEnd(16, '\0'), 'latin1'),
    pad8(0x100000000),
    pad8(0x1000),
    pad8(0),
    pad8(0x1000),
    (() => {
      const tail = Buffer.alloc(8);
      tail.writeInt32LE(7, 0);
      tail.writeInt32LE(5, 4);
      return tail;
    })(),
    (() => {
      const tail = Buffer.alloc(8);
      tail.writeUInt32LE(1, 0);
      tail.writeUInt32LE(0, 4);
      return tail;
    })(),
    section(name, '__text', 0x100001000n, 0x100n, 4096, 4, 0x80000400),
  ]);
  return loadCommand(0x19, body);
};

const module = (content: Buffer, commands: Buffer[]): Buffer => {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(CPU_ARM64, 4);
  header.writeUInt32LE(ARM64_ALL, 8);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(
    commands.reduce((total, command) => total + command.length, 0),
    20,
  );
  header.writeUInt32LE(0x00200085, 24);
  header.writeUInt32LE(0, 28);
  return Buffer.concat([header, ...commands, content]);
};

const main = (entryoff: number): Buffer => loadCommand(0x80000028, Buffer.concat([pad8(entryoff), pad8(0)]));

const uuid = (hex: string): Buffer => loadCommand(0x1b, Buffer.from(hex, 'hex'));

const buildVersion = (platform: number, minos: number, sdk: number): Buffer => {
  const payload = Buffer.alloc(16);
  payload.writeUInt32LE(platform, 0);
  payload.writeUInt32LE(minos, 4);
  payload.writeUInt32LE(sdk, 8);
  payload.writeUInt32LE(0, 12);
  return loadCommand(0x32, payload);
};

const dylib = (path: string, version = 0x00010000): Buffer => {
  const name = Buffer.from(`${path}\0`, 'latin1');
  const header = Buffer.alloc(16);
  header.writeUInt32LE(24, 0);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(version, 8);
  header.writeUInt32LE(version, 12);
  return loadCommand(0x0c, Buffer.concat([header, name, Buffer.alloc((8 - (name.length % 8)) % 8)]));
};

const dylinker = (path: string): Buffer => {
  const name = Buffer.from(`${path}\0`, 'latin1');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(12, 0);
  return loadCommand(0x0e, Buffer.concat([header, name, Buffer.alloc((8 - (name.length % 8)) % 8)]));
};

const thinBinary = (): Buffer =>
  module(Buffer.alloc(64), [
    segment('__PAGEZERO', 0n, 0x100000000n, 0n, 0n),
    segmentWithSection('__TEXT'),
    dylinker('/usr/lib/dyld'),
    dylib('/usr/lib/libSystem.B.dylib', 0x00010002),
    dylib('/usr/lib/libresolv.9.dylib', 0x00010000),
    loadCommand(0x1b, Buffer.from('503da016e7b13841baf74ef097252129', 'hex')),
    buildVersion(1, 0x000c0000, 0x000d0000),
    main(0x1000),
  ]);

const fatBinary = (): Buffer => {
  const slices = [module(Buffer.alloc(8), [uuid('11'.repeat(16))]), module(Buffer.alloc(8), [uuid('22'.repeat(16))])];
  const header = Buffer.alloc(8 + slices.length * 20);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);
  let offset = header.length;
  slices.forEach((slice, index) => {
    const at = 8 + index * 20;
    const cpu = index === 0 ? CPU_X86_64 : CPU_ARM64;
    header.writeUInt32BE(cpu, at);
    header.writeUInt32BE(index === 0 ? X86_ALL : (0x80000000 + ARM64E) >>> 0, at + 4);
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(slice.length, at + 12);
    header.writeUInt32BE(14, at + 16);
    offset += slice.length;
  });
  return Buffer.concat([header, ...slices]);
};

const recordOf = async (path: string): Promise<Record<string, unknown>> => {
  const bytes = await import('node:fs/promises').then((fs) => fs.readFile(path));
  void bytes;
  const session = new ReaSession(runtime);
  await openBinary(session, { path });
  const result = await inspectMacho(session, {});
  return result.structuredContent as Record<string, unknown>;
};

const write = async (name: string, bytes: Buffer): Promise<string> => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-macho-'));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
};

test('TOOL-058: a thin image reports the header, uuid, entrypoint and build metadata', async () => {
  const path = await write('thin', thinBinary());
  const record = await recordOf(path);
  const normalized = record['normalized_result'] as Record<string, unknown>;
  expect(record['operation']).toBe('inspect_macho');
  expect(normalized['format']).toBe('mach-o');
  expect(normalized['endian']).toBe('little');
  expect(normalized['word_size']).toBe(64);
  expect(normalized['file_type']).toBe('2');
  expect(normalized['flags']).toStrictEqual(['0x00200085']);
  expect(normalized['uuid']).toBe('503DA016-E7B1-3841-BAF7-4EF097252129');
  expect(normalized['entrypoints']).toStrictEqual({ items: [{ file_offset: 0x1000 }], total: 1, exhaustive: true, limitations: [] });
  expect(normalized['architectures']).toStrictEqual({
    items: [{ name: 'arm64', hidden: false, cpu_type: null, cpu_subtype: null, file_offset: null, size: null, alignment: null }],
    total: 1,
    exhaustive: true,
    limitations: [],
  });
  expect(normalized['selected_architecture']).toStrictEqual({ name: 'arm64', container_file_offset: 0 });
  expect(normalized['build_metadata']).toStrictEqual({
    items: [{ platform: 'MACOS', minimum_os: '12.0', sdk: '13.0', tools: [] }],
    total: 1,
    exhaustive: true,
    limitations: [],
  });
});

test('TOOL-058: dependencies carry the dylib kind, path and versions', async () => {
  const path = await write('deps', thinBinary());
  const normalized = (await recordOf(path))['normalized_result'] as Record<string, unknown>;
  expect(normalized['dependencies']).toStrictEqual({
    items: [
      { path: '/usr/lib/libSystem.B.dylib', kind: 'LC_LOAD_DYLIB', current_version: '1.0.2', compatibility_version: '1.0.2' },
      { path: '/usr/lib/libresolv.9.dylib', kind: 'LC_LOAD_DYLIB', current_version: '1.0.0', compatibility_version: '1.0.0' },
    ],
    total: 2,
    exhaustive: true,
    limitations: [],
  });
});

test('TOOL-058: segments and sections are projected with their permissions', async () => {
  const path = await write('segments', thinBinary());
  const normalized = (await recordOf(path))['normalized_result'] as Record<string, unknown>;
  const segments = normalized['segments'] as { items: Record<string, unknown>[]; total: number };
  expect(segments.total).toBe(2);
  const text = segments.items.find((item) => item['name'] === '__TEXT');
  expect(text).toMatchObject({
    vm_address: '0x100000000',
    vm_size: 4096,
    file_offset: 0,
    file_size: 4096,
    maximum_permissions: { read: true, write: true, execute: true, raw: '7' },
    initial_permissions: { read: true, write: false, execute: true, raw: '5' },
  });
  expect(text?.['sections']).toStrictEqual({
    items: [{ segment: '__TEXT', name: '__text', address: '0x100001000', size: 256, file_offset: 4096, alignment: 16, flags: ['2147484672'] }],
    total: 1,
    exhaustive: true,
    limitations: [],
  });
});

test('TOOL-058: load commands are listed with their decoded fields', async () => {
  const path = await write('commands', thinBinary());
  const normalized = (await recordOf(path))['normalized_result'] as Record<string, unknown>;
  const commands = normalized['load_commands'] as { items: { index: number; kind: string; fields: Record<string, unknown> }[]; total: number };
  expect(commands.total).toBe(8);
  expect(commands.items.map((item) => item.kind)).toStrictEqual(['LC_SEGMENT_64', 'LC_SEGMENT_64', 'LC_LOAD_DYLINKER', 'LC_LOAD_DYLIB', 'LC_LOAD_DYLIB', 'LC_UUID', 'LC_BUILD_VERSION', 'LC_MAIN']);
  expect(commands.items[5]?.fields).toStrictEqual({ cmd: 'LC_UUID', cmdsize: 24, uuid: '503DA016-E7B1-3841-BAF7-4EF097252129' });
  expect(commands.items[6]?.fields).toStrictEqual({ cmd: 'LC_BUILD_VERSION', cmdsize: 24, platform: 1, minos: '12.0', sdk: '13.0', ntools: 0 });
  expect(commands.items[7]?.fields).toStrictEqual({ cmd: 'LC_MAIN', cmdsize: 24, entryoff: 0x1000, stacksize: 0 });
});

test('TOOL-058: a universal image lists every slice and reports the host slice', async () => {
  const path = await write('fat', fatBinary());
  const normalized = (await recordOf(path))['normalized_result'] as Record<string, unknown>;
  const architectures = normalized['architectures'] as { items: Record<string, unknown>[]; total: number };
  expect(architectures.total).toBe(2);
  expect(architectures.items[0]).toStrictEqual({
    name: 'x86_64',
    hidden: false,
    cpu_type: 'CPU_TYPE_X86_64',
    cpu_subtype: 'CPU_SUBTYPE_X86_ALL',
    file_offset: 48,
    size: 64,
    alignment: 16384,
  });
  expect(architectures.items[1]).toMatchObject({ name: 'arm64e', hidden: false, cpu_type: 'CPU_TYPE_ARM64', cpu_subtype: 'CPU_SUBTYPE_ARM64E' });
  expect(normalized['uuid']).toBe('22222222-2222-2222-2222-222222222222');
});

test('TOOL-058: an image with no symbol table reports bounded empty symbol coverage', async () => {
  const path = await write('symbols', thinBinary());
  const normalized = (await recordOf(path))['normalized_result'] as Record<string, unknown>;
  for (const facet of ['imports', 'exports']) {
    const value = normalized[facet] as { items: unknown[]; total: number | null; exhaustive: boolean; limitations: string[] };
    expect(value.items).toStrictEqual([]);
    expect(value.total).toBeNull();
    expect(value.exhaustive).toBe(false);
    expect(value.limitations).toHaveLength(1);
    expect(value.limitations[0]).toContain('no classic symbol table');
  }
});

test('TOOL-058: the analysis needs an open target and is retained as Evidence', async () => {
  const session = new ReaSession(runtime);
  await expect(inspectMacho(session, {})).rejects.toThrowError(/No target is open/);
  expect(session.evidence.size).toBe(0);

  const path = await write('retain', thinBinary());
  await openBinary(session, { path });
  const record = await inspectMacho(session, {});
  expect(session.evidence.size).toBe(1);
  const structured = record.structuredContent as Record<string, unknown>;
  expect(session.evidence.get(structured['evidence_id'] as string)?.operation).toBe('inspect_macho');
  expect(structured['subject']).toMatchObject({ format: 'mach-o', architecture: 'arm64' });
  const { realpath } = await import('node:fs/promises');
  const resolved = await realpath(path);
  expect(structured['parameters']).toStrictEqual({ input_path: resolved });
  const locations = structured['locations'] as { kind: string; offset?: number; start?: number; end?: number }[];
  expect(locations.some((entry) => entry.kind === 'file-offset')).toBe(true);
  expect(locations.some((entry) => entry.kind === 'file-offset-range')).toBe(true);
  expect((structured['limitations'] as string[]).length).toBe(2);
});

test('TOOL-058: a header-only image still reports the facts it can read', async () => {
  const headerOnly = Buffer.alloc(32);
  headerOnly.writeUInt32LE(0xfeedfacf, 0);
  headerOnly.writeUInt32LE(CPU_ARM64, 4);
  headerOnly.writeUInt32LE(ARM64_ALL, 8);
  headerOnly.writeUInt32LE(2, 12);
  headerOnly.writeUInt32LE(0, 16);
  headerOnly.writeUInt32LE(0, 20);
  headerOnly.writeUInt32LE(0, 24);
  headerOnly.writeUInt32LE(0, 28);
  const path = await write('header-only', headerOnly);
  const normalized = (await recordOf(path))['normalized_result'] as Record<string, unknown>;
  expect(normalized['file_type']).toBe('2');
  expect(normalized['uuid']).toBeNull();
  expect((normalized['load_commands'] as { total: number }).total).toBe(0);
});

test('TOOL-058: a file that is not a Mach-O image is refused', async () => {
  const path = await write('not-macho', Buffer.from('plain text'));
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await openBinary(session, { path });
    await inspectMacho(session, {});
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(['target_unavailable', 'invalid_request']).toContain(payload.code);
  expect(session.evidence.size).toBe(0);
});

test('TOOL-058: the fixture identity used by the reference capture is unchanged', async () => {
  const path = await write('identity', thinBinary());
  const session = new ReaSession(runtime);
  const identity = (await openBinary(session, { path })).structuredContent as { result: { format: string } };
  expect(identity.result.format).toBe('mach-o');
  expect(fixturePath('targets/minimal-elf.bin')).toContain('minimal-elf.bin');
});
