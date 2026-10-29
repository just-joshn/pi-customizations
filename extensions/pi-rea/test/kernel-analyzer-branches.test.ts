import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { expect, test } from 'vitest';
import { derChildren, derIntegerHex, derOid, derUtf8, readDerNode } from '../src/analysis/asn1.ts';
import { inspectByteEntropyFromPath } from '../src/analysis/byte-entropy.ts';
import { inspectDevicetreeFromPath } from '../src/analysis/devicetree.ts';
import { ELECTRON_FUSE_SENTINEL, ELECTRON_FUSE_STATE_BYTES, inspectElectronFusesFromPath } from '../src/analysis/electron-fuses.ts';
import { inspectElfNotesFromPath } from '../src/analysis/elf-notes.ts';
import { inspectErlangBeamFromPath } from '../src/analysis/erlang-beam.ts';
import { inspectKernelModuleFromPath } from '../src/analysis/kernel-module.ts';
import type { ReaError, ReaErrorPayload } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectDevicetree } from '../src/tools/devicetree-tools.ts';
import { inspectElectronFuses } from '../src/tools/electron-fuse-tools.ts';
import { inspectElfNotes } from '../src/tools/elf-tools.ts';
import { inspectByteEntropy } from '../src/tools/entropy-tools.ts';
import { inspectErlangBeam } from '../src/tools/erlang-beam-tools.ts';
import { inspectKernelModule } from '../src/tools/kernel-module-tools.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const ENABLED = ELECTRON_FUSE_STATE_BYTES.enabled;
const DISABLED = ELECTRON_FUSE_STATE_BYTES.disabled;
const REMOVED = ELECTRON_FUSE_STATE_BYTES.removed;

const payloadOf = async (run: () => Promise<unknown>): Promise<ReaErrorPayload> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the call resolved instead of throwing');
};

const u32be = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0, 0);
  return bytes;
};

const padTo = (bytes: Buffer, alignment: number): Buffer => (bytes.length % alignment === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(alignment - (bytes.length % alignment))]));

const patched = (source: Buffer, patch: (blob: Buffer) => void): Buffer => {
  const blob = Buffer.from(source);
  patch(blob);
  return blob;
};

const writeInto = async (path: string, contents: string | Uint8Array): Promise<string> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
};

interface FdtPropertyInput {
  readonly name: string;
  readonly value: Buffer;
}

interface FdtNodeInput {
  readonly name: string;
  readonly properties?: readonly FdtPropertyInput[];
  readonly children?: readonly FdtNodeInput[];
}

interface FdtReservation {
  readonly address: bigint;
  readonly size: bigint;
}

interface FdtOptions {
  readonly version?: number;
  readonly lastCompVersion?: number;
  readonly reservations?: readonly FdtReservation[];
  readonly stringsFirst?: boolean;
}

interface FdtBlobInput {
  readonly struct: Buffer;
  readonly strings: Buffer;
  readonly version: number;
  readonly lastCompVersion: number;
  readonly reservations: readonly FdtReservation[];
  readonly stringsFirst: boolean;
}

const fdtStruct = (roots: readonly FdtNodeInput[]): { readonly struct: Buffer; readonly strings: Buffer } => {
  const offsets = new Map<string, number>();
  const blobs: Buffer[] = [];
  let length = 0;
  const intern = (name: string): number => {
    const existing = offsets.get(name);
    if (existing !== undefined) return existing;
    const offset = length;
    const blob = Buffer.from(`${name}\0`, 'latin1');
    offsets.set(name, offset);
    blobs.push(blob);
    length += blob.length;
    return offset;
  };
  const tokens: Buffer[] = [];
  const emit = (node: FdtNodeInput): void => {
    tokens.push(u32be(1), padTo(Buffer.from(`${node.name}\0`, 'latin1'), 4));
    for (const property of node.properties ?? []) tokens.push(u32be(3), u32be(property.value.length), u32be(intern(property.name)), padTo(property.value, 4));
    for (const child of node.children ?? []) emit(child);
    tokens.push(u32be(2));
  };
  for (const root of roots) emit(root);
  tokens.push(u32be(9));
  return { struct: Buffer.concat(tokens), strings: Buffer.concat(blobs) };
};

const fdtBlob = (input: FdtBlobInput): Buffer => {
  const reservations = Buffer.concat([
    ...input.reservations.map((entry) => {
      const bytes = Buffer.alloc(16);
      bytes.writeBigUInt64BE(entry.address, 0);
      bytes.writeBigUInt64BE(entry.size, 8);
      return bytes;
    }),
    Buffer.alloc(16),
  ]);
  const base = 40 + reservations.length;
  const structOffset = input.stringsFirst ? Math.ceil((base + input.strings.length) / 4) * 4 : base;
  const stringsOffset = input.stringsFirst ? base : Math.ceil((base + input.struct.length) / 4) * 4;
  const totalSize = input.stringsFirst ? structOffset + input.struct.length : stringsOffset + input.strings.length;
  const header = Buffer.alloc(40);
  header.writeUInt32BE(0xd00dfeed, 0);
  header.writeUInt32BE(totalSize, 4);
  header.writeUInt32BE(structOffset, 8);
  header.writeUInt32BE(stringsOffset, 12);
  header.writeUInt32BE(40, 16);
  header.writeUInt32BE(input.version, 20);
  header.writeUInt32BE(input.lastCompVersion, 24);
  header.writeUInt32BE(0, 28);
  header.writeUInt32BE(input.strings.length, 32);
  header.writeUInt32BE(input.struct.length, 36);
  const body = input.stringsFirst
    ? Buffer.concat([header, reservations, input.strings, Buffer.alloc(structOffset - (base + input.strings.length)), input.struct])
    : Buffer.concat([header, reservations, input.struct, Buffer.alloc(stringsOffset - (base + input.struct.length)), input.strings]);
  return body.subarray(0, totalSize);
};

const fdt = (nodes: readonly FdtNodeInput[], options: FdtOptions = {}): Buffer => {
  const tree = fdtStruct(nodes);
  return fdtBlob({
    struct: tree.struct,
    strings: tree.strings,
    version: options.version ?? 17,
    lastCompVersion: options.lastCompVersion ?? 16,
    reservations: options.reservations ?? [],
    stringsFirst: options.stringsFirst ?? false,
  });
};

const rawFdt = (struct: Buffer, options: { readonly strings?: Buffer; readonly version?: number; readonly stringsFirst?: boolean } = {}): Buffer =>
  fdtBlob({
    struct,
    strings: options.strings ?? Buffer.alloc(0),
    version: options.version ?? 17,
    lastCompVersion: 16,
    reservations: [],
    stringsFirst: options.stringsFirst ?? false,
  });

const miniFdt = (options: FdtOptions = {}): Buffer => fdt([{ name: '', properties: [{ name: 'model', value: Buffer.from('x\0', 'latin1') }] }], options);

const miniPatched = (patch: (blob: Buffer) => void): Buffer => patched(miniFdt(), patch);

const richFdt = (): Buffer =>
  fdt([
    {
      name: '',
      properties: [
        { name: 'compatible', value: Buffer.from('acme,board\0acme,alt\0', 'latin1') },
        { name: 'model', value: Buffer.from('Acme Board\0', 'latin1') },
      ],
      children: [
        {
          name: 'aliases',
          properties: [
            { name: 'serial0', value: Buffer.from('/soc/serial@1000\0', 'latin1') },
            { name: 'broken', value: Buffer.from([0x30, 0x01, 0x00]) },
          ],
        },
        {
          name: 'chosen',
          properties: [
            { name: 'bootargs', value: Buffer.from('console=ttyS0\0', 'latin1') },
            { name: 'stdout-path', value: Buffer.from('serial0:115200n8\0', 'latin1') },
          ],
        },
        { name: 'intc', properties: [{ name: 'phandle', value: u32be(1) }] },
        {
          name: 'soc',
          properties: [
            { name: '#address-cells', value: u32be(1) },
            { name: '#size-cells', value: u32be(0) },
            { name: 'interrupt-parent', value: u32be(1) },
          ],
          children: [
            { name: 'serial@1000', properties: [{ name: 'reg', value: u32be(0x1000) }] },
            { name: 'broken@0', properties: [{ name: 'reg', value: Buffer.alloc(6) }] },
          ],
        },
        {
          name: 'bad-cells',
          properties: [{ name: '#address-cells', value: Buffer.alloc(8) }],
          children: [{ name: 'child@0', properties: [{ name: 'reg', value: Buffer.alloc(8) }] }],
        },
        {
          name: 'conflict',
          properties: [
            { name: 'phandle', value: u32be(2) },
            { name: 'linux,phandle', value: u32be(3) },
            { name: 'msi-parent', value: u32be(2) },
          ],
        },
        { name: 'malformed-handle', properties: [{ name: 'phandle', value: Buffer.alloc(8) }] },
        {
          name: 'dup-a',
          properties: [
            { name: 'phandle', value: u32be(4) },
            { name: 'remote-endpoint', value: u32be(4) },
          ],
        },
        {
          name: 'dup-b',
          properties: [
            { name: 'phandle', value: u32be(4) },
            { name: 'remote-endpoint', value: u32be(0xffffffff) },
          ],
        },
        { name: 'truncated-preview', properties: [{ name: 'blob', value: Buffer.alloc(300, 0x41) }] },
      ],
    },
  ]);

const nestedFdt = (depth: number): Buffer => {
  let node: FdtNodeInput = { name: 'a' };
  for (let level = 1; level < depth; level += 1) node = { name: 'a', children: [node] };
  return fdt([{ name: '', children: [node] }]);
};

interface ElfSectionInput {
  readonly name: string;
  readonly type: number;
  readonly data: Buffer;
  readonly align?: number;
  readonly size?: number;
  readonly entsize?: number;
}

interface ElfProgramInput {
  readonly type: number;
  readonly data: Buffer;
  readonly align?: number;
}

interface ElfInput {
  readonly bits?: 32 | 64;
  readonly little?: boolean;
  readonly type: number;
  readonly machine: number;
  readonly sections?: readonly ElfSectionInput[];
  readonly programs?: readonly ElfProgramInput[];
}

interface ElfEntry {
  name: string;
  type: number;
  data: Buffer;
  align: number;
  size: number;
  entsize: number;
  offset: number;
}

const elf = (input: ElfInput): Buffer => {
  const bits = input.bits ?? 64;
  const little = input.little ?? true;
  const sections = input.sections ?? [];
  const programs = input.programs ?? [];
  const ehsize = bits === 64 ? 64 : 52;
  const phentsize = bits === 64 ? 56 : 32;
  const shentsize = bits === 64 ? 64 : 40;
  const nameOffsets = new Map<string, number>();
  const stringParts: Buffer[] = [Buffer.from([0])];
  let stringLength = 1;
  for (const name of [...sections.map((section) => section.name), '.shstrtab']) {
    if (name === '' || nameOffsets.has(name)) continue;
    nameOffsets.set(name, stringLength);
    const blob = Buffer.from(`${name}\0`, 'latin1');
    stringParts.push(blob);
    stringLength += blob.length;
  }
  const shstrtab = Buffer.concat(stringParts);
  const entries: ElfEntry[] = [
    { name: '', type: 0, data: Buffer.alloc(0), align: 0, size: 0, entsize: 0, offset: 0 },
    ...sections.map((section) => ({
      name: section.name,
      type: section.type,
      data: section.data,
      align: section.align ?? 1,
      size: section.size ?? section.data.length,
      entsize: section.entsize ?? 0,
      offset: 0,
    })),
    { name: '.shstrtab', type: 3, data: shstrtab, align: 1, size: shstrtab.length, entsize: 0, offset: 0 },
  ];
  let cursor = ehsize + programs.length * phentsize;
  const programOffsets: number[] = [];
  for (const program of programs) {
    programOffsets.push(cursor);
    cursor += program.data.length;
  }
  for (const entry of entries) {
    if (entry.type === 0) continue;
    entry.offset = cursor;
    cursor += entry.data.length;
  }
  const shoff = Math.ceil(cursor / 8) * 8;
  const bytes = Buffer.alloc(shoff + entries.length * shentsize);
  bytes.set([0x7f, 0x45, 0x4c, 0x46], 0);
  bytes[4] = bits === 64 ? 2 : 1;
  bytes[5] = little ? 1 : 2;
  bytes[6] = 1;
  const write16 = (offset: number, value: number): void => {
    if (little) bytes.writeUInt16LE(value, offset);
    else bytes.writeUInt16BE(value, offset);
  };
  const write32 = (offset: number, value: number): void => {
    if (little) bytes.writeUInt32LE(value >>> 0, offset);
    else bytes.writeUInt32BE(value >>> 0, offset);
  };
  const write64 = (offset: number, value: number): void => {
    if (little) bytes.writeBigUInt64LE(BigInt(value), offset);
    else bytes.writeBigUInt64BE(BigInt(value), offset);
  };
  write16(16, input.type);
  write16(18, input.machine);
  write32(20, 1);
  const phoff = programs.length === 0 ? 0 : ehsize;
  if (bits === 64) {
    write64(32, phoff);
    write64(40, shoff);
    write16(52, ehsize);
    write16(54, phentsize);
    write16(56, programs.length);
    write16(58, shentsize);
    write16(60, entries.length);
    write16(62, sections.length + 1);
  } else {
    write32(28, phoff);
    write32(32, shoff);
    write16(40, ehsize);
    write16(42, phentsize);
    write16(44, programs.length);
    write16(46, shentsize);
    write16(48, entries.length);
    write16(50, sections.length + 1);
  }
  for (const [index, program] of programs.entries()) {
    const at = ehsize + index * phentsize;
    const body = programOffsets[index] ?? 0;
    write32(at, program.type);
    if (bits === 64) {
      write64(at + 8, body);
      write64(at + 32, program.data.length);
      write64(at + 40, program.data.length);
      write64(at + 48, program.align ?? 4);
    } else {
      write32(at + 4, body);
      write32(at + 16, program.data.length);
      write32(at + 20, program.data.length);
      write32(at + 28, program.align ?? 4);
    }
    program.data.copy(bytes, body);
  }
  for (const [index, entry] of entries.entries()) {
    const at = shoff + index * shentsize;
    write32(at, nameOffsets.get(entry.name) ?? 0);
    write32(at + 4, entry.type);
    if (bits === 64) {
      write64(at + 24, entry.offset);
      write64(at + 32, entry.size);
      write64(at + 48, entry.align);
      write64(at + 56, entry.entsize);
    } else {
      write32(at + 16, entry.offset);
      write32(at + 20, entry.size);
      write32(at + 32, entry.align);
      write32(at + 36, entry.entsize);
    }
    entry.data.copy(bytes, entry.offset);
  }
  return bytes;
};

const elfNote = (input: { readonly owner: string; readonly type: number; readonly description: Buffer }, little = true, alignment = 4): Buffer => {
  const name = Buffer.from(input.owner === '' ? '' : `${input.owner}\0`, 'latin1');
  const header = Buffer.alloc(12);
  if (little) {
    header.writeUInt32LE(name.length, 0);
    header.writeUInt32LE(input.description.length, 4);
    header.writeUInt32LE(input.type, 8);
  } else {
    header.writeUInt32BE(name.length, 0);
    header.writeUInt32BE(input.description.length, 4);
    header.writeUInt32BE(input.type, 8);
  }
  return Buffer.concat([header, padTo(name, alignment), padTo(input.description, alignment)]);
};

const gnuAbiTag = (os: number, major: number, minor: number, subminor: number): Buffer => {
  const description = Buffer.alloc(16);
  description.writeUInt32LE(os, 0);
  description.writeUInt32LE(major, 4);
  description.writeUInt32LE(minor, 8);
  description.writeUInt32LE(subminor, 12);
  return description;
};

const noteElf = (notes: readonly Buffer[], options: { readonly bits?: 32 | 64; readonly shstrndx?: number } = {}): Buffer => {
  const bytes = elf({
    bits: options.bits ?? 64,
    type: 3,
    machine: 40,
    sections: [{ name: '.note.test', type: 7, data: Buffer.concat(notes), align: 4 }],
  });
  if (options.shstrndx === undefined) return bytes;
  bytes.writeUInt16LE(options.shstrndx, (options.bits ?? 64) === 64 ? 62 : 50);
  return bytes;
};

const kernelVersions = (entries: readonly { readonly crc: number; readonly name: string }[], crcBytes: 4 | 8): Buffer =>
  Buffer.concat(
    entries.map((entry) => {
      const record = Buffer.alloc(64);
      if (crcBytes === 8) record.writeBigUInt64LE(BigInt(entry.crc), 0);
      else record.writeUInt32LE(entry.crc, 0);
      record.write(entry.name, crcBytes, 'latin1');
      return record;
    }),
  );

const beam = (chunks: readonly { readonly name: string; readonly payload: Buffer }[]): Buffer => {
  const body = Buffer.concat(chunks.map((chunk) => Buffer.concat([Buffer.from(chunk.name, 'ascii'), u32be(chunk.payload.length), chunk.payload, Buffer.alloc((4 - (chunk.payload.length % 4)) % 4)])));
  return Buffer.concat([Buffer.from('FOR1', 'ascii'), u32be(body.length), Buffer.from('BEAM', 'ascii'), body]);
};

const beamAtoms = (names: readonly string[]): Buffer => Buffer.concat([u32be(names.length), ...names.map((name) => Buffer.concat([Buffer.from([Buffer.byteLength(name, 'latin1')]), Buffer.from(name, 'latin1')]))]);

const beamCode = (counts: readonly number[], instructions: Buffer, infoBytes = 16): Buffer => Buffer.concat([u32be(infoBytes), ...counts.map((count) => u32be(count)), Buffer.alloc(Math.max(0, infoBytes - 16)), instructions]);

const sentinel = Buffer.from(ELECTRON_FUSE_SENTINEL, 'ascii');

const fuseWire = (version: number, states: readonly number[]): Buffer => Buffer.from([version, states.length, ...states]);

const thinMacho = (wire: Buffer, magic = 0xfeedfacf, cpu = 0x0100000c): Buffer => {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(magic, 0);
  header.writeUInt32LE(cpu, 4);
  return Buffer.concat([header, sentinel, wire]);
};

const fatMacho = (bodies: readonly Buffer[], little = false, cpu = 0x0100000c): Buffer => {
  const header = Buffer.alloc(8 + bodies.length * 20);
  if (little) {
    header.writeUInt32LE(0xcafebabe, 0);
    header.writeUInt32LE(bodies.length, 4);
  } else {
    header.writeUInt32BE(0xcafebabe, 0);
    header.writeUInt32BE(bodies.length, 4);
  }
  let cursor = header.length;
  for (const [index, body] of bodies.entries()) {
    const at = 8 + index * 20;
    if (little) {
      header.writeUInt32LE(cpu, at);
      header.writeUInt32LE(cursor, at + 8);
      header.writeUInt32LE(body.length, at + 12);
    } else {
      header.writeUInt32BE(cpu, at);
      header.writeUInt32BE(cursor, at + 8);
      header.writeUInt32BE(body.length, at + 12);
    }
    cursor += body.length;
  }
  return Buffer.concat([header, ...bodies]);
};

const peFuse = (wire: Buffer): Buffer => Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(30), sentinel, wire]);

const elfFuse = (wire: Buffer): Buffer => Buffer.concat([Buffer.from('\u007fELF', 'latin1'), Buffer.alloc(28), sentinel, wire]);

const derLength = (length: number, count: number): Buffer => {
  const bytes = Buffer.alloc(1 + count);
  bytes[0] = 0x80 | count;
  bytes.writeUIntBE(length, 1, count);
  return bytes;
};

const der = (tag: number, content: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), content.length < 128 ? Buffer.from([content.length]) : derLength(content.length, 1), content]);

test('inspect_devicetree reports every field of the fixture blob', async () => {
  const path = fixturePath('targets/devicetree/board.dtb');
  const { report, resolvedPath } = await inspectDevicetreeFromPath({ path });

  expect(resolvedPath).toBe(path);
  expect(report.artifact.bytes).toBe(104);
  expect(report.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.header).toStrictEqual({
    magic: 0xd00dfeed,
    totalsize: 104,
    off_dt_struct: 56,
    off_dt_strings: 92,
    off_mem_rsvmap: 40,
    version: 17,
    last_comp_version: 16,
    boot_cpuid_phys: 0,
    size_dt_strings: 12,
    size_dt_struct: 36,
  });
  expect(report.reservations).toStrictEqual([]);
  expect(report.nodes).toStrictEqual([
    {
      path: '/',
      parent: null,
      offset: 56,
      properties: [
        {
          name: 'model',
          offset: 76,
          bytes: 6,
          hex: '626f61726400',
          truncated: false,
          derived: { confidence: 'derived', strings: ['board'], cells: null, reg: null },
        },
      ],
    },
  ]);
  expect(report.references).toStrictEqual([]);
  expect(report.summary).toStrictEqual({ confidence: 'derived', compatible: null, model: 'board', bootargs: null, stdout_path: null, aliases: [] });
  expect(report.coverage).toStrictEqual({ status: 'complete', examined_nodes: 1, examined_properties: 1 });
  expect(report.limitations).toStrictEqual([
    'Raw property previews are limited to 256 bytes; offsets and lengths identify complete values in the hashed artifact.',
    'Phandle references cover only single-cell interrupt-parent, remote-endpoint and msi-parent; binding-specific arrays and overlays are not resolved.',
  ]);
});

test('inspect_devicetree decodes phandles, reg tuples, aliases', async () => {
  const targets = await tempTargets();
  const path = await targets.write('rich.dtb', richFdt());
  const { report } = await inspectDevicetreeFromPath({ path });

  expect(report.summary).toStrictEqual({
    confidence: 'derived',
    compatible: ['acme,board', 'acme,alt'],
    model: 'Acme Board',
    bootargs: 'console=ttyS0',
    stdout_path: 'serial0:115200n8',
    aliases: [
      { name: 'serial0', path: '/soc/serial@1000' },
      { name: 'broken', path: null },
    ],
  });
  expect(report.coverage).toStrictEqual({ status: 'complete', examined_nodes: 14, examined_properties: 23 });
  expect(report.reservations).toStrictEqual([]);
  expect(report.nodes.map((node) => node.path)).toStrictEqual([
    '/',
    '/aliases',
    '/chosen',
    '/intc',
    '/soc',
    '/soc/serial@1000',
    '/soc/broken@0',
    '/bad-cells',
    '/bad-cells/child@0',
    '/conflict',
    '/malformed-handle',
    '/dup-a',
    '/dup-b',
    '/truncated-preview',
  ]);
  const serial = report.nodes.find((node) => node.path === '/soc/serial@1000');
  expect(serial?.properties[0]?.derived.reg).toStrictEqual([{ address: '0x1000', size: null }]);
  const preview = report.nodes.find((node) => node.path === '/truncated-preview')?.properties[0];
  expect(preview).toMatchObject({ name: 'blob', bytes: 300, truncated: true });
  expect(preview?.hex).toHaveLength(512);
  expect(report.references).toStrictEqual([
    { source: '/soc', property: 'interrupt-parent', phandle: 1, target: '/intc', confidence: 'derived' },
    { source: '/conflict', property: 'msi-parent', phandle: 2, target: null, confidence: 'derived' },
    { source: '/dup-a', property: 'remote-endpoint', phandle: 4, target: null, confidence: 'derived' },
    { source: '/dup-b', property: 'remote-endpoint', phandle: 0xffffffff, target: null, confidence: 'derived' },
  ]);
  expect(report.limitations).toStrictEqual([
    'Raw property previews are limited to 256 bytes; offsets and lengths identify complete values in the hashed artifact.',
    'Phandle references cover only single-cell interrupt-parent, remote-endpoint and msi-parent; binding-specific arrays and overlays are not resolved.',
    'reg at /soc/broken@0 was not decoded: unsupported or malformed parent cell sizes or tuple length.',
    'reg at /bad-cells/child@0 was not decoded: unsupported or malformed parent cell sizes or tuple length.',
    'phandle at /conflict conflicts with linux,phandle (0x2 vs 0x3); references to either value are unresolved.',
    "phandle at /malformed-handle is not a single cell; this node's reference identity remains unresolved.",
  ]);
});

test('inspect_devicetree decodes a version 16 blob with the structure first', async () => {
  const targets = await tempTargets();
  const path = await targets.write('v16.dtb', miniFdt({ version: 16 }));
  const { report } = await inspectDevicetreeFromPath({ path });

  expect(report.header).toMatchObject({ version: 16, last_comp_version: 16, size_dt_struct: null });
  expect(report.summary.model).toBe('x');
  expect(report.artifact.bytes).toBe(94);
});

test('inspect_devicetree decodes a version 16 blob with the structure last', async () => {
  const targets = await tempTargets();
  const path = await targets.write('v16-last.dtb', miniFdt({ version: 16, stringsFirst: true }));
  const { report } = await inspectDevicetreeFromPath({ path });

  expect(report.header).toMatchObject({ version: 16, off_dt_strings: 56, size_dt_struct: null });
  expect(report.summary.model).toBe('x');
  expect(report.coverage.examined_properties).toBe(1);
});

test('inspect_devicetree records reservations as 64-bit spans', async () => {
  const targets = await tempTargets();
  const path = await targets.write('reserved.dtb', fdt([{ name: '' }], { reservations: [{ address: 0x1000n, size: 0x20n }] }));
  const { report } = await inspectDevicetreeFromPath({ path });

  expect(report.reservations).toStrictEqual([{ offset: 40, address: '0x1000', size: '0x20' }]);
  expect(report.header.off_mem_rsvmap).toBe(40);
});

const devicetreeErrors: readonly { readonly name: string; readonly bytes: () => Buffer; readonly message: string; readonly reason: 'malformed' | 'unsupported' }[] = [
  { name: 'a truncated header', bytes: () => miniFdt().subarray(0, 20), message: 'Truncated FDT header', reason: 'malformed' },
  { name: 'a foreign magic', bytes: () => miniPatched((blob) => blob.writeUInt32BE(0x12345678, 0)), message: 'Not a flattened devicetree blob', reason: 'unsupported' },
  {
    name: 'an unsupported version',
    bytes: () => miniPatched((blob) => blob.writeUInt32BE(99, 20)),
    message: 'FDT version 99 is unsupported; supported versions are 16 and 17',
    reason: 'unsupported',
  },
  { name: 'a short version 16 header', bytes: () => miniFdt({ version: 16 }).subarray(0, 30), message: 'Truncated FDT header', reason: 'malformed' },
  {
    name: 'a totalsize past the buffer',
    bytes: () => miniPatched((blob) => blob.writeUInt32BE(200, 4)),
    message: 'Invalid FDT header size or compatibility version',
    reason: 'malformed',
  },
  {
    name: 'a totalsize below the header',
    bytes: () => miniPatched((blob) => blob.writeUInt32BE(20, 4)),
    message: 'Invalid FDT header size or compatibility version',
    reason: 'malformed',
  },
  {
    name: 'a future compatibility version',
    bytes: () => miniPatched((blob) => blob.writeUInt32BE(18, 24)),
    message: 'Invalid FDT header size or compatibility version',
    reason: 'malformed',
  },
  { name: 'a strings block past totalsize', bytes: () => miniPatched((blob) => blob.writeUInt32BE(90, 12)), message: 'FDT block outside totalsize', reason: 'malformed' },
  { name: 'a strings block inside the structure', bytes: () => miniPatched((blob) => blob.writeUInt32BE(80, 12)), message: 'Overlapping FDT blocks', reason: 'malformed' },
  { name: 'a misaligned structure block', bytes: () => miniPatched((blob) => blob.writeUInt32BE(58, 8)), message: 'Misaligned FDT block', reason: 'malformed' },
  { name: 'a misaligned reservation block', bytes: () => miniPatched((blob) => blob.writeUInt32BE(44, 16)), message: 'Misaligned FDT block', reason: 'malformed' },
  {
    name: 'a reservation without a terminator',
    bytes: () => miniPatched((blob) => blob.writeBigUInt64BE(1n, 40)),
    message: 'Unterminated or overlapping FDT reservation block',
    reason: 'malformed',
  },
  {
    name: 'a reservation inside the structure',
    bytes: () => miniPatched((blob) => blob.writeUInt32BE(64, 16)),
    message: 'Reservation block overlaps another FDT block',
    reason: 'malformed',
  },
  { name: 'a name without a terminator', bytes: () => miniPatched((blob) => blob.writeUInt8(0x41, 93)), message: 'Unterminated FDT name', reason: 'malformed' },
  { name: 'a non-ASCII name', bytes: () => miniPatched((blob) => blob.writeUInt8(0x01, 88)), message: 'Non-ASCII FDT name', reason: 'malformed' },
  { name: 'a named root node', bytes: () => fdt([{ name: 'root' }]), message: 'Invalid FDT node name or multiple roots', reason: 'malformed' },
  { name: 'two root nodes', bytes: () => fdt([{ name: '' }, { name: '' }]), message: 'Invalid FDT node name or multiple roots', reason: 'malformed' },
  { name: 'an unnamed child node', bytes: () => fdt([{ name: '', children: [{ name: '' }] }]), message: 'Invalid FDT node name or multiple roots', reason: 'malformed' },
  { name: 'a node name with a slash', bytes: () => fdt([{ name: '', children: [{ name: 'a/b' }] }]), message: 'Invalid FDT node name or multiple roots', reason: 'malformed' },
  { name: 'a duplicate node path', bytes: () => fdt([{ name: '', children: [{ name: 'a' }, { name: 'a' }] }]), message: 'Duplicate FDT node path', reason: 'malformed' },
  {
    name: 'a structure block cut short',
    bytes: () => miniPatched((blob) => blob.writeUInt32BE(6, 36)),
    message: 'Truncated FDT structure token or property',
    reason: 'malformed',
  },
  { name: 'a stray end-node token', bytes: () => miniPatched((blob) => blob.writeUInt32BE(2, 84)), message: 'Unbalanced FDT_END_NODE', reason: 'malformed' },
  {
    name: 'a property before any node',
    bytes: () => miniPatched((blob) => blob.writeUInt32BE(3, 56)),
    message: 'FDT property outside node or after children',
    reason: 'malformed',
  },
  {
    name: 'a property after a child node',
    bytes: () => rawFdt(Buffer.concat([u32be(1), Buffer.alloc(4), u32be(1), Buffer.from('a\0\0\0', 'latin1'), u32be(2), u32be(3), u32be(4), u32be(0), Buffer.alloc(4), u32be(9)]), { strings: Buffer.from('model\0', 'latin1') }),
    message: 'FDT property outside node or after children',
    reason: 'malformed',
  },
  {
    name: 'a string offset past the table',
    bytes: () => miniPatched((blob) => blob.writeUInt32BE(6, 72)),
    message: 'FDT property string offset out of range',
    reason: 'malformed',
  },
  { name: 'an empty property name', bytes: () => miniPatched((blob) => blob.writeUInt8(0, 88)), message: 'Empty or duplicate FDT property name', reason: 'malformed' },
  {
    name: 'a duplicate property name',
    bytes: () =>
      fdt([
        {
          name: '',
          properties: [
            { name: 'model', value: Buffer.from('x\0', 'latin1') },
            { name: 'model', value: Buffer.from('y\0', 'latin1') },
          ],
        },
      ]),
    message: 'Empty or duplicate FDT property name',
    reason: 'malformed',
  },
  { name: 'an end token before any node', bytes: () => rawFdt(u32be(9)), message: 'Premature FDT_END', reason: 'malformed' },
  {
    name: 'an end token before the structure ends',
    bytes: () => rawFdt(Buffer.concat([u32be(1), Buffer.alloc(4), u32be(2), u32be(9), u32be(4)])),
    message: 'FDT_END does not terminate the declared structure block',
    reason: 'malformed',
  },
  { name: 'an unknown structure token', bytes: () => miniPatched((blob) => blob.writeUInt32BE(7, 56)), message: 'Unknown FDT token 7', reason: 'malformed' },
  {
    name: 'a structure without an end token',
    bytes: () => rawFdt(Buffer.concat([u32be(1), Buffer.alloc(4), u32be(2)])),
    message: 'Missing FDT_END',
    reason: 'malformed',
  },
];

test.for(devicetreeErrors)('inspect_devicetree rejects $name', async ({ bytes, message, reason }) => {
  const targets = await tempTargets();
  const path = await targets.write('blob.dtb', bytes());
  const session = new ReaSession(runtime);
  const payload = await payloadOf(() => inspectDevicetree(session, { path }));

  expect(payload).toMatchObject({
    code: 'unsupported_target',
    category: 'unsupported_target',
    message,
    retryable: false,
    details: { operation: 'inspect_devicetree', reason },
  });
  expect(session.evidence.size).toBe(0);
});

const devicetreeLimits: readonly {
  readonly name: string;
  readonly blob: () => Buffer;
  readonly limit: string;
  readonly params: { readonly max_file_bytes?: number; readonly max_nodes?: number; readonly max_properties?: number; readonly max_depth?: number };
}[] = [
  { name: 'a byte limit', blob: () => miniFdt(), limit: 'max_file_bytes', params: { max_file_bytes: 40 } },
  { name: 'a node limit', blob: () => miniFdt(), limit: 'max_nodes', params: { max_nodes: 0 } },
  { name: 'a property limit', blob: () => miniFdt(), limit: 'max_properties', params: { max_properties: 0 } },
  { name: 'a depth limit', blob: () => fdt([{ name: '', children: [{ name: 'a' }] }]), limit: 'max_depth', params: { max_depth: 1 } },
  {
    name: 'a reservation property limit',
    blob: () => fdt([{ name: '' }], { reservations: [{ address: 1n, size: 1n }] }),
    limit: 'max_properties',
    params: { max_properties: 0 },
  },
];

test.for(devicetreeLimits)('inspect_devicetree enforces $name', async ({ blob, limit, params }) => {
  const targets = await tempTargets();
  const path = await targets.write('limited.dtb', blob());
  const session = new ReaSession(runtime);
  const payload = await payloadOf(() => inspectDevicetree(session, { ...params, path }));

  expect(payload).toMatchObject({
    code: 'resource_constraint',
    category: 'resource_constraint',
    message: expect.stringMatching(/^Devicetree exceeds [a-z_]+; raise that caller-selected limit/),
    retryable: false,
    details: { operation: 'inspect_devicetree', limit },
  });
  expect(session.evidence.size).toBe(0);
});

test('inspect_devicetree refuses a blob past the decoded byte allowance', async () => {
  const targets = await tempTargets();
  const path = await targets.write('deep.dtb', nestedFdt(3000));
  const session = new ReaSession(runtime);
  const payload = await payloadOf(() => inspectDevicetree(session, { path, max_nodes: 4096, max_depth: 4096 }));

  expect(payload).toMatchObject({
    code: 'resource_constraint',
    message: 'Devicetree exceeds its fixed 32 MiB decoded representation allowance; select a smaller blob. This allowance has no runtime override.',
    details: { operation: 'inspect_devicetree', limit: 'decoded_bytes' },
  });
  expect(session.evidence.size).toBe(0);
});

test('inspect_devicetree skips a no-op structure token', async () => {
  const targets = await tempTargets();
  const path = await targets.write('nop.dtb', rawFdt(Buffer.concat([u32be(4), u32be(1), Buffer.alloc(4), u32be(2), u32be(4), u32be(9)])));
  const { report } = await inspectDevicetreeFromPath({ path });

  expect(report.nodes).toStrictEqual([{ path: '/', parent: null, offset: 60, properties: [] }]);
  expect(report.coverage).toStrictEqual({ status: 'complete', examined_nodes: 1, examined_properties: 0 });
});

test('inspect_devicetree ignores zero or all-ones phandles', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'handles.dtb',
    fdt([
      {
        name: '',
        children: [
          { name: 'zero', properties: [{ name: 'phandle', value: u32be(0) }] },
          { name: 'last', properties: [{ name: 'linux,phandle', value: u32be(0xffffffff) }] },
          { name: 'ref', properties: [{ name: 'interrupt-parent', value: u32be(0) }] },
          { name: 'ref-last', properties: [{ name: 'interrupt-parent', value: u32be(0xffffffff) }] },
        ],
      },
    ]),
  );
  const { report } = await inspectDevicetreeFromPath({ path });

  expect(report.references).toStrictEqual([
    { source: '/ref', property: 'interrupt-parent', phandle: 0, target: null, confidence: 'derived' },
    { source: '/ref-last', property: 'interrupt-parent', phandle: 0xffffffff, target: null, confidence: 'derived' },
  ]);
  expect(report.limitations).toHaveLength(2);
});

test('inspect_devicetree refuses a path that is not a regular file', async () => {
  const targets = await tempTargets();
  const payload = await payloadOf(() => inspectDevicetreeFromPath({ path: targets.dir }));

  expect(payload).toMatchObject({
    code: 'unsupported_target',
    message: 'inspect_devicetree accepts a regular file.',
    details: { path: targets.dir, reason: 'not a regular file' },
  });
});

test('inspect_devicetree reports a path that cannot be read', async () => {
  const targets = await tempTargets();
  const missing = `${targets.dir}/absent.dtb`;
  const payload = await payloadOf(() => inspectDevicetreeFromPath({ path: missing }));

  expect(payload).toMatchObject({ code: 'unsupported_target', details: { path: missing, reason: 'unreadable' } });
  expect(payload.message).toMatch(/^Cannot read device-tree blob: ENOENT/);
});

test('inspect_devicetree refuses an empty path', async () => {
  const payload = await payloadOf(() => inspectDevicetreeFromPath({ path: '' }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Invalid arguments for tool inspect_devicetree: path: Invalid input: expected string, received undefined',
    details: { parameter: 'path' },
  });
});

test('inspect_devicetree refuses a relative path', async () => {
  const targets = await tempTargets();
  const payload = await payloadOf(() => inspectDevicetreeFromPath({ path: 'board.dtb' }, { cwd: targets.dir }));

  expect(payload.code).toBe('invalid_request');
  expect(payload.message).toBe('Expected an absolute filesystem path on this host.');
  expect(payload.details).toStrictEqual({
    operation: 'inspect_devicetree',
    issues: [{ path: ['path'], reason: 'invalid_format', message: 'Expected an absolute filesystem path on this host.' }],
  });
});

test('inspect_elf_notes decodes both note tables of the fixture', async () => {
  const path = fixturePath('targets/elf/notes-and-dep.so');
  const { record, resolvedPath } = await inspectElfNotesFromPath(path);

  expect(resolvedPath).toBe(path);
  expect(record.artifact.bytes).toBe(600);
  expect(record.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(record.format).toBe('elf64');
  expect(record.byte_order).toBe('little');
  expect(record.machine).toBe(62);
  expect(record.type).toBe(2);
  expect(record.type_name).toBe('executable');
  expect(record.tables).toStrictEqual([
    { kind: 'program', index: 0, name: null, location: { offset: 120, bytes: 32 }, alignment: 4 },
    { kind: 'section', index: 2, name: '.note.gnu.build-id', location: { offset: 120, bytes: 32 }, alignment: 4 },
  ]);
  expect(record.entries).toHaveLength(2);
  expect(record.entries[0]).toMatchObject({
    index: 0,
    table_kind: 'program',
    table_index: 0,
    location: { offset: 120, bytes: 32 },
    namesz: 4,
    descsz: 16,
    type: 3,
    type_name: 'gnu_build_id',
    owner: 'GNU',
    owner_bytes_hex: '474e5500',
  });
  expect(record.entries[0]?.descriptor).toStrictEqual({
    location: { offset: 136, bytes: 16 },
    bytes: 16,
    sha256: '5dfbabeedf318bf33c0927c43d7630f51b82f351740301354fa3d7fc51f0132e',
    hex: '0102030405060708090a0b0c0d0e0f10',
  });
  expect(record.entries[1]).toMatchObject({ index: 1, table_kind: 'section', table_index: 2, type_name: 'gnu_build_id' });
  expect(record.entries[1]?.gnu).toStrictEqual({ build_id_hex: '0102030405060708090a0b0c0d0e0f10', abi_tag: null, gold_version: null });
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_tables: 2, examined_entries: 2 });
  expect(record.limitations).toStrictEqual([
    'This workflow does not execute the image, resolve runtime notes, or verify GNU build-id uniqueness against package catalogs.',
    'PT_NOTE and SHT_NOTE are examined independently; the same file range may appear twice when both tables declare it.',
  ]);
});

test('inspect_elf_notes decodes GNU ABI, gold, property notes', async () => {
  const targets = await tempTargets();
  const notes = [
    elfNote({ owner: 'GNU', type: 1, description: gnuAbiTag(3, 1, 2, 3) }),
    elfNote({ owner: 'GNU', type: 4, description: Buffer.from('GNU gold 1.16\0\0', 'latin1') }),
    elfNote({ owner: 'GNU', type: 5, description: Buffer.alloc(80, 0xab) }),
    elfNote({ owner: 'LINUX', type: 0, description: Buffer.from('xyz', 'latin1') }),
    elfNote({ owner: 'GNU', type: 2, description: Buffer.alloc(0) }),
    elfNote({ owner: 'GNU', type: 1, description: Buffer.alloc(8, 1) }),
    elfNote({ owner: '', type: 3, description: Buffer.alloc(4, 0xff) }),
  ];
  const path = await targets.write('notes.so', noteElf(notes));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.format).toBe('elf64');
  expect(record.type_name).toBe('shared');
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_tables: 1, examined_entries: 7 });
  expect(record.entries.map((entry) => ({ index: entry.index, type_name: entry.type_name, owner: entry.owner, descsz: entry.descsz }))).toStrictEqual([
    { index: 0, type_name: 'gnu_abi_tag', owner: 'GNU', descsz: 16 },
    { index: 1, type_name: 'gnu_gold_version', owner: 'GNU', descsz: 15 },
    { index: 2, type_name: 'gnu_property', owner: 'GNU', descsz: 80 },
    { index: 3, type_name: 'unknown', owner: 'LINUX', descsz: 3 },
    { index: 4, type_name: 'gnu_hwcap', owner: 'GNU', descsz: 0 },
    { index: 5, type_name: 'gnu_abi_tag', owner: 'GNU', descsz: 8 },
    { index: 6, type_name: 'unknown', owner: '', descsz: 4 },
  ]);
  expect(record.entries[0]?.gnu).toStrictEqual({
    build_id_hex: null,
    abi_tag: { os: 3, os_name: 'FreeBSD', major: 1, minor: 2, subminor: 3 },
    gold_version: null,
  });
  expect(record.entries[1]?.gnu).toStrictEqual({ build_id_hex: null, abi_tag: null, gold_version: 'GNU gold 1.16' });
  expect(record.entries[2]?.descriptor).toMatchObject({ bytes: 80, hex: 'ab'.repeat(64) });
  expect(record.entries[3]?.descriptor.hex).toBe('78797a');
  expect(record.entries[4]?.descriptor).toMatchObject({ bytes: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', hex: null });
  expect(record.entries[5]?.gnu).toStrictEqual({ build_id_hex: null, abi_tag: null, gold_version: null });
  expect(record.entries[6]).toMatchObject({ owner_bytes_hex: '', gnu: null, descriptor: { hex: 'ffffffff' } });
});

test('inspect_elf_notes decodes a big-endian note table', async () => {
  const targets = await tempTargets();
  const path = await targets.write('be.so', elf({ little: false, type: 3, machine: 40, sections: [{ name: '.note.test', type: 7, data: elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(8, 0x5a) }, false), align: 4 }] }));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.byte_order).toBe('big');
  expect(record.format).toBe('elf64');
  expect(record.entries).toHaveLength(1);
  expect(record.entries[0]).toMatchObject({ namesz: 4, descsz: 8, owner: 'GNU', type_name: 'gnu_build_id' });
  expect(record.entries[0]?.gnu?.build_id_hex).toBe('5a5a5a5a5a5a5a5a');
});

test('inspect_elf_notes decodes a 32-bit note table', async () => {
  const targets = await tempTargets();
  const path = await targets.write('elf32.so', noteElf([elfNote({ owner: 'GNU', type: 2, description: Buffer.alloc(4, 0x11) })], { bits: 32 }));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.format).toBe('elf32');
  expect(record.type_name).toBe('shared');
  expect(record.entries[0]).toMatchObject({ namesz: 4, descsz: 4, type_name: 'gnu_hwcap' });
  expect(record.entries[0]?.descriptor.hex).toBe('11111111');
});

test('inspect_elf_notes keeps note tables without a name section', async () => {
  const targets = await tempTargets();
  const path = await targets.write('unnamed.so', noteElf([elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x22) })], { shstrndx: 5 }));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.tables).toStrictEqual([{ kind: 'section', index: 1, name: null, location: { offset: 64, bytes: 20 }, alignment: 4 }]);
  expect(record.entries[0]?.gnu?.build_id_hex).toBe('22222222');
});

test('inspect_elf_notes reports a zero-alignment table as four', async () => {
  const targets = await tempTargets();
  const note = elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x33) });
  const path = await targets.write('program.so', elf({ type: 2, machine: 62, programs: [{ type: 4, data: note, align: 0 }], sections: [{ name: '.note.seg', type: 7, data: note, align: 0 }] }));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.tables.map((table) => ({ kind: table.kind, alignment: table.alignment }))).toStrictEqual([
    { kind: 'program', alignment: 4 },
    { kind: 'section', alignment: 4 },
  ]);
  expect(record.coverage.examined_entries).toBe(2);
});

test('inspect_elf_notes refuses a note entry budget overrun', async () => {
  const targets = await tempTargets();
  const notes = [0x44, 0x55, 0x66].map((fill) => elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, fill) }));
  const path = await targets.write('budget.so', noteElf(notes));
  const payload = await payloadOf(() => inspectElfNotesFromPath(path, { maxEntries: 2 }));

  expect(payload).toMatchObject({ code: 'invalid_request', details: { operation: 'inspect_elf_notes', issues: [{ path: ['path'], reason: 'invalid_value' }] } });
  expect(payload.details).toMatchObject({ issues: [{ message: `Cannot inspect ${path}: the note tables exceed the 2 entry limit` }] });
});

test('inspect_elf_notes refuses a note entry that overruns its table', async () => {
  const targets = await tempTargets();
  const note = elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(64, 0x77) });
  const path = await targets.write('truncated.so', elf({ type: 3, machine: 40, sections: [{ name: '.note.test', type: 7, data: note, align: 4, size: 40 }] }));
  const payload = await payloadOf(() => inspectElfNotesFromPath(path));

  expect(payload.code).toBe('invalid_request');
  expect(payload.details).toMatchObject({ issues: [{ path: ['path'], reason: 'invalid_format', message: `Cannot inspect ${path}: truncated note entry` }] });
});

test.for([
  { name: 'a fractional byte limit', options: { maxFileBytes: 64.5 }, message: 'max_file_bytes must be an integer between 64 and 536870912.' },
  { name: 'a byte limit below the floor', options: { maxFileBytes: 32 }, message: 'max_file_bytes must be an integer between 64 and 536870912.' },
  { name: 'a byte limit above the ceiling', options: { maxFileBytes: 536_870_913 }, message: 'max_file_bytes must be an integer between 64 and 536870912.' },
  { name: 'a zero entry budget', options: { maxEntries: 0 }, message: 'max_entries must be an integer between 1 and 256.' },
  { name: 'a fractional entry budget', options: { maxEntries: 1.5 }, message: 'max_entries must be an integer between 1 and 256.' },
  { name: 'an entry budget above the ceiling', options: { maxEntries: 257 }, message: 'max_entries must be an integer between 1 and 256.' },
])('inspect_elf_notes rejects $name', async ({ options, message }) => {
  const targets = await tempTargets();
  const path = await targets.write('limits.so', noteElf([]));
  const payload = await payloadOf(() => inspectElfNotesFromPath(path, options));

  expect(payload).toMatchObject({ code: 'invalid_request', details: { issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${message}` }] } });
});

test.for([
  { name: 'a file above the byte limit', bytes: () => Buffer.alloc(100), message: 'the image is 100 bytes, more than the 64 byte limit', reason: 'invalid_value', maxFileBytes: 64 },
  { name: 'a short non-ELF file', bytes: () => Buffer.from('not an elf image', 'latin1'), message: 'the file is not an ELF image.', reason: 'invalid_format', maxFileBytes: 4096 },
  { name: 'a file without the ELF magic', bytes: () => Buffer.alloc(16, 0x41), message: 'the file is not an ELF image.', reason: 'invalid_format', maxFileBytes: 4096 },
  { name: 'an unknown ELF class', bytes: () => patched(noteElf([]), (blob) => blob.writeUInt8(7, 4)), message: 'unsupported ELF class or endianness.', reason: 'invalid_format', maxFileBytes: 4096 },
  { name: 'an unknown ELF endianness', bytes: () => patched(noteElf([]), (blob) => blob.writeUInt8(9, 5)), message: 'unsupported ELF class or endianness.', reason: 'invalid_format', maxFileBytes: 4096 },
  {
    name: 'a truncated ELF header',
    bytes: () => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), Buffer.alloc(25)]),
    message: 'truncated ELF header',
    reason: 'invalid_format',
    maxFileBytes: 4096,
  },
  {
    name: 'an offset past the safe integer range',
    bytes: () => patched(noteElf([]), (blob) => blob.writeBigUInt64LE(2n ** 60n, 32)),
    message: 'u64 exceeds safe integer',
    reason: 'invalid_format',
    maxFileBytes: 4096,
  },
  {
    name: 'a truncated program header',
    bytes: () => elf({ type: 2, machine: 62, programs: [{ type: 4, data: Buffer.alloc(8), align: 4 }] }).subarray(0, 72),
    message: 'truncated program header',
    reason: 'invalid_format',
    maxFileBytes: 4096,
  },
  {
    name: 'a truncated section header',
    bytes: () => patched(noteElf([]), (blob) => blob.writeUInt16LE(5, 62)).subarray(0, 64),
    message: 'truncated section header',
    reason: 'invalid_format',
    maxFileBytes: 4096,
  },
])('inspect_elf_notes rejects $name', async ({ bytes, message, reason, maxFileBytes }) => {
  const targets = await tempTargets();
  const path = await targets.write('broken.so', bytes());
  const payload = await payloadOf(() => inspectElfNotesFromPath(path, { maxFileBytes }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    category: 'invalid_input',
    details: { operation: 'inspect_elf_notes', issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${message}` }] },
  });
});

test('inspect_elf_notes skips a string table beyond the file', async () => {
  const targets = await tempTargets();
  const built = noteElf([elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x33) })]);
  const shoff = Number(built.readBigUInt64LE(40));
  const path = await targets.write(
    'beyond.so',
    patched(built, (blob) => blob.writeBigUInt64LE(4096n, shoff + 64 * 2 + 24)),
  );
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.tables).toStrictEqual([{ kind: 'section', index: 1, name: null, location: { offset: 64, bytes: 20 }, alignment: 4 }]);
  expect(record.entries[0]?.gnu?.build_id_hex).toBe('33333333');
});

test('inspect_elf_notes decodes a note section with a 16-byte alignment', async () => {
  const targets = await tempTargets();
  const note = elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x77) });
  const path = await targets.write('aligned.so', elf({ type: 3, machine: 62, sections: [{ name: '.note.aligned', type: 7, data: note, align: 16 }] }));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.tables).toStrictEqual([{ kind: 'section', index: 1, name: '.note.aligned', location: { offset: 64, bytes: 20 }, alignment: 16 }]);
  expect(record.entries).toHaveLength(1);
});

test('inspect_elf_notes reports a missing image', async () => {
  const targets = await tempTargets();
  const missing = `${targets.dir}/missing.so`;
  const payload = await payloadOf(() => inspectElfNotesFromPath(missing));

  expect(payload.details).toMatchObject({ issues: [{ message: `Cannot inspect ${missing}: no file exists there` }] });
});

test('inspect_elf_notes reports a directory that cannot be read', async () => {
  const targets = await tempTargets();
  const payload = await payloadOf(() => inspectElfNotesFromPath(targets.dir));

  expect(payload.code).toBe('invalid_request');
  expect(payload.details).toMatchObject({
    issues: [{ reason: 'invalid_value', message: expect.stringMatching(new RegExp(`^Cannot inspect ${targets.dir}: it could not be read \\(.*\\)$`)) }],
  });
});

test.for([
  { type: 1, name: 'relocatable' },
  { type: 4, name: 'core' },
  { type: 9, name: 'unknown' },
])('inspect_elf_notes names a type $type image', async ({ type, name }) => {
  const targets = await tempTargets();
  const path = await targets.write('typed.so', elf({ type, machine: 62 }));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.type).toBe(type);
  expect(record.type_name).toBe(name);
  expect(record.tables).toStrictEqual([]);
});

test('inspect_elf_notes names the ABI target operating systems', async () => {
  const targets = await tempTargets();
  const notes = [gnuAbiTag(0, 1, 0, 0), gnuAbiTag(1, 2, 0, 0), gnuAbiTag(2, 3, 0, 0), gnuAbiTag(9, 4, 0, 0)].map((description) => elfNote({ owner: 'GNU', type: 1, description }));
  notes.push(elfNote({ owner: 'GNU', type: 6, description: Buffer.from('vendor', 'latin1') }));
  const path = await targets.write('abi.so', noteElf(notes));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.entries.map((entry) => entry.gnu?.abi_tag?.os_name ?? null)).toStrictEqual(['Linux', 'GNU', 'Solaris', null, null]);
  expect(record.entries[4]).toMatchObject({ type_name: 'unknown', descsz: 6, gnu: { build_id_hex: null, abi_tag: null, gold_version: null } });
});

test('inspect_elf_notes packs notes for a one-byte alignment', async () => {
  const targets = await tempTargets();
  const note = elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x66) });
  const path = await targets.write('packed.so', elf({ type: 3, machine: 40, sections: [{ name: '.note.packed', type: 7, data: note, align: 1 }] }));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.tables).toStrictEqual([{ kind: 'section', index: 1, name: '.note.packed', location: { offset: 64, bytes: 20 }, alignment: 1 }]);
  expect(record.entries[0]).toMatchObject({ location: { offset: 64, bytes: 20 }, namesz: 4, descsz: 4 });
});

test('inspect_elf_notes skips program headers that are not notes', async () => {
  const targets = await tempTargets();
  const note = elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x55) });
  const path = await targets.write(
    'segments.so',
    elf({
      type: 2,
      machine: 62,
      programs: [
        { type: 1, data: Buffer.alloc(8, 0x7f), align: 16 },
        { type: 4, data: note, align: 16 },
      ],
    }),
  );
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.tables).toStrictEqual([{ kind: 'program', index: 1, name: null, location: { offset: 184, bytes: 20 }, alignment: 16 }]);
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_tables: 1, examined_entries: 1 });
});

test('inspect_elf_notes reads a 32-bit note program header', async () => {
  const targets = await tempTargets();
  const note = elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x44) });
  const path = await targets.write('segment32.so', elf({ bits: 32, type: 2, machine: 3, programs: [{ type: 4, data: note, align: 4 }] }));
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.format).toBe('elf32');
  expect(record.tables).toStrictEqual([{ kind: 'program', index: 0, name: null, location: { offset: 84, bytes: 20 }, alignment: 4 }]);
  expect(record.entries[0]?.gnu?.build_id_hex).toBe('44444444');
});

test('inspect_elf_notes resolves a relative image path', async () => {
  const targets = await tempTargets();
  await targets.write('relative.so', noteElf([elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x11) })]));
  const { record, resolvedPath } = await inspectElfNotesFromPath('relative.so', { cwd: targets.dir });

  expect(resolvedPath).toBe(`${targets.dir}/relative.so`);
  expect(record.artifact.path).toBe('relative.so');
  expect(record.entries).toHaveLength(1);
});

test('inspect_elf_notes keeps an unterminated section name whole', async () => {
  const targets = await tempTargets();
  const built = noteElf([elfNote({ owner: 'GNU', type: 3, description: Buffer.alloc(4, 0x11) })]);
  const names = built.indexOf(Buffer.from('.note.test\0.shstrtab\0', 'latin1'));
  const path = await targets.write(
    'unterminated.so',
    patched(built, (blob) => {
      blob.writeUInt8(0x58, names + 10);
      blob.writeUInt8(0x58, names + 20);
    }),
  );
  const { record } = await inspectElfNotesFromPath(path);

  expect(record.tables[0]?.name).toBe('.note.testX.shstrtabX');
  expect(record.entries[0]?.gnu?.build_id_hex).toBe('11111111');
});

test('inspect_kernel_module reports every fixture section entry', async () => {
  const path = fixturePath('targets/kernel/demo.ko');
  const { record, resolvedPath } = await inspectKernelModuleFromPath(path);

  expect(resolvedPath).toBe(path);
  expect(record.artifact.bytes).toBe(825);
  expect(record).toMatchObject({
    format: 'elf64',
    byte_order: 'little',
    machine: 62,
    type: 1,
    type_name: 'relocatable',
    applicability: 'applicable',
    compression: null,
    next_probe: null,
  });
  expect(record.modinfo).toMatchObject({ status: 'present', location: { offset: 153, bytes: 50 }, reason: null });
  expect(record.modinfo.entries.map((entry) => ({ index: entry.index, key: entry.key, value: entry.value, location: entry.location, status: entry.status, reason: entry.reason }))).toStrictEqual([
    { index: 0, key: 'name', value: 'demo', location: { offset: 153, bytes: 10 }, status: 'observed', reason: null },
    { index: 1, key: 'vermagic', value: '6.8.0 SMP', location: { offset: 163, bytes: 19 }, status: 'observed', reason: null },
    { index: 2, key: 'license', value: 'GPL', location: { offset: 182, bytes: 12 }, status: 'observed', reason: null },
    { index: 3, key: 'depends', value: '', location: { offset: 194, bytes: 9 }, status: 'observed', reason: null },
  ]);
  expect(record.modinfo.entries[0]?.raw_hex).toBe('6e616d653d64656d6f00');
  expect(record.modinfo.entries[0]?.raw_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(record.versions).toMatchObject({ status: 'present', layout: 'elf64_unsigned_long_name56', entry_bytes: 64, location: { offset: 241, bytes: 64 } });
  expect(record.versions.entries).toStrictEqual([{ index: 0, location: { offset: 241, bytes: 64 }, crc_hex: '6e69727011223344', name: 'tk', status: 'observed', reason: null }]);
  expect(record.this_module).toStrictEqual({ status: 'present', location: { offset: 209, bytes: 32 }, layout: 'unknown' });
  expect(record.ksymtab).toStrictEqual({ status: 'observed', sections: [{ name: '__ksymtab', location: { offset: 305, bytes: 8 }, compressed: false, reason: null }] });
  expect(record.init_text).toStrictEqual({ status: 'present', location: { offset: 203, bytes: 4 }, bytes: 4, compressed: false });
  expect(record.exit_text).toStrictEqual({ status: 'present', location: { offset: 207, bytes: 2 }, bytes: 2, compressed: false });
  expect(record.signature).toStrictEqual({ status: 'absent', magic: null, info: null, pkcs7: null, reason: null });
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 6 });
  expect(record.limitations).toHaveLength(6);
  expect(record.limitations[5]).toBe("No '~Module signature appended~' trailer was present. That is not proof the module is unsigned in another container.");
});

test.for([
  { codec: 'gzip', magic: Buffer.from([0x1f, 0x8b, 0x08, 0x00]) },
  { codec: 'xz', magic: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) },
  { codec: 'zstd', magic: Buffer.from([0x28, 0xb5, 0x2f, 0xfd]) },
])('inspect_kernel_module defers a $codec container', async ({ codec, magic }) => {
  const targets = await tempTargets();
  const path = await targets.write('module.bin', Buffer.concat([magic, Buffer.alloc(24, 0x11)]));
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record.applicability).toBe('compressed_container');
  expect(record.compression).toStrictEqual({ codec, bytes: magic.length + 24 });
  expect(record.next_probe).toStrictEqual({ operation: 'external_decompression', reason: `${codec} kernel module containers are not decoded in-process` });
  expect(record.format).toBeNull();
  expect(record.modinfo).toStrictEqual({ status: 'not_applicable', location: null, sha256: null, entries: [], reason: null });
  expect(record.versions).toStrictEqual({ status: 'not_applicable', layout: null, entry_bytes: null, location: null, sha256: null, entries: [], reason: null });
  expect(record.this_module).toStrictEqual({ status: 'not_applicable', location: null, layout: null });
  expect(record.ksymtab).toStrictEqual({ status: 'not_applicable', sections: [] });
  expect(record.init_text).toBeNull();
  expect(record.exit_text).toBeNull();
  expect(record.signature).toStrictEqual({ status: 'not_applicable', magic: null, info: null, pkcs7: null, reason: null });
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 0 });
  expect(record.limitations).toHaveLength(5);
});

test('inspect_kernel_module reports a non-relocatable ELF', async () => {
  const path = fixturePath('targets/elf/notes-and-dep.so');
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record).toMatchObject({ format: 'elf64', type: 2, type_name: 'executable', applicability: 'not_applicable', compression: null, next_probe: null });
  expect(record.modinfo.status).toBe('not_applicable');
  expect(record.versions.status).toBe('not_applicable');
  expect(record.this_module).toStrictEqual({ status: 'not_applicable', location: null, layout: null });
  expect(record.ksymtab).toStrictEqual({ status: 'not_applicable', sections: [] });
  expect(record.init_text).toBeNull();
  expect(record.exit_text).toBeNull();
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 0 });
});

test('inspect_kernel_module decodes a 32-bit module with versions', async () => {
  const targets = await tempTargets();
  const versions = kernelVersions(
    [
      { crc: 0xdeadbeef, name: 'mod_a' },
      { crc: 1, name: '' },
    ],
    4,
  );
  const path = await targets.write(
    'module32.ko',
    elf({
      bits: 32,
      type: 1,
      machine: 40,
      sections: [
        { name: '.modinfo', type: 1, data: Buffer.from('name=demo32\0', 'latin1') },
        { name: '__versions', type: 1, data: versions },
        { name: '__ksymtab_alpha', type: 1, data: Buffer.alloc(4) },
        { name: '.gnu.linkonce.this_module', type: 1, data: Buffer.alloc(8) },
        { name: '.init.text', type: 1, data: Buffer.alloc(2) },
        { name: '.exit.text', type: 1, data: Buffer.alloc(2) },
      ],
    }),
  );
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record).toMatchObject({ format: 'elf32', machine: 40, type_name: 'relocatable', applicability: 'applicable' });
  expect(record.modinfo.entries.map((entry) => ({ key: entry.key, value: entry.value }))).toStrictEqual([{ key: 'name', value: 'demo32' }]);
  expect(record.versions).toMatchObject({ status: 'present', layout: 'elf32_unsigned_long_name60', entry_bytes: 64, location: { bytes: 128 } });
  expect(record.versions.entries).toMatchObject([{ index: 0, crc_hex: 'deadbeef', name: 'mod_a', status: 'observed', reason: null, location: { bytes: 64 } }]);
  expect(record.versions.entries[0]?.location.offset).toBe(record.versions.location?.offset);
  expect(record.ksymtab).toMatchObject({ status: 'observed', sections: [{ name: '__ksymtab_alpha', location: { bytes: 4 }, compressed: false, reason: null }] });
  expect(record.this_module).toMatchObject({ status: 'present', layout: 'unknown' });
  expect(record.init_text).toMatchObject({ status: 'present', bytes: 2, compressed: false });
  expect(record.exit_text).toMatchObject({ status: 'present', bytes: 2, compressed: false });
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 3 });
});

test('inspect_kernel_module reports a section-less ELF header', async () => {
  const targets = await tempTargets();
  const bytes = patched(elf({ type: 1, machine: 62, sections: [{ name: '.modinfo', type: 1, data: Buffer.from('name=x\0', 'latin1') }] }), (blob) => blob.writeUInt16LE(0, 58));
  const path = await targets.write('bare.ko', bytes);
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record.format).toBe('elf64');
  expect(record.modinfo).toStrictEqual({ status: 'absent', location: null, sha256: null, entries: [], reason: null });
  expect(record.versions).toStrictEqual({ status: 'absent', layout: null, entry_bytes: null, location: null, sha256: null, entries: [], reason: null });
  expect(record.this_module).toStrictEqual({ status: 'absent', location: null, layout: null });
  expect(record.ksymtab).toStrictEqual({ status: 'absent', sections: [] });
  expect(record.init_text).toStrictEqual({ status: 'absent', location: null, bytes: null, compressed: null });
  expect(record.exit_text).toStrictEqual({ status: 'absent', location: null, bytes: null, compressed: null });
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 0 });
});

test('inspect_kernel_module detects an appended signature trailer', async () => {
  const targets = await tempTargets();
  const path = await targets.write('signed.ko', Buffer.concat([await readFile(fixturePath('targets/kernel/demo.ko')), Buffer.from('~Module signature appended~', 'ascii')]));
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record.signature).toStrictEqual({ status: 'present', magic: '~Module signature appended~', info: null, pkcs7: null, reason: null });
  expect(record.limitations).toHaveLength(5);
  expect(record.modinfo.entries).toHaveLength(4);
});

test('inspect_kernel_module reports absent metadata when names are unreadable', async () => {
  const targets = await tempTargets();
  const built = elf({ type: 1, machine: 62, sections: [{ name: '.modinfo', type: 1, data: Buffer.from('name=x\0', 'latin1') }] });
  const shoff = Number(built.readBigUInt64LE(40));
  const path = await targets.write(
    'nameless.ko',
    patched(built, (blob) => blob.writeUInt32LE(0xffff, shoff + 64)),
  );
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record.modinfo.status).toBe('absent');
  expect(record.coverage.examined_entries).toBe(0);
});

test('inspect_kernel_module refuses a truncated string table', async () => {
  const targets = await tempTargets();
  const built = elf({ type: 1, machine: 62, sections: [{ name: '.modinfo', type: 1, data: Buffer.from('name=x\0', 'latin1') }] });
  const shoff = Number(built.readBigUInt64LE(40));
  const path = await targets.write(
    'truncated-strings.ko',
    patched(built, (blob) => blob.writeBigUInt64LE(4096n, shoff + 64 * 2 + 24)),
  );
  const payload = await payloadOf(() => inspectKernelModuleFromPath(path));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    details: { operation: 'inspect_kernel_module', issues: [{ reason: 'invalid_format', message: `Cannot inspect ${path}: shstrtab truncated` }] },
  });
});

test.for([
  { name: 'a one-byte file', bytes: () => Buffer.from([0x1f]), message: 'not ELF', reason: 'invalid_format' },
  { name: 'a foreign magic', bytes: () => Buffer.from('not an elf image at all', 'latin1'), message: 'not ELF', reason: 'invalid_format' },
  { name: 'an unknown ELF class', bytes: () => patched(elf({ type: 1, machine: 62 }), (blob) => blob.writeUInt8(7, 4)), message: 'invalid ELF ident', reason: 'invalid_format' },
  { name: 'an unknown ELF endianness', bytes: () => patched(elf({ type: 1, machine: 62 }), (blob) => blob.writeUInt8(0, 5)), message: 'invalid ELF ident', reason: 'invalid_format' },
  {
    name: 'a truncated section header table',
    bytes: () => elf({ type: 1, machine: 62, sections: [{ name: '.modinfo', type: 1, data: Buffer.from('name=x\0', 'latin1') }] }).subarray(0, 120),
    message: 'section headers truncated',
    reason: 'invalid_format',
  },
])('inspect_kernel_module rejects $name', async ({ bytes, message, reason }) => {
  const targets = await tempTargets();
  const path = await targets.write('broken.ko', bytes());
  const payload = await payloadOf(() => inspectKernelModuleFromPath(path, { maxFileBytes: 4096 }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    details: { operation: 'inspect_kernel_module', issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${message}` }] },
  });
});

test('inspect_kernel_module refuses a module over the byte limit', async () => {
  const targets = await tempTargets();
  const path = await targets.write('large.ko', Buffer.alloc(2048, 0x41));
  const payload = await payloadOf(() => inspectKernelModuleFromPath(path, { maxFileBytes: 1024 }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'The inspection input is not usable. Check the argument and retry.',
    details: { issues: [{ message: `Cannot inspect ${path}: file exceeds max_file_bytes=1024` }] },
  });
});

test('inspect_kernel_module refuses too many modinfo entries', async () => {
  const path = fixturePath('targets/kernel/demo.ko');
  const payload = await payloadOf(() => inspectKernelModuleFromPath(path, { maxEntries: 1 }));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_value', message: `Cannot inspect ${path}: modinfo exceeds max_entries=1` }] });
});

test('inspect_kernel_module refuses too many version entries', async () => {
  const targets = await tempTargets();
  const versions = kernelVersions(
    [
      { crc: 1, name: 'one' },
      { crc: 2, name: 'two' },
    ],
    8,
  );
  const path = await targets.write(
    'versions.ko',
    elf({
      type: 1,
      machine: 62,
      sections: [
        { name: '.modinfo', type: 1, data: Buffer.from('name=x\0', 'latin1') },
        { name: '__versions', type: 1, data: versions },
      ],
    }),
  );
  const payload = await payloadOf(() => inspectKernelModuleFromPath(path, { maxEntries: 1 }));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_value', message: `Cannot inspect ${path}: versions exceed max_entries=1` }] });
});

test('inspect_kernel_module reports a module without metadata sections', async () => {
  const targets = await tempTargets();
  const path = await targets.write('plain.ko', elf({ type: 1, machine: 183, sections: [{ name: '.text', type: 1, data: Buffer.alloc(4) }] }));
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record.machine).toBe(183);
  expect(record.this_module).toStrictEqual({ status: 'absent', location: null, layout: null });
  expect(record.init_text).toStrictEqual({ status: 'absent', location: null, bytes: null, compressed: null });
  expect(record.exit_text).toStrictEqual({ status: 'absent', location: null, bytes: null, compressed: null });
  expect(record.limitations).toHaveLength(6);
});

test('inspect_kernel_module decodes a big-endian 32-bit module', async () => {
  const targets = await tempTargets();
  const path = await targets.write('be32.ko', elf({ bits: 32, little: false, type: 1, machine: 8, sections: [{ name: '.modinfo', type: 1, data: Buffer.from('name=be32\0', 'latin1') }] }));
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record).toMatchObject({ format: 'elf32', byte_order: 'big', machine: 8, type: 1, type_name: 'relocatable' });
  expect(record.modinfo.entries.map((entry) => ({ key: entry.key, value: entry.value }))).toStrictEqual([{ key: 'name', value: 'be32' }]);
});

test('inspect_kernel_module skips incomplete modinfo entries', async () => {
  const targets = await tempTargets();
  const payload = Buffer.from('name=x\0\0noequals\0=bad\0tail', 'latin1');
  const path = await targets.write('modinfo.ko', elf({ type: 1, machine: 62, sections: [{ name: '.modinfo', type: 1, data: payload }] }));
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record.modinfo.entries).toStrictEqual([{ index: 0, location: { offset: 64, bytes: 7 }, key: 'name', value: 'x', raw_sha256: record.modinfo.entries[0]?.raw_sha256, raw_hex: '6e616d653d7800', status: 'observed', reason: null }]);
  expect(record.modinfo.entries[0]?.raw_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(record.modinfo.location).toStrictEqual({ offset: 64, bytes: 26 });
});

test('inspect_kernel_module reads a version name without a terminator', async () => {
  const targets = await tempTargets();
  const record64 = Buffer.alloc(64);
  record64.writeBigUInt64LE(0x1234n, 0);
  record64.write('n'.repeat(56), 8, 'latin1');
  const path = await targets.write('versions.ko', elf({ type: 1, machine: 62, sections: [{ name: '__versions', type: 1, data: record64 }] }));
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record.versions.entries[0]).toMatchObject({ crc_hex: '0000000000001234', name: 'n'.repeat(56) });
  expect(record.modinfo.status).toBe('absent');
});

test('inspect_kernel_module resolves a relative module path', async () => {
  const targets = await tempTargets();
  await targets.write('relative.ko', elf({ type: 1, machine: 62, sections: [{ name: '.text', type: 1, data: Buffer.alloc(4) }] }));
  const { record, resolvedPath } = await inspectKernelModuleFromPath('relative.ko', { cwd: targets.dir });

  expect(resolvedPath).toBe(`${targets.dir}/relative.ko`);
  expect(record.artifact.path).toBe('relative.ko');
  expect(record.coverage.examined_entries).toBe(0);
});

test('inspect_kernel_module reports a directory that cannot be read', async () => {
  const targets = await tempTargets();
  const payload = await payloadOf(() => inspectKernelModuleFromPath(targets.dir));

  expect(payload.details).toMatchObject({
    issues: [{ reason: 'invalid_value', message: expect.stringMatching(new RegExp(`^Cannot inspect ${targets.dir}: it could not be read \\(.*\\)$`)) }],
  });
});

test('inspect_kernel_module decodes a big-endian 64-bit module', async () => {
  const targets = await tempTargets();
  const path = await targets.write('be64.ko', elf({ little: false, type: 1, machine: 21, sections: [{ name: '.modinfo', type: 1, data: Buffer.from('name=be64\0', 'latin1') }] }));
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record).toMatchObject({ format: 'elf64', byte_order: 'big', machine: 21, type_name: 'relocatable', applicability: 'applicable' });
  expect(record.modinfo.entries.map((entry) => ({ key: entry.key, value: entry.value }))).toStrictEqual([{ key: 'name', value: 'be64' }]);
});

test('inspect_kernel_module reports a big-endian bare 32-bit header', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'be32-bare.ko',
    patched(elf({ bits: 32, little: false, type: 1, machine: 8 }), (blob) => blob.writeUInt16BE(0, 46)),
  );
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record).toMatchObject({ format: 'elf32', byte_order: 'big', machine: 8, type_name: 'relocatable', applicability: 'applicable' });
  expect(record.modinfo.status).toBe('absent');
  expect(record.ksymtab).toStrictEqual({ status: 'absent', sections: [] });
});

test.for([
  { type: 3, expected: 'shared' },
  { type: 4, expected: 'core' },
  { type: 5, expected: 'unknown' },
])('inspect_kernel_module names a type $type image', async ({ type, expected }) => {
  const targets = await tempTargets();
  const path = await targets.write('typed.ko', elf({ type, machine: 62 }));
  const { record } = await inspectKernelModuleFromPath(path);

  expect(record.type).toBe(type);
  expect(record.type_name).toBe(expected);
  expect(record.applicability).toBe('not_applicable');
});

test('inspect_kernel_module reports absent metadata for a nameless table', async () => {
  const targets = await tempTargets();
  const built = elf({ type: 1, machine: 62, sections: [{ name: '.modinfo', type: 1, data: Buffer.from('name=x\0', 'latin1') }] });
  const names = built.indexOf(Buffer.from('.modinfo\0.shstrtab\0', 'latin1'));
  const path = await targets.write(
    'unterminated.ko',
    patched(built, (blob) => {
      blob.writeUInt8(0x58, names + 8);
      blob.writeUInt8(0x58, names + 18);
    }),
  );
  const { record } = await inspectKernelModuleFromPath(path);

  expect(names).toBeGreaterThan(0);
  expect(record.modinfo.status).toBe('absent');
  expect(record.this_module.status).toBe('absent');
});

test('inspect_kernel_module reports a missing module', async () => {
  const targets = await tempTargets();
  const missing = `${targets.dir}/missing.ko`;
  const payload = await payloadOf(() => inspectKernelModuleFromPath(missing));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_value', message: `Cannot inspect ${missing}: no file exists there` }] });
});

test('inspect_kernel_module records a compressed container subject', async () => {
  const targets = await tempTargets();
  const path = await targets.write('compressed.ko', Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(22, 0x00)]));
  const session = new ReaSession(runtime);
  const result = await inspectKernelModule(session, { path });
  const record = result.structuredContent as { subject: { format: string; architecture: string | null }; normalized_result: { compression: { codec: string } } };

  expect(record.subject).toStrictEqual({ name: 'compressed.ko', digest: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }, format: 'bytes', architecture: null, local_path: path });
  expect(record.normalized_result.compression.codec).toBe('gzip');
  expect(session.evidence.size).toBe(1);
});

test('inspect_kernel_module records an unknown machine architecture', async () => {
  const targets = await tempTargets();
  const path = await targets.write('unknown.ko', elf({ type: 1, machine: 9999, sections: [{ name: '.text', type: 1, data: Buffer.alloc(4) }] }));
  const session = new ReaSession(runtime);
  const result = await inspectKernelModule(session, { path });
  const record = result.structuredContent as { subject: { format: string; architecture: string | null } };

  expect(record.subject).toStrictEqual({ name: 'unknown.ko', digest: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }, format: 'elf', architecture: null, local_path: path });
  expect(session.evidence.size).toBe(1);
});

test('inspect_kernel_module skips zero-length section spans', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'empty-init.ko',
    elf({
      type: 1,
      machine: 62,
      sections: [
        { name: '.modinfo', type: 1, data: Buffer.from('name=empty\0', 'latin1') },
        { name: '.init.text', type: 1, data: Buffer.alloc(0) },
      ],
    }),
  );
  const session = new ReaSession(runtime);
  const result = await inspectKernelModule(session, { path });
  const record = result.structuredContent as { normalized_result: { init_text: { status: string; bytes: number } }; locations: { kind: string; start?: number }[] };

  expect(record.normalized_result.init_text).toMatchObject({ status: 'present', bytes: 0 });
  expect(record.locations).toStrictEqual([
    { kind: 'artifact-path', path },
    { kind: 'file-offset-range', start: 64, end: 75 },
    { kind: 'file-offset-range', start: 64, end: 75 },
  ]);
});

test('inspect_electron_fuses decodes the fixture sentinel wire', async () => {
  const path = fixturePath('targets/electron/fuse-thin.bin');
  const { record, resolvedPath } = await inspectElectronFusesFromPath(path);

  expect(resolvedPath).toBe(realpathSync(path));
  expect(record.artifact).toMatchObject({ selected_path: path, resolved_path: realpathSync(path), bytes: 74, format: 'mach-o' });
  expect(record.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(record.slices).toHaveLength(1);
  expect(record.slices[0]).toMatchObject({ index: 0, file_offset: 0, size: 74, architecture: 'arm64', sentinel_count: 1 });
  expect(record.slices[0]?.sentinels[0]).toMatchObject({ sentinel_offset: 32, wire_version: 1, declared_length: 8, complete: true });
  expect(record.slices[0]?.sentinels[0]?.fuses).toStrictEqual([
    { index: 0, name: 'RunAsNode', state: 'disabled', raw_byte: DISABLED },
    { index: 1, name: 'EnableCookieEncryption', state: 'enabled', raw_byte: ENABLED },
    { index: 2, name: 'EnableNodeOptionsEnvironmentVariable', state: 'disabled', raw_byte: DISABLED },
    { index: 3, name: 'EnableNodeCliInspectArguments', state: 'disabled', raw_byte: DISABLED },
    { index: 4, name: 'EnableEmbeddedAsarIntegrityValidation', state: 'disabled', raw_byte: DISABLED },
    { index: 5, name: 'OnlyLoadAppFromAsar', state: 'disabled', raw_byte: DISABLED },
    { index: 6, name: 'LoadBrowserProcessSpecificV8Snapshot', state: 'disabled', raw_byte: DISABLED },
    { index: 7, name: 'GrantFileProtocolExtraPrivileges', state: 'enabled', raw_byte: ENABLED },
  ]);
  expect(record.runtime_implications).toStrictEqual([
    { relationship: 'derivation', slice_index: 0, sentinel_offset: 32, subject: 'node_cli_inspect_arguments', fuse_index: 3, outcome: 'not_honored' },
    { relationship: 'derivation', slice_index: 0, sentinel_offset: 32, subject: 'electron_run_as_node', fuse_index: 0, outcome: 'not_honored' },
    { relationship: 'derivation', slice_index: 0, sentinel_offset: 32, subject: 'embedded_asar_integrity_validation', fuse_index: 4, outcome: 'not_enforced' },
    { relationship: 'derivation', slice_index: 0, sentinel_offset: 32, subject: 'only_load_app_from_asar', fuse_index: 5, outcome: 'not_restricted_to_app_asar' },
  ]);
  expect(record.limitations).toHaveLength(3);
});

test.for([
  { name: 'a 32-bit thin', body: () => thinMacho(fuseWire(1, [ENABLED]), 0xfeedface, 7), format: 'mach-o', architecture: 'x86', slices: 1 },
  {
    name: 'a big-endian universal',
    body: () => fatMacho([thinMacho(fuseWire(1, [DISABLED]), 0xfeedfacf, 0x0100000c), thinMacho(fuseWire(1, [ENABLED]), 0xfeedfacf, 7)]),
    format: 'mach-o-universal',
    architecture: 'arm64',
    slices: 2,
  },
  { name: 'a little-endian universal', body: () => fatMacho([thinMacho(fuseWire(1, [DISABLED]), 0xfeedfacf, 12)], true, 12), format: 'mach-o-universal', architecture: 'arm', slices: 1 },
  { name: 'a PE image', body: () => peFuse(fuseWire(1, [DISABLED])), format: 'pe', architecture: null, slices: 1 },
  { name: 'an ELF image', body: () => elfFuse(fuseWire(1, [DISABLED])), format: 'elf', architecture: null, slices: 1 },
])('inspect_electron_fuses reads $name container', async ({ body, format, architecture, slices }) => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', body());
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.artifact.format).toBe(format);
  expect(record.slices).toHaveLength(slices);
  expect(record.slices[0]?.architecture).toBe(architecture);
  expect(record.slices[0]?.sentinel_count).toBe(1);
});

test('inspect_electron_fuses reports every sentinel in a slice', async () => {
  const targets = await tempTargets();
  const wire = fuseWire(1, [DISABLED, ENABLED]);
  const path = await targets.write('Electron', peFuse(Buffer.concat([wire, sentinel, wire])));
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinel_count).toBe(2);
  expect(record.slices[0]?.sentinels.map((entry) => entry.sentinel_offset)).toStrictEqual([32, 68]);
  expect(record.limitations).toContain('Slice 0 at file offset 0 contains 2 Electron fuse sentinels; every sentinel is reported and none is selected.');
  expect(record.runtime_implications).toHaveLength(8);
});

test('inspect_electron_fuses reports a slice without a sentinel', async () => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(64, 0x2e)]));
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinel_count).toBe(0);
  expect(record.slices[0]?.sentinels).toStrictEqual([]);
  expect(record.runtime_implications).toStrictEqual([]);
  expect(record.limitations).toContain('Slice 0 at file offset 0 contains no Electron fuse sentinel; fuse state for that slice is unknown, not disabled.');
});

test('inspect_electron_fuses caps sentinels at 32 per slice', async () => {
  const targets = await tempTargets();
  const wire = fuseWire(1, [DISABLED]);
  const path = await targets.write('Electron', peFuse(Buffer.concat(Array.from({ length: 33 }, () => Buffer.concat([sentinel, wire])))));
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinel_count).toBe(32);
  expect(record.limitations).toContain('Slice 0 at file offset 0 contains 32 Electron fuse sentinels; every sentinel is reported and none is selected.');
  expect(record.runtime_implications.filter((entry) => entry.subject === 'electron_run_as_node')).toHaveLength(32);
});

test('inspect_electron_fuses searches past the first search window', async () => {
  const targets = await tempTargets();
  const body = Buffer.alloc(300_000, 0x2e);
  body.write('MZ', 0, 'latin1');
  Buffer.concat([sentinel, fuseWire(1, [ENABLED])]).copy(body, 270_000);
  const path = await targets.write('Electron', body);
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinel_count).toBe(1);
  expect(record.slices[0]?.sentinels[0]).toMatchObject({ sentinel_offset: 270_000, complete: true });
  expect(record.slices[0]?.sentinels[0]?.fuses).toStrictEqual([{ index: 0, name: 'RunAsNode', state: 'enabled', raw_byte: ENABLED }]);
});

test('inspect_electron_fuses reports an incomplete sentinel wire', async () => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', thinMacho(Buffer.from([1, 8, ENABLED, DISABLED])));
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinels[0]).toStrictEqual({
    sentinel_offset: 32,
    wire_version: 1,
    declared_length: 8,
    fuses: [
      { index: 0, name: 'RunAsNode', state: 'enabled', raw_byte: ENABLED },
      { index: 1, name: 'EnableCookieEncryption', state: 'disabled', raw_byte: DISABLED },
    ],
    complete: false,
  });
});

test('inspect_electron_fuses reports a sentinel without a wire header', async () => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', Buffer.concat([Buffer.from('MZ', 'latin1'), sentinel]));
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinels[0]).toStrictEqual({ sentinel_offset: 2, wire_version: null, declared_length: null, fuses: [], complete: false });
  expect(record.runtime_implications.map((entry) => entry.outcome)).toStrictEqual(['unknown', 'unknown', 'unknown', 'unknown']);
});

test('inspect_electron_fuses leaves ELF integrity fuses unknown', async () => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', elfFuse(fuseWire(1, [ENABLED, ENABLED, ENABLED, ENABLED, ENABLED, ENABLED])));
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.artifact.format).toBe('elf');
  expect(record.runtime_implications.map((entry) => ({ subject: entry.subject, outcome: entry.outcome }))).toStrictEqual([
    { subject: 'node_cli_inspect_arguments', outcome: 'honored' },
    { subject: 'electron_run_as_node', outcome: 'honored' },
    { subject: 'embedded_asar_integrity_validation', outcome: 'unknown' },
    { subject: 'only_load_app_from_asar', outcome: 'restricted_to_app_asar' },
  ]);
});

test('inspect_electron_fuses maps removed fuses to the inactive outcome', async () => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', thinMacho(fuseWire(1, [REMOVED, REMOVED, REMOVED, REMOVED, REMOVED, REMOVED])));
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinels[0]?.fuses[0]).toStrictEqual({ index: 0, name: 'RunAsNode', state: 'removed', raw_byte: REMOVED });
  expect(record.runtime_implications.map((entry) => entry.outcome)).toStrictEqual(['not_honored', 'not_honored', 'not_enforced', 'not_restricted_to_app_asar']);
});

test('inspect_electron_fuses names only version 1 wire fuses', async () => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', thinMacho(fuseWire(2, [ENABLED, DISABLED, ENABLED])));
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinels[0]?.wire_version).toBe(2);
  expect(record.slices[0]?.sentinels[0]?.fuses.map((entry) => entry.name)).toStrictEqual([null, null, null]);
});

test('inspect_electron_fuses leaves unlisted fuse indexes unnamed', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'Electron',
    thinMacho(
      fuseWire(
        1,
        Array.from({ length: 10 }, () => DISABLED),
      ),
    ),
  );
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.sentinels[0]?.fuses.map((entry) => entry.name)).toStrictEqual([
    'RunAsNode',
    'EnableCookieEncryption',
    'EnableNodeOptionsEnvironmentVariable',
    'EnableNodeCliInspectArguments',
    'EnableEmbeddedAsarIntegrityValidation',
    'OnlyLoadAppFromAsar',
    'LoadBrowserProcessSpecificV8Snapshot',
    'GrantFileProtocolExtraPrivileges',
    'WasmTrapHandlers',
    null,
  ]);
});

test('inspect_electron_fuses resolves the framework inside an app bundle', async () => {
  const targets = await tempTargets();
  const bundle = `${targets.dir}/Fixture.app`;
  const framework = `${bundle}/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`;
  await writeInto(framework, thinMacho(fuseWire(1, [DISABLED])));
  const { record, resolvedPath } = await inspectElectronFusesFromPath(bundle);

  expect(resolvedPath).toBe(realpathSync(framework));
  expect(record.artifact.selected_path).toBe(bundle);
  expect(record.slices[0]?.architecture).toBe('arm64');
  expect(record.slices[0]?.sentinel_count).toBe(1);
});

test('inspect_electron_fuses skips a candidate that is not a file', async () => {
  const targets = await tempTargets();
  const bundle = `${targets.dir}/Fixture.app`;
  await mkdir(`${bundle}/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`, { recursive: true });
  const framework = `${bundle}/Contents/Frameworks/Electron Framework.framework/Electron Framework`;
  await writeInto(framework, thinMacho(fuseWire(1, [ENABLED])));
  const { record, resolvedPath } = await inspectElectronFusesFromPath(bundle);

  expect(resolvedPath).toBe(realpathSync(framework));
  expect(record.slices[0]?.sentinels[0]?.fuses[0]).toStrictEqual({ index: 0, name: 'RunAsNode', state: 'enabled', raw_byte: ENABLED });
});

test('inspect_electron_fuses refuses a bundle without a framework', async () => {
  const targets = await tempTargets();
  const payload = await payloadOf(() => inspectElectronFusesFromPath(targets.dir));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    details: { operation: 'inspect_electron_fuses', issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${targets.dir}: no Electron Framework binary was found inside the app bundle` }] },
  });
});

test('inspect_electron_fuses reports a path that does not resolve', async () => {
  const targets = await tempTargets();
  const missing = `${targets.dir}/absent`;
  const payload = await payloadOf(() => inspectElectronFusesFromPath(missing));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_value', message: expect.stringMatching(new RegExp(`^Cannot inspect ${missing}: it could not be resolved \\(.*\\)$`)) }] });
});

test('inspect_electron_fuses refuses a character device', async () => {
  const payload = await payloadOf(() => inspectElectronFusesFromPath('/dev/null'));

  expect(payload.details).toMatchObject({ issues: [{ message: 'Cannot inspect /dev/null: it is not a regular file' }] });
});

test.for([
  { name: 'an unknown container', bytes: () => Buffer.from('plain text payload', 'latin1') },
  { name: 'a short container', bytes: () => Buffer.from([0xca, 0xfe]) },
  { name: 'a universal header with too many slices', bytes: () => patched(fatMacho([thinMacho(fuseWire(1, [DISABLED]))]), (blob) => blob.writeUInt32BE(40, 4)) },
  { name: 'a universal header that overruns the file', bytes: () => fatMacho([thinMacho(fuseWire(1, [DISABLED]))]).subarray(0, 16) },
])('inspect_electron_fuses rejects $name', async ({ bytes }) => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', bytes());
  const payload = await payloadOf(() => inspectElectronFusesFromPath(path));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    details: {
      operation: 'inspect_electron_fuses',
      issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: it is not a Mach-O, PE, or ELF Electron container` }],
    },
  });
});

test.for([
  { name: 'a big-endian thin image', body: () => Buffer.concat([Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 99, 0, 0, 0, 0]), sentinel, fuseWire(1, [DISABLED])]) },
  { name: 'a universal slice with an unknown cpu', body: () => fatMacho([thinMacho(fuseWire(1, [DISABLED]))], false, 4242) },
])('inspect_electron_fuses reports an unknown architecture for $name', async ({ body }) => {
  const targets = await tempTargets();
  const path = await targets.write('Electron', body());
  const { record } = await inspectElectronFusesFromPath(path);

  expect(record.slices[0]?.architecture).toBeNull();
  expect(record.slices[0]?.sentinel_count).toBe(1);
  expect(record.slices[0]?.sentinels[0]?.wire_version).toBe(1);
});

test('inspect_electron_fuses resolves a relative image path', async () => {
  const targets = await tempTargets();
  await targets.write('Electron', peFuse(fuseWire(1, [ENABLED])));
  const { record, resolvedPath } = await inspectElectronFusesFromPath('Electron', { cwd: targets.dir });

  expect(resolvedPath).toBe(realpathSync(`${targets.dir}/Electron`));
  expect(record.artifact.selected_path).toBe('Electron');
  expect(record.slices[0]?.sentinels[0]?.fuses).toStrictEqual([{ index: 0, name: 'RunAsNode', state: 'enabled', raw_byte: ENABLED }]);
});

test('inspect_erlang_beam reports every fixture chunk table', async () => {
  const path = fixturePath('targets/beam/demo.beam');
  const { record, resolvedPath } = await inspectErlangBeamFromPath(path);

  expect(resolvedPath).toBe(path);
  expect(record.artifact.bytes).toBe(136);
  expect(record.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(record.form).toStrictEqual({ location: { offset: 0, bytes: 136 }, size: 128 });
  expect(record.chunks.map((chunk) => ({ index: chunk.index, name: chunk.name, location: chunk.location, bytes: chunk.payload.bytes }))).toStrictEqual([
    { index: 0, name: 'AtU8', location: { offset: 12, bytes: 48 }, bytes: 38 },
    { index: 1, name: 'ExpT', location: { offset: 60, bytes: 24 }, bytes: 16 },
    { index: 2, name: 'ImpT', location: { offset: 84, bytes: 24 }, bytes: 16 },
    { index: 3, name: 'Code', location: { offset: 108, bytes: 28 }, bytes: 20 },
  ]);
  expect(record.chunks[0]?.payload.location).toStrictEqual({ offset: 20, bytes: 38 });
  expect(record.atoms).toStrictEqual([
    { index: 1, name: 'module' },
    { index: 2, name: 'demo' },
    { index: 3, name: 'foo' },
    { index: 4, name: 'bar' },
    { index: 5, name: 'erlang' },
    { index: 6, name: 'length' },
  ]);
  expect(record.atom_encoding).toBe('utf8');
  expect(record.exports).toStrictEqual([{ function: 'foo', arity: 1, label: 1, function_index: 3 }]);
  expect(record.imports).toStrictEqual([{ module: 'erlang', function: 'length', arity: 1, module_index: 5, function_index: 6 }]);
  expect(record.lambdas).toBeNull();
  expect(record.code).toStrictEqual({ instruction_set: 0, opcode_max: 0, labels: 1, functions: 1, extra_header_bytes: 0, instructions: { offset: 136, bytes: 0 } });
  expect(record.module).toBe('module');
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_chunks: 4, atoms: 6 });
  expect(record.limitations).toHaveLength(2);
});

test('inspect_erlang_beam decodes latin1 atom chunks', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'latin1.beam',
    beam([
      { name: 'Atom', payload: beamAtoms(['mod', 'f\u00ff']) },
      { name: 'ExpT', payload: Buffer.concat([u32be(1), u32be(2), u32be(2), u32be(9)]) },
    ]),
  );
  const { record } = await inspectErlangBeamFromPath(path);

  expect(record.atom_encoding).toBe('latin1');
  expect(record.atoms).toStrictEqual([
    { index: 1, name: 'mod' },
    { index: 2, name: 'f\u00ff' },
  ]);
  expect(record.exports).toStrictEqual([{ function: 'f\u00ff', arity: 2, label: 9, function_index: 2 }]);
  expect(record.module).toBe('mod');
  expect(record.imports).toBeNull();
  expect(record.lambdas).toBeNull();
  expect(record.code).toBeNull();
});

test('inspect_erlang_beam reads 24-byte lambda entries', async () => {
  const targets = await tempTargets();
  const row = Buffer.concat([u32be(3), u32be(2), u32be(7), u32be(1), u32be(0), u32be(0)]);
  const path = await targets.write(
    'funt24.beam',
    beam([
      { name: 'AtU8', payload: beamAtoms(['m', 'a', 'f']) },
      { name: 'FunT', payload: Buffer.concat([u32be(1), row]) },
    ]),
  );
  const { record } = await inspectErlangBeamFromPath(path);

  expect(record.lambdas).toStrictEqual([{ function: 'f', arity: 2, atom_index: 3 }]);
});

test('inspect_erlang_beam reads 12-byte lambda entries', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'funt12.beam',
    beam([
      { name: 'AtU8', payload: beamAtoms(['m', 'a', 'f']) },
      { name: 'FunT', payload: Buffer.concat([u32be(1), u32be(3), u32be(1), u32be(0)]) },
    ]),
  );
  const { record } = await inspectErlangBeamFromPath(path);

  expect(record.lambdas).toStrictEqual([{ function: 'f', arity: 1, atom_index: 3 }]);
});

test('inspect_erlang_beam reports a short table payload as null', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'empty-tables.beam',
    beam([
      { name: 'ExpT', payload: Buffer.alloc(2) },
      { name: 'ImpT', payload: Buffer.alloc(0) },
      { name: 'FunT', payload: Buffer.alloc(3) },
    ]),
  );
  const { record } = await inspectErlangBeamFromPath(path);

  expect(record.exports).toBeNull();
  expect(record.imports).toBeNull();
  expect(record.lambdas).toBeNull();
  expect(record.atoms).toBeNull();
  expect(record.atom_encoding).toBeNull();
  expect(record.module).toBeNull();
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_chunks: 3, atoms: 0 });
});

test('inspect_erlang_beam records extra Code header bytes', async () => {
  const targets = await tempTargets();
  const path = await targets.write('code.beam', beam([{ name: 'Code', payload: beamCode([5, 11, 2, 3], Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]), 24) }]));
  const { record } = await inspectErlangBeamFromPath(path);

  expect(record.code).toStrictEqual({ instruction_set: 5, opcode_max: 11, labels: 2, functions: 3, extra_header_bytes: 8, instructions: { offset: 48, bytes: 4 } });
});

test.for([
  { name: 'a short file', bytes: () => Buffer.from('FOR1', 'ascii'), message: 'the file is not a BEAM IFF container.', reason: 'invalid_format' },
  { name: 'a foreign magic', bytes: () => Buffer.concat([Buffer.from('FOR2', 'ascii'), u32be(12), Buffer.alloc(8)]), message: 'the file is not a BEAM IFF container.', reason: 'invalid_format' },
  { name: 'a form size past the buffer', bytes: () => patched(beam([]), (blob) => blob.writeUInt32BE(4096, 4)), message: 'IFF form size is truncated.', reason: 'invalid_format' },
  {
    name: 'a chunk past the buffer',
    bytes: () => patched(beam([{ name: 'AtU8', payload: beamAtoms(['a']) }]), (blob) => blob.writeUInt32BE(4096, 16)),
    message: 'chunk AtU8 is truncated.',
    reason: 'invalid_format',
  },
  { name: 'a truncated atom table', bytes: () => beam([{ name: 'AtU8', payload: Buffer.from([0, 0, 0, 2, 9]) }]), message: 'atom table truncated', reason: 'invalid_format' },
  { name: 'an atom count past the buffer', bytes: () => beam([{ name: 'AtU8', payload: u32be(3) }]), message: 'atom table truncated', reason: 'invalid_format' },
  {
    name: 'a truncated export table',
    bytes: () => beam([{ name: 'ExpT', payload: Buffer.concat([u32be(2), u32be(1), u32be(1), u32be(1)]) }]),
    message: 'export table truncated',
    reason: 'invalid_format',
  },
  { name: 'a truncated import table', bytes: () => beam([{ name: 'ImpT', payload: Buffer.concat([u32be(1), u32be(1)]) }]), message: 'import table truncated', reason: 'invalid_format' },
  { name: 'a truncated lambda table', bytes: () => beam([{ name: 'FunT', payload: Buffer.concat([u32be(1), u32be(1)]) }]), message: 'lambda table truncated', reason: 'invalid_format' },
])('inspect_erlang_beam rejects $name', async ({ bytes, message, reason }) => {
  const targets = await tempTargets();
  const path = await targets.write('broken.beam', bytes());
  const payload = await payloadOf(() => inspectErlangBeamFromPath(path));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    details: { operation: 'inspect_erlang_beam', issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${message}` }] },
  });
});

test.for([
  { name: 'a byte limit below the floor', options: { maxFileBytes: 8 }, message: 'max_file_bytes must be an integer >= 16.' },
  { name: 'a fractional byte limit', options: { maxFileBytes: 16.5 }, message: 'max_file_bytes must be an integer >= 16.' },
  { name: 'a zero chunk budget', options: { maxChunks: 0 }, message: 'max_chunks must be a positive integer.' },
  { name: 'a fractional chunk budget', options: { maxChunks: 1.5 }, message: 'max_chunks must be a positive integer.' },
  { name: 'a zero atom budget', options: { maxAtoms: 0 }, message: 'max_atoms must be a positive integer.' },
  { name: 'a fractional atom budget', options: { maxAtoms: 2.5 }, message: 'max_atoms must be a positive integer.' },
])('inspect_erlang_beam rejects $name', async ({ options, message }) => {
  const targets = await tempTargets();
  const path = await targets.write('limits.beam', beam([]));
  const payload = await payloadOf(() => inspectErlangBeamFromPath(path, options));

  expect(payload.details).toMatchObject({ issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${message}` }] });
});

test('inspect_erlang_beam refuses a chunk over the byte limit', async () => {
  const targets = await tempTargets();
  const path = await targets.write('large.beam', beam([{ name: 'AtU8', payload: beamAtoms(['alpha', 'beta']) }]));
  const payload = await payloadOf(() => inspectErlangBeamFromPath(path, { maxFileBytes: 20 }));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_value', message: `Cannot inspect ${path}: file exceeds max_file_bytes=20.` }] });
});

test('inspect_erlang_beam refuses a chunk budget overrun', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'chunks.beam',
    beam([
      { name: 'AtU8', payload: beamAtoms(['a']) },
      { name: 'Code', payload: Buffer.alloc(4) },
    ]),
  );
  const payload = await payloadOf(() => inspectErlangBeamFromPath(path, { maxChunks: 1 }));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_value', message: `Cannot inspect ${path}: chunk count exceeds max_chunks=1.` }] });
});

test('inspect_erlang_beam refuses an atom budget overrun', async () => {
  const targets = await tempTargets();
  const path = await targets.write('atoms.beam', beam([{ name: 'AtU8', payload: beamAtoms(['a', 'b']) }]));
  const payload = await payloadOf(() => inspectErlangBeamFromPath(path, { maxAtoms: 1 }));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_format', message: `Cannot inspect ${path}: atom table exceeds max_atoms=1` }] });
});

test('inspect_erlang_beam reports a missing file', async () => {
  const targets = await tempTargets();
  const missing = `${targets.dir}/missing.beam`;
  const payload = await payloadOf(() => inspectErlangBeamFromPath(missing));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_value', message: `Cannot inspect ${missing}: no file exists there` }] });
});

test('inspect_erlang_beam reports an unreadable directory', async () => {
  const targets = await tempTargets();
  const payload = await payloadOf(() => inspectErlangBeamFromPath(targets.dir));

  expect(payload.details).toMatchObject({
    issues: [{ reason: 'invalid_value', message: expect.stringMatching(new RegExp(`^Cannot inspect ${targets.dir}: it could not be read \\(.*\\)$`)) }],
  });
});

test('inspect_erlang_beam resolves a relative beam path', async () => {
  const targets = await tempTargets();
  await targets.write('relative.beam', beam([{ name: 'AtU8', payload: beamAtoms(['m']) }]));
  const { record, resolvedPath } = await inspectErlangBeamFromPath('relative.beam', { cwd: targets.dir });

  expect(resolvedPath).toBe(`${targets.dir}/relative.beam`);
  expect(record.artifact.path).toBe('relative.beam');
  expect(record.module).toBe('m');
});

test('inspect_erlang_beam leaves an unresolvable atom index unnamed', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'dangling.beam',
    beam([
      { name: 'AtU8', payload: beamAtoms(['m']) },
      { name: 'ExpT', payload: Buffer.concat([u32be(1), u32be(99), u32be(1), u32be(1)]) },
    ]),
  );
  const { record } = await inspectErlangBeamFromPath(path);

  expect(record.exports).toStrictEqual([{ function: null, arity: 1, label: 1, function_index: 99 }]);
  expect(record.module).toBe('m');
});

test('inspect_erlang_beam refuses an atom chunk below the header size', async () => {
  const targets = await tempTargets();
  const path = await targets.write('short-atoms.beam', beam([{ name: 'AtU8', payload: Buffer.from([0, 1]) }]));
  const payload = await payloadOf(() => inspectErlangBeamFromPath(path));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_format', message: `Cannot inspect ${path}: atom table truncated` }] });
});

test('inspect_byte_entropy classifies the fixture halves', async () => {
  const path = fixturePath('targets/entropy/mixed.bin');
  const { record, resolvedPath } = await inspectByteEntropyFromPath(path);

  expect(resolvedPath).toBe(path);
  expect(record.artifact).toMatchObject({ path, bytes: 8192 });
  expect(record.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(record.block_size).toBe(4096);
  expect(record.window).toStrictEqual({ offset: 0, length: 8192 });
  expect(record.file_entropy).toBe(4.9816);
  expect(record.thresholds).toStrictEqual({ high: 7.2, low: 1.0 });
  expect(record.blocks).toStrictEqual([
    { offset: 0, length: 4096, entropy: 0 },
    { offset: 4096, length: 4096, entropy: 8 },
  ]);
  expect(record.runs).toStrictEqual([
    { offset: 0, length: 4096, classification: 'low' },
    { offset: 4096, length: 4096, classification: 'high' },
  ]);
  expect(record.limitations).toHaveLength(3);
});

test('inspect_byte_entropy measures a window from an offset', async () => {
  const path = fixturePath('targets/entropy/mixed.bin');
  const { record } = await inspectByteEntropyFromPath(path, { offset: 4096, length: 4096 });

  expect(record.window).toStrictEqual({ offset: 4096, length: 4096 });
  expect(record.file_entropy).toBe(4.9816);
  expect(record.blocks).toStrictEqual([{ offset: 4096, length: 4096, entropy: 8 }]);
  expect(record.runs).toStrictEqual([{ offset: 4096, length: 4096, classification: 'high' }]);
  expect(record.artifact.bytes).toBe(8192);
});

test('inspect_byte_entropy merges adjacent blocks of one class', async () => {
  const path = fixturePath('targets/entropy/mixed.bin');
  const { record } = await inspectByteEntropyFromPath(path, { blockSize: 256 });

  expect(record.block_size).toBe(256);
  expect(record.blocks).toHaveLength(32);
  expect(record.blocks[0]).toStrictEqual({ offset: 0, length: 256, entropy: 0 });
  expect(record.blocks[31]).toStrictEqual({ offset: 7936, length: 256, entropy: 8 });
  expect(record.runs).toStrictEqual([
    { offset: 0, length: 4096, classification: 'low' },
    { offset: 4096, length: 4096, classification: 'high' },
  ]);
});

test('inspect_byte_entropy drops middle blocks from the runs', async () => {
  const targets = await tempTargets();
  const middle = Buffer.from(Array.from({ length: 256 }, (_, index) => index % 4));
  const path = await targets.write('mixed.bin', Buffer.concat([Buffer.alloc(256), middle, Buffer.alloc(256)]));
  const { record } = await inspectByteEntropyFromPath(path, { blockSize: 256 });

  expect(record.blocks.map((block) => block.entropy)).toStrictEqual([0, 2, 0]);
  expect(record.runs).toStrictEqual([
    { offset: 0, length: 256, classification: 'low' },
    { offset: 512, length: 256, classification: 'low' },
  ]);
});

test('inspect_byte_entropy starts a run after an unclassified block', async () => {
  const targets = await tempTargets();
  const spread = Buffer.from(Array.from({ length: 256 }, (_, index) => index % 4));
  const path = await targets.write('leading.bin', Buffer.concat([spread, Buffer.alloc(256)]));
  const { record } = await inspectByteEntropyFromPath(path, { blockSize: 256 });

  expect(record.blocks.map((block) => block.entropy)).toStrictEqual([2, 0]);
  expect(record.runs).toStrictEqual([{ offset: 256, length: 256, classification: 'low' }]);
});

test('inspect_byte_entropy reports empty input as zero entropy', async () => {
  const targets = await tempTargets();
  const path = await targets.write('empty.bin', '');
  const { record } = await inspectByteEntropyFromPath(path);

  expect(record.artifact).toStrictEqual({ path, bytes: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  expect(record.file_entropy).toBe(0);
  expect(record.window).toStrictEqual({ offset: 0, length: 0 });
  expect(record.blocks).toStrictEqual([]);
  expect(record.runs).toStrictEqual([]);
});

test.for([
  { name: 'a block size below the floor', options: { blockSize: 128 }, message: 'block_size must be a power of two between 256 and 65536.' },
  { name: 'a block size that is not a power of two', options: { blockSize: 300 }, message: 'block_size must be a power of two between 256 and 65536.' },
  { name: 'a block size above the ceiling', options: { blockSize: 131_072 }, message: 'block_size must be a power of two between 256 and 65536.' },
  { name: 'a fractional block size', options: { blockSize: 512.5 }, message: 'block_size must be a power of two between 256 and 65536.' },
  { name: 'a negative offset', options: { offset: -1 }, message: 'offset must be an integer within the file.' },
  { name: 'an offset past the file', options: { offset: 5 }, message: 'offset must be an integer within the file.' },
  { name: 'a fractional offset', options: { offset: 0.5 }, message: 'offset must be an integer within the file.' },
  { name: 'a negative length', options: { length: -1 }, message: 'length must fit within the file from offset.' },
  { name: 'a length past the file', options: { length: 8 }, message: 'length must fit within the file from offset.' },
  { name: 'a fractional length', options: { length: 1.5 }, message: 'length must fit within the file from offset.' },
])('inspect_byte_entropy rejects $name', async ({ options, message }) => {
  const targets = await tempTargets();
  const path = await targets.write('sample.bin', 'abcd');
  const payload = await payloadOf(() => inspectByteEntropyFromPath(path, options));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'The inspection input is not usable. Check the argument and retry.',
    details: { operation: 'inspect_byte_entropy', issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${message}` }] },
  });
});

test('inspect_byte_entropy reports a missing file', async () => {
  const targets = await tempTargets();
  const missing = `${targets.dir}/missing.bin`;
  const payload = await payloadOf(() => inspectByteEntropyFromPath(missing));

  expect(payload.details).toMatchObject({ issues: [{ reason: 'invalid_value', message: `Cannot inspect ${missing}: no file exists there` }] });
});

test('inspect_byte_entropy reports an unreadable directory', async () => {
  const targets = await tempTargets();
  const payload = await payloadOf(() => inspectByteEntropyFromPath(targets.dir));

  expect(payload.details).toMatchObject({
    issues: [{ reason: 'invalid_value', message: expect.stringMatching(new RegExp(`^Cannot inspect ${targets.dir}: it could not be read \\(.*\\)$`)) }],
  });
});

test('inspect_byte_entropy resolves a relative sample path', async () => {
  const targets = await tempTargets();
  await targets.write('relative.bin', Buffer.alloc(512, 0x5a));
  const { record, resolvedPath } = await inspectByteEntropyFromPath('relative.bin', { cwd: targets.dir });

  expect(resolvedPath).toBe(`${targets.dir}/relative.bin`);
  expect(record.artifact.path).toBe('relative.bin');
  expect(record.file_entropy).toBe(0);
  expect(record.runs).toStrictEqual([{ offset: 0, length: 512, classification: 'low' }]);
});

test('readDerNode decodes a short-form header', () => {
  const bytes = Buffer.from([0x02, 0x01, 0x05, 0x04, 0x01, 0x41]);

  expect(readDerNode(bytes, 0)).toStrictEqual({ tag: 0x02, offset: 0, headerBytes: 2, length: 1, contentOffset: 2, end: 3 });
  expect(readDerNode(bytes, 3)).toStrictEqual({ tag: 0x04, offset: 3, headerBytes: 2, length: 1, contentOffset: 5, end: 6 });
});

test('readDerNode decodes long-form content lengths', () => {
  const long = Buffer.concat([Buffer.from([0x04]), derLength(200, 1), Buffer.alloc(200, 0x41)]);
  const twoByte = Buffer.concat([Buffer.from([0x30]), derLength(3, 2), Buffer.alloc(3, 0x42)]);

  expect(readDerNode(long, 0)).toStrictEqual({ tag: 0x04, offset: 0, headerBytes: 3, length: 200, contentOffset: 3, end: 203 });
  expect(readDerNode(twoByte, 0)).toStrictEqual({ tag: 0x30, offset: 0, headerBytes: 4, length: 3, contentOffset: 4, end: 7 });
});

test.for([
  { name: 'a missing tag', bytes: Buffer.alloc(0), offset: 0, message: 'truncated DER' },
  { name: 'a missing length', bytes: Buffer.from([0x04]), offset: 0, message: 'truncated DER length' },
  { name: 'an indefinite length', bytes: Buffer.from([0x04, 0x80]), offset: 0, message: 'invalid DER length' },
  { name: 'a five-byte length', bytes: Buffer.from([0x04, 0x85, 1, 2, 3, 4, 5]), offset: 0, message: 'invalid DER length' },
  { name: 'a length past the header', bytes: Buffer.from([0x04, 0x82, 0x01]), offset: 0, message: 'invalid DER length' },
  { name: 'content past the buffer', bytes: Buffer.from([0x04, 0x05, 0x61]), offset: 0, message: 'truncated DER content' },
])('readDerNode rejects $name', ({ bytes, offset, message }) => {
  expect(() => readDerNode(bytes, offset)).toThrow(message);
});

test('derChildren walks constructed children only', () => {
  const sequence = der(0x30, Buffer.concat([der(0x02, Buffer.from([0x2a])), der(0x0c, Buffer.from('x', 'utf8'))]));
  const primitive = der(0x02, Buffer.from([0x05]));

  expect(derChildren(sequence, readDerNode(sequence, 0))).toStrictEqual([
    { tag: 0x02, offset: 2, headerBytes: 2, length: 1, contentOffset: 4, end: 5 },
    { tag: 0x0c, offset: 5, headerBytes: 2, length: 1, contentOffset: 7, end: 8 },
  ]);
  expect(derChildren(primitive, readDerNode(primitive, 0))).toStrictEqual([]);
});

test('derChildren reports a truncated child', () => {
  const sequence = Buffer.from([0x30, 0x03, 0x02, 0x05, 0x01]);

  expect(() => derChildren(sequence, readDerNode(sequence, 0))).toThrow('truncated DER content');
});

test('derOid decodes arcs, rejects other tags', () => {
  const oid = der(0x06, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d]));
  const unterminated = der(0x06, Buffer.from([0x2a, 0x86]));
  const empty = der(0x06, Buffer.alloc(0));
  const integer = der(0x02, Buffer.from([0x05]));

  expect(derOid(oid, readDerNode(oid, 0))).toBe('1.2.840.113549');
  expect(derOid(unterminated, readDerNode(unterminated, 0))).toBe('1.2');
  expect(derOid(empty, readDerNode(empty, 0))).toBe('');
  expect(() => derOid(integer, readDerNode(integer, 0))).toThrow('expected OID');
});

test('derIntegerHex renders integer content', () => {
  const integer = der(0x02, Buffer.from([0x0a, 0x0b, 0x0c]));

  expect(derIntegerHex(integer, readDerNode(integer, 0))).toBe('0a0b0c');
});

test('derUtf8 decodes tagged string content', () => {
  const utf8 = der(0x0c, Buffer.from('héllo', 'utf8'));
  const bmp = der(0x1e, Buffer.from('hi', 'utf16le'));
  const fallback = der(0x04, Buffer.from('raw', 'utf8'));

  expect(derUtf8(utf8, readDerNode(utf8, 0))).toBe('héllo');
  expect(derUtf8(bmp, readDerNode(bmp, 0))).toBe('hi');
  expect(derUtf8(fallback, readDerNode(fallback, 0))).toBe('raw');
});

test('inspect_devicetree records Evidence for a fixture blob', async () => {
  const path = fixturePath('targets/devicetree/board.dtb');
  const session = new ReaSession(runtime);
  const result = await inspectDevicetree(session, { path });
  const record = result.structuredContent as { operation: string; parameters: Record<string, unknown>; normalized_result: { summary: { model: string } }; locations: unknown[] };

  expect(record.operation).toBe('inspect_devicetree');
  expect(record.parameters).toStrictEqual({ path, max_file_bytes: 4_194_304, max_nodes: 8192, max_properties: 32_768, max_depth: 64 });
  expect(record.normalized_result.summary.model).toBe('board');
  expect(record.locations).toStrictEqual([{ kind: 'artifact-path', path }]);
  expect(session.evidence.size).toBe(1);
});

test('inspect_elf_notes records Evidence with note table ranges', async () => {
  const path = fixturePath('targets/elf/notes-and-dep.so');
  const session = new ReaSession(runtime);
  const result = await inspectElfNotes(session, { path });
  const record = result.structuredContent as {
    operation: string;
    parameters: Record<string, unknown>;
    subject: { format: string; architecture: string | null };
    normalized_result: { entries: unknown[] };
    locations: unknown[];
  };

  expect(record.operation).toBe('inspect_elf_notes');
  expect(record.parameters).toStrictEqual({ path, max_file_bytes: 67_108_864, max_entries: 32 });
  expect(record.subject).toMatchObject({ format: 'elf', architecture: 'x86_64' });
  expect(record.normalized_result.entries).toHaveLength(2);
  expect(record.locations).toStrictEqual([
    { kind: 'artifact-path', path },
    { kind: 'file-offset-range', start: 120, end: 152 },
    { kind: 'file-offset-range', start: 120, end: 152 },
  ]);
  expect(session.evidence.size).toBe(1);
});

test('inspect_kernel_module records Evidence with section ranges', async () => {
  const path = fixturePath('targets/kernel/demo.ko');
  const session = new ReaSession(runtime);
  const result = await inspectKernelModule(session, { path });
  const record = result.structuredContent as {
    operation: string;
    parameters: Record<string, unknown>;
    subject: { format: string; architecture: string | null };
    normalized_result: { versions: { entries: { name: string }[] } };
    locations: unknown[];
  };

  expect(record.operation).toBe('inspect_kernel_module');
  expect(record.parameters).toStrictEqual({ path, max_file_bytes: 67_108_864, max_entries: 8192 });
  expect(record.subject).toMatchObject({ format: 'elf', architecture: 'x86_64' });
  expect(record.normalized_result.versions.entries[0]?.name).toBe('tk');
  expect(record.locations).toContainEqual({ kind: 'file-offset-range', start: 153, end: 203 });
  expect(record.locations).toContainEqual({ kind: 'file-offset-range', start: 241, end: 305 });
  expect(session.evidence.size).toBe(1);
});

test('inspect_electron_fuses records Evidence with sentinel offsets', async () => {
  const path = fixturePath('targets/electron/fuse-thin.bin');
  const session = new ReaSession(runtime);
  const result = await inspectElectronFuses(session, { path });
  const record = result.structuredContent as {
    operation: string;
    parameters: Record<string, unknown>;
    subject: { format: string; architecture: string | null };
    normalized_result: { slices: { sentinel_count: number }[] };
    locations: unknown[];
  };

  expect(record.operation).toBe('inspect_electron_fuses');
  expect(record.parameters).toStrictEqual({ path });
  expect(record.subject).toMatchObject({ format: 'mach-o', architecture: 'arm64' });
  expect(record.normalized_result.slices[0]?.sentinel_count).toBe(1);
  expect(record.locations).toStrictEqual([
    { kind: 'artifact-path', path },
    { kind: 'file-offset', offset: 32 },
  ]);
  expect(session.evidence.size).toBe(1);
});

test('inspect_erlang_beam records Evidence with the form range', async () => {
  const path = fixturePath('targets/beam/demo.beam');
  const session = new ReaSession(runtime);
  const result = await inspectErlangBeam(session, { path });
  const record = result.structuredContent as {
    operation: string;
    parameters: Record<string, unknown>;
    subject: { format: string; architecture: string | null };
    normalized_result: { module: string };
    locations: unknown[];
  };

  expect(record.operation).toBe('inspect_erlang_beam');
  expect(record.parameters).toStrictEqual({ path, max_file_bytes: 67_108_864, max_chunks: 64, max_atoms: 4096 });
  expect(record.subject).toMatchObject({ format: 'file', architecture: null });
  expect(record.normalized_result.module).toBe('module');
  expect(record.locations).toStrictEqual([
    { kind: 'artifact-path', path },
    { kind: 'file-offset-range', start: 0, end: 136 },
  ]);
  expect(session.evidence.size).toBe(1);
});

test('inspect_byte_entropy records Evidence for a measured window', async () => {
  const path = fixturePath('targets/entropy/mixed.bin');
  const session = new ReaSession(runtime);
  const result = await inspectByteEntropy(session, { path, offset: 4096, length: 4096, detail: 'summary' });
  const record = result.structuredContent as { operation: string; parameters: Record<string, unknown>; normalized_result: { window: unknown; file_entropy: number } };

  expect(record.operation).toBe('inspect_byte_entropy');
  expect(record.parameters).toStrictEqual({ path, block_size: 4096, offset: 4096, length: 4096, detail: 'summary' });
  expect(record.normalized_result.window).toStrictEqual({ offset: 4096, length: 4096 });
  expect(record.normalized_result.file_entropy).toBe(4.9816);
  expect(session.evidence.size).toBe(1);
});
