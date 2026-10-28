import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { expect, test } from 'vitest';
import { compareManagedMemberEvidence } from '../src/analysis/compare-managed-members.ts';
import { buildMinimalCliPeFixture, inspectManagedArtifactFromPath, type ManagedArtifactInspection } from '../src/analysis/managed-artifact.ts';
import { inspectManagedMembersFromPath } from '../src/analysis/managed-members.ts';
import { inspectRustBinaryFromPath } from '../src/analysis/rust-binary.ts';
import type { ReaError, ReaErrorPayload } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import type { EvidenceRecord } from '../src/session/evidence.ts';
import { compareManagedMembers } from '../src/tools/compare-tools.ts';
import { inspectManagedArtifact, inspectManagedMembers } from '../src/tools/managed-tools.ts';
import { inspectRustBinary } from '../src/tools/rust-tools.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

const RUNTIME = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const align = (value: number, to: number): number => Math.ceil(value / to) * to;

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const payloadOf = async (run: () => Promise<unknown>): Promise<ReaErrorPayload> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the analyzer returned instead of throwing');
};

const u16 = (bytes: Buffer, offset: number, value: number, little = true): void => {
  if (little) bytes.writeUInt16LE(value, offset);
  else bytes.writeUInt16BE(value, offset);
};

const u32 = (bytes: Buffer, offset: number, value: number, little = true): void => {
  if (little) bytes.writeUInt32LE(value, offset);
  else bytes.writeUInt32BE(value, offset);
};

const u64 = (bytes: Buffer, offset: number, value: number, little = true): void => {
  if (little) bytes.writeBigUInt64LE(BigInt(value), offset);
  else bytes.writeBigUInt64BE(BigInt(value), offset);
};

const deflateJson = (value: unknown): Buffer => deflateSync(Buffer.from(JSON.stringify(value), 'utf8'));

interface ElfOptions {
  readonly payload?: Buffer;
  readonly machine?: number;
  readonly bits?: 32 | 64;
  readonly little?: boolean;
  readonly sectionName?: string;
  readonly unterminatedNames?: boolean;
}

const elfWithSection = (options: ElfOptions = {}): Buffer => {
  const bits = options.bits ?? 64;
  const little = options.little ?? true;
  const name = options.sectionName ?? '.dep-v0';
  const payload = options.payload ?? Buffer.alloc(0);
  const headerBytes = bits === 64 ? 64 : 52;
  const sectionBytes = bits === 64 ? 64 : 40;
  const names = Buffer.from(options.unterminatedNames === true ? `\0${name}` : `\0${name}\0\0`, 'latin1');
  const payloadOffset = headerBytes;
  const namesOffset = payloadOffset + payload.length;
  const shoff = align(namesOffset + names.length, 8);
  const bytes = Buffer.alloc(shoff + 3 * sectionBytes);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, bits === 64 ? 2 : 1, little ? 1 : 2, 1], 0);
  u16(bytes, 16, 2, little);
  u16(bytes, 18, options.machine ?? 62, little);
  u32(bytes, 20, 1, little);
  if (bits === 64) {
    u64(bytes, 40, shoff, little);
    u16(bytes, 58, 64, little);
    u16(bytes, 60, 3, little);
    u16(bytes, 62, 2, little);
  } else {
    u32(bytes, 32, shoff, little);
    u16(bytes, 46, 40, little);
    u16(bytes, 48, 3, little);
    u16(bytes, 50, 2, little);
  }
  payload.copy(bytes, payloadOffset);
  names.copy(bytes, namesOffset);
  const section = (index: number): number => shoff + index * sectionBytes;
  u32(bytes, section(1), 1, little);
  u32(bytes, section(1) + 4, 1, little);
  u32(bytes, section(2) + 4, 3, little);
  if (bits === 64) {
    u64(bytes, section(1) + 24, payloadOffset, little);
    u64(bytes, section(1) + 32, payload.length, little);
    u64(bytes, section(2) + 24, namesOffset, little);
    u64(bytes, section(2) + 32, names.length, little);
  } else {
    u32(bytes, section(1) + 16, payloadOffset, little);
    u32(bytes, section(1) + 20, payload.length, little);
    u32(bytes, section(2) + 16, namesOffset, little);
    u32(bytes, section(2) + 20, names.length, little);
  }
  return bytes;
};

interface MachOSection {
  readonly name: string;
  readonly bytes: Buffer;
}

interface MachOOptions {
  readonly bits?: 32 | 64;
  readonly little?: boolean;
  readonly cpuType?: number;
  readonly cpuSubtype?: number;
  readonly segmentName?: string;
  readonly sections?: readonly MachOSection[];
}

const machOThin = (options: MachOOptions = {}): Buffer => {
  const bits = options.bits ?? 64;
  const little = options.little ?? true;
  const sections = options.sections ?? [];
  const headerBytes = bits === 64 ? 32 : 28;
  const commandBytes = bits === 64 ? 72 + 80 * sections.length : 56 + 68 * sections.length;
  let cursor = align(headerBytes + commandBytes, 16);
  const placed = sections.map((section) => {
    const at = cursor;
    cursor = align(at + section.bytes.length, 16);
    return { ...section, at };
  });
  const bytes = Buffer.alloc(cursor);
  u32(bytes, 0, bits === 64 ? 0xfeedfacf : 0xfeedface, little);
  u32(bytes, 4, options.cpuType ?? (bits === 64 ? 16777228 : 7), little);
  u32(bytes, 8, options.cpuSubtype ?? 0, little);
  u32(bytes, 12, 2, little);
  u32(bytes, 16, 1, little);
  u32(bytes, 20, commandBytes, little);
  u32(bytes, 24, 0, little);
  if (bits === 64) u32(bytes, 28, 0, little);
  const command = headerBytes;
  u32(bytes, command, bits === 64 ? 0x19 : 0x1, little);
  u32(bytes, command + 4, commandBytes, little);
  bytes.write(options.segmentName ?? '__DATA', command + 8, 'latin1');
  const sectionStart = bits === 64 ? command + 72 : command + 56;
  u32(bytes, bits === 64 ? command + 64 : command + 48, sections.length, little);
  placed.forEach((section, index) => {
    const at = sectionStart + index * (bits === 64 ? 80 : 68);
    bytes.write(section.name, at, 'latin1');
    bytes.write(options.segmentName ?? '__DATA', at + 16, 'latin1');
    if (bits === 64) {
      u64(bytes, at + 40, section.bytes.length, little);
      u32(bytes, at + 48, section.at, little);
    } else {
      u32(bytes, at + 36, section.bytes.length, little);
      u32(bytes, at + 40, section.at, little);
    }
    section.bytes.copy(bytes, section.at);
  });
  return bytes;
};

interface TablesOptions {
  readonly heapSizes?: number;
  readonly rows?: Readonly<Record<number, number>>;
  readonly moduleRows?: number;
  readonly moduleNameIndex?: number;
  readonly length?: number;
}

const tablesHeap = (options: TablesOptions = {}): Buffer => {
  const heapSizes = options.heapSizes ?? 0;
  const rows = options.rows ?? {};
  const bits = Object.keys(rows)
    .map(Number)
    .toSorted((left, right) => left - right);
  let valid = 0n;
  for (const bit of bits) valid |= 1n << BigInt(bit);
  const counts = Buffer.alloc(bits.length * 4);
  for (const [index, bit] of bits.entries()) counts.writeUInt32LE(rows[bit] ?? 0, index * 4);
  const stringIndexBytes = (heapSizes & 0x01) === 0 ? 2 : 4;
  const guidIndexBytes = (heapSizes & 0x02) === 0 ? 2 : 4;
  const moduleRows = options.moduleRows ?? 0;
  const moduleRow = Buffer.alloc(moduleRows === 0 ? 0 : 2 + stringIndexBytes + guidIndexBytes * 3);
  if (moduleRows > 0) {
    const nameIndex = options.moduleNameIndex ?? 1;
    if (stringIndexBytes === 4) moduleRow.writeUInt32LE(nameIndex, 2);
    else moduleRow.writeUInt16LE(Math.min(nameIndex, 0xffff), 2);
  }
  const head = Buffer.alloc(24);
  head.writeUInt16LE(2, 4);
  head.writeUInt8(heapSizes, 6);
  head.writeBigUInt64LE(valid, 8);
  const heap = Buffer.concat([head, counts, moduleRow]);
  return options.length === undefined ? heap : heap.subarray(0, options.length);
};

const stringsHeap = (names: readonly string[]): Buffer => Buffer.from(`\0${names.join('\0')}\0`, 'latin1');

interface StreamSpec {
  readonly name: string;
  readonly bytes: Buffer;
}

interface MetadataOptions {
  readonly signature?: string;
  readonly version?: string;
  readonly versionLength?: number;
  readonly streams?: readonly StreamSpec[];
}

const metadataRoot = (options: MetadataOptions = {}): Buffer => {
  const signature = Buffer.from(options.signature ?? 'BSJB', 'latin1');
  const version = Buffer.from(options.version ?? 'v4.0.30319', 'latin1');
  const versionLength = options.versionLength ?? version.length;
  const versionField = align(versionLength, 4);
  const streams = options.streams ?? [];
  const countOffset = 16 + versionField + 2;
  const headerStart = countOffset + 2;
  const headerBytes = streams.reduce((total, stream) => total + 8 + align(stream.name.length + 1, 4), 0);
  let dataOffset = align(headerStart + headerBytes, 4);
  const placed = streams.map((stream) => {
    const at = dataOffset;
    dataOffset = align(at + stream.bytes.length, 4);
    return { ...stream, at };
  });
  const bytes = Buffer.alloc(dataOffset);
  signature.copy(bytes, 0);
  u16(bytes, 4, 1);
  u16(bytes, 6, 1);
  u32(bytes, 12, versionLength);
  version.copy(bytes, 16);
  let cursor = headerStart;
  for (const stream of placed) {
    u32(bytes, cursor, stream.at);
    u32(bytes, cursor + 4, stream.bytes.length);
    bytes.write(stream.name, cursor + 8, 'latin1');
    cursor += 8 + align(stream.name.length + 1, 4);
  }
  u16(bytes, countOffset, streams.length);
  for (const stream of placed) stream.bytes.copy(bytes, stream.at);
  return bytes;
};

interface CliHeaderSpec {
  readonly headerSize?: number;
  readonly major?: number;
  readonly minor?: number;
  readonly metadataRva?: number;
  readonly flags?: number;
  readonly entryToken?: number;
  readonly resourcesRva?: number;
  readonly resourcesSize?: number;
  readonly strongNameRva?: number;
  readonly strongNameSize?: number;
  readonly managedNativeRva?: number;
  readonly managedNativeSize?: number;
}

interface CliPeOptions {
  readonly directory?: { readonly rva: number; readonly size: number } | null;
  readonly header?: CliHeaderSpec;
  readonly metadata?: Buffer;
  readonly metadataSize?: number;
  readonly machine?: number;
  readonly textBytes?: number;
  readonly declaredRawSize?: number;
  readonly declaredVirtualSize?: number;
  readonly characteristics?: number;
}

const TEXT_RVA = 0x2000;
const TEXT_RAW_OFFSET = 0x200;
const METADATA_TEXT_OFFSET = 0x100;

const cliPe = (options: CliPeOptions = {}): Buffer => {
  const textBytes = options.textBytes ?? 0x1000;
  const header = options.header ?? {};
  const metadata = options.metadata;
  const dos = Buffer.alloc(0x80);
  dos.write('MZ', 0, 'latin1');
  dos.writeUInt32LE(0x80, 0x3c);
  const pe = Buffer.alloc(0x200);
  pe.write('PE\0\0', 0, 'latin1');
  pe.writeUInt16LE(options.machine ?? 0x8664, 4);
  pe.writeUInt16LE(1, 6);
  pe.writeUInt16LE(0xf0, 20);
  pe.writeUInt16LE(0x20b, 24);
  pe.writeUInt16LE(options.characteristics ?? 0x22, 22);
  pe.writeUInt32LE(16, 24 + 108);
  const directory = options.directory === undefined ? { rva: TEXT_RVA, size: 72 } : options.directory;
  if (directory !== null) {
    pe.writeUInt32LE(directory.rva, 24 + 112 + 14 * 8);
    pe.writeUInt32LE(directory.size, 24 + 112 + 14 * 8 + 4);
  }
  const section = 24 + 0xf0;
  pe.write('.text\0\0\0', section, 'latin1');
  pe.writeUInt32LE(options.declaredVirtualSize ?? textBytes, section + 8);
  pe.writeUInt32LE(TEXT_RVA, section + 12);
  pe.writeUInt32LE(options.declaredRawSize ?? textBytes, section + 16);
  pe.writeUInt32LE(TEXT_RAW_OFFSET, section + 20);
  pe.writeUInt32LE(0x60000020, section + 36);
  const text = Buffer.alloc(textBytes);
  text.writeUInt32LE(header.headerSize ?? 72, 0);
  text.writeUInt16LE(header.major ?? 2, 4);
  text.writeUInt16LE(header.minor ?? 5, 6);
  text.writeUInt32LE(header.metadataRva ?? TEXT_RVA + METADATA_TEXT_OFFSET, 8);
  text.writeUInt32LE(options.metadataSize ?? metadata?.length ?? 0, 12);
  text.writeUInt32LE(header.flags ?? 0, 16);
  text.writeUInt32LE(header.entryToken ?? 0, 20);
  text.writeUInt32LE(header.resourcesRva ?? 0, 24);
  text.writeUInt32LE(header.resourcesSize ?? 0, 28);
  text.writeUInt32LE(header.strongNameRva ?? 0, 32);
  text.writeUInt32LE(header.strongNameSize ?? 0, 36);
  text.writeUInt32LE(header.managedNativeRva ?? 0, 64);
  text.writeUInt32LE(header.managedNativeSize ?? 0, 68);
  metadata?.copy(text, METADATA_TEXT_OFFSET);
  return Buffer.concat([dos, pe.subarray(0, 0x180), text]);
};

const peWithSection = (name: string, payload: Buffer, virtualSize = payload.length): Buffer => {
  const dos = Buffer.alloc(0x80);
  dos.write('MZ', 0, 'latin1');
  dos.writeUInt32LE(0x80, 0x3c);
  const pe = Buffer.alloc(0x200);
  pe.write('PE\0\0', 0, 'latin1');
  pe.writeUInt16LE(0x8664, 4);
  pe.writeUInt16LE(1, 6);
  pe.writeUInt16LE(0xf0, 20);
  pe.writeUInt16LE(0x20b, 24);
  pe.writeUInt16LE(0x22, 22);
  pe.writeUInt32LE(16, 24 + 108);
  const section = 24 + 0xf0;
  pe.write(`${name}\0`, section, 'latin1');
  pe.writeUInt32LE(virtualSize, section + 8);
  pe.writeUInt32LE(TEXT_RVA, section + 12);
  pe.writeUInt32LE(payload.length, section + 16);
  pe.writeUInt32LE(TEXT_RAW_OFFSET, section + 20);
  pe.writeUInt32LE(0x40000040, section + 36);
  return Buffer.concat([dos, pe.subarray(0, 0x180), payload]);
};

interface AuditableOptions {
  readonly format?: number;
  readonly packages?: readonly unknown[];
}

const auditableDocument = (options: AuditableOptions = {}): Buffer => deflateJson({ ...(options.format === undefined ? {} : { format: options.format }), packages: options.packages ?? [] });

const deepPackages = [
  { name: 'root-crate', version: '0.1.0', source: 'local', kind: 'runtime', dependencies: [1, 2], features: ['std'], root: true },
  { name: 'dep-a', version: '1.2.3', source: 'registry+https://index.example/dep-a', kind: 'other', dependencies: [2], features: null, root: false },
  { name: 'dep-b', version: '2.0.0', source: 'registry+https://index.example/dep-b', dependencies: [1, 'ignored'], features: ['std', 5], root: false },
];

const deepTables = (): Buffer =>
  tablesHeap({
    rows: { 0: 1, 2: 2, 4: 3, 6: 4, 10: 2, 32: 1, 35: 2, 39: 1 },
    moduleRows: 1,
    moduleNameIndex: 1,
  });

const deepMetadata = (): Buffer =>
  metadataRoot({
    streams: [
      { name: '#~', bytes: deepTables() },
      { name: '#Strings', bytes: stringsHeap(['Fixture.dll', 'Fixture.Ref']) },
      { name: '#US', bytes: Buffer.from('\0\0\0\0', 'latin1') },
      { name: '#GUID', bytes: Buffer.alloc(16) },
      { name: '#Blob', bytes: Buffer.from('\0', 'latin1') },
    ],
  });

const DEEP_ROWS = { Module: 1, TypeDef: 2, Field: 3, MethodDef: 4, MemberRef: 2, Assembly: 1, AssemblyRef: 2, ExportedType: 1 };

const DEEP_STREAMS = ['#~', '#Strings', '#US', '#GUID', '#Blob'];

const deepPe = (): Buffer => cliPe({ metadata: deepMetadata(), header: { flags: 0x1, entryToken: 0x06000002, resourcesRva: 0x2200, resourcesSize: 24 } });

const inspectManagedBytes = async (bytes: Buffer, name = 'fixture.exe'): Promise<{ record: ManagedArtifactInspection; path: string; resolvedPath: string; requestedPath: string }> => {
  const targets = await tempTargets();
  const requestedPath = await targets.write(name, bytes);
  const inspected = await inspectManagedArtifactFromPath(requestedPath);
  return { ...inspected, requestedPath };
};

const inspectRustBytes = async (bytes: Buffer, name = 'fixture.bin', options: { readonly cwd?: string } = {}) => {
  const targets = await tempTargets();
  const path = await targets.write(name, bytes);
  return inspectRustBinaryFromPath(path, options);
};

const tempFile = async (name: string, bytes: Buffer): Promise<string> => {
  const targets = await tempTargets();
  return targets.write(name, bytes);
};

const evidenceRecord = (evidenceId: string, normalized: unknown, operation = 'inspect_managed_members'): EvidenceRecord => ({
  evidence_id: evidenceId,
  subject: null,
  provider: { id: 'pi-rea-analysis', name: 'pi-rea analyzers', version: '1' },
  analysis_profile: null,
  predicate_type: 'rea.analysis',
  operation,
  parameters: {},
  raw_result: null,
  normalized_result: normalized,
  confidence: 'observed',
  authority: 'shipped-artifact',
  environment: null,
  limitations: [],
  locations: [],
  evidence_links: [],
});

const LEFT_ID = `ev_${'a'.repeat(64)}`;
const RIGHT_ID = `ev_${'b'.repeat(64)}`;

const normalizedOf = (result: { structuredContent?: unknown }): Record<string, unknown> => (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;

test('reads cargo-auditable packages from a crafted 64-bit ELF', async () => {
  const payload = auditableDocument({ format: 1, packages: deepPackages });
  const bytes = elfWithSection({ payload });
  const { record, resolvedPath } = await inspectRustBytes(bytes);

  expect(resolvedPath).toBe(record.artifact.path);
  expect(record.artifact).toStrictEqual({ path: resolvedPath, sha256: sha256(bytes), bytes: bytes.length });
  expect(record).toMatchObject({ format: 'elf', architecture: 'x86_64', bits: 64, byte_order: 'little', selected_slice: null, rustc_commit: null });
  expect(record.limitations).toStrictEqual([
    'Reports cargo-auditable `.dep-v0` metadata when present; absence is not proof the binary was not built with Rust.',
    'Universal Mach-O requires an explicit architecture; other formats reject architecture.',
  ]);
  expect(record.auditable_metadata).toStrictEqual({
    section_name: '.dep-v0',
    file_offset: 64,
    section_bytes: payload.length,
    compressed_bytes: payload.length,
    uncompressed_bytes: Buffer.byteLength(JSON.stringify({ format: 1, packages: deepPackages }), 'utf8'),
    format_version: 1,
    packages: [
      { name: 'root-crate', version: '0.1.0', source: 'local', kind: 'runtime', dependencies: [1, 2], features: ['std'], root: true },
      { name: 'dep-a', version: '1.2.3', source: 'registry+https://index.example/dep-a', kind: null, dependencies: [2], features: null, root: false },
      { name: 'dep-b', version: '2.0.0', source: 'registry+https://index.example/dep-b', kind: null, dependencies: [1], features: ['std'], root: false },
    ],
    root_package_index: 0,
    dependency_edges: [
      { from_index: 0, to_index: 1 },
      { from_index: 0, to_index: 2 },
      { from_index: 1, to_index: 2 },
      { from_index: 2, to_index: 1 },
    ],
    cyclic_dependency_indices: [1, 2],
  });
});

test('decodes the dependency JSON byte count after inflating', async () => {
  const document = { format: 7, packages: [{ name: 'solo', version: '0.0.1' }] };
  const text = JSON.stringify(document);
  const payload = deflateSync(Buffer.from(text, 'utf8'));
  const { record } = await inspectRustBytes(elfWithSection({ payload }));

  expect(record.auditable_metadata?.uncompressed_bytes).toBe(Buffer.byteLength(text, 'utf8'));
  expect(record.auditable_metadata?.compressed_bytes).toBe(payload.length);
  expect(record.auditable_metadata?.format_version).toBe(7);
  expect(record.auditable_metadata?.packages).toStrictEqual([{ name: 'solo', version: '0.0.1', source: '', kind: null, dependencies: [], features: null, root: false }]);
  expect(record.auditable_metadata?.root_package_index).toBeNull();
  expect(record.auditable_metadata?.cyclic_dependency_indices).toStrictEqual([]);
});

test.for([
  { machine: 3, architecture: 'x86' },
  { machine: 62, architecture: 'x86_64' },
  { machine: 40, architecture: 'arm' },
  { machine: 183, architecture: 'aarch64' },
  { machine: 4242, architecture: 'unknown' },
])('maps ELF machine $machine to $architecture', async ({ machine, architecture }) => {
  const { record } = await inspectRustBytes(elfWithSection({ machine, bits: 32, sectionName: '.note' }));

  expect(record).toMatchObject({ format: 'elf', architecture, bits: 32, byte_order: 'little', auditable_metadata: null });
});

test('reads a 32-bit little-endian dep section', async () => {
  const payload = auditableDocument({ packages: [{ name: 'smart', version: '9.9.9' }] });
  const { record } = await inspectRustBytes(elfWithSection({ payload, bits: 32, machine: 40 }));

  expect(record).toMatchObject({ format: 'elf', architecture: 'arm', bits: 32, byte_order: 'little' });
  expect(record.auditable_metadata?.section_name).toBe('.dep-v0');
  expect(record.auditable_metadata?.packages[0]?.name).toBe('smart');
});

test('reads a big-endian 64-bit dep section', async () => {
  const payload = auditableDocument({ packages: [{ name: 'big', version: '1.0.0' }] });
  const { record } = await inspectRustBytes(elfWithSection({ payload, bits: 64, little: false, machine: 183 }));

  expect(record).toMatchObject({ format: 'elf', architecture: 'aarch64', bits: 64, byte_order: 'big' });
  expect(record.auditable_metadata?.packages).toStrictEqual([{ name: 'big', version: '1.0.0', source: '', kind: null, dependencies: [], features: null, root: false }]);
});

test('reads a big-endian ELF without a dep section', async () => {
  const { record } = await inspectRustBytes(elfWithSection({ bits: 64, little: false, machine: 4242, sectionName: '.note' }));

  expect(record).toMatchObject({ format: 'elf', architecture: 'unknown', bits: 64, byte_order: 'big', auditable_metadata: null });
});

test.for([
  { name: 'invalid zlib', payload: Buffer.from('plain text', 'latin1'), detail: '`.dep-v0` payload is not zlib-compressed' },
  { name: 'invalid JSON', payload: deflateSync(Buffer.from('not json', 'utf8')), detail: '`.dep-v0` uncompressed payload is not JSON' },
])('reports an $name dep payload as invalid_format', async ({ payload, detail }) => {
  const targets = await tempTargets();
  const path = await targets.write('broken.elf', elfWithSection({ payload }));
  const payloadError = await payloadOf(() => inspectRustBinaryFromPath(path));

  expect(payloadError).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The inspection input is not usable. Check the argument and retry.',
    retryable: true,
    remediation: { action: 'The inspection input is not usable. Check the argument and retry.' },
    details: { operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_format', message: `Cannot inspect ${path}: ${detail}` }] },
  });
});

test.for([
  { name: 'array root', document: [] },
  { name: 'extra root key', document: { packages: [], notes: 'x' } },
  { name: 'packages not an array', document: { packages: {} } },
  { name: 'package not an object', document: { packages: ['root'] } },
  { name: 'package extra key', document: { packages: [{ name: 'root', license: 'MIT' }] } },
])('rejects a dep document with an $name', async ({ document }) => {
  const targets = await tempTargets();
  const path = await targets.write('schema.elf', elfWithSection({ payload: deflateJson(document) }));
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for inspect_rust_binary; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'inspect_rust_binary' },
    details: {
      operation: 'inspect_rust_binary',
      issues: [{ path: ['path'], reason: 'invalid_format', message: `Selected artifact ${path}: Dependency JSON does not match the package schema` }],
    },
  });
});

test('reports an ELF whose architecture option is set', async () => {
  const targets = await tempTargets();
  const path = await targets.write('elf.bin', elfWithSection({ payload: auditableDocument(), machine: 62 }));
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path, { architecture: 'x86_64' }));

  expect(payload.details).toStrictEqual({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: architecture is only valid for universal Mach-O.` }] });
  expect(payload.code).toBe('invalid_request');
});

test('reports a PE whose architecture option is set', async () => {
  const targets = await tempTargets();
  const path = await targets.write('pe.bin', peWithSection('.dep-v0', auditableDocument()));
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path, { architecture: 'arm64' }));

  expect(payload.details).toStrictEqual({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: architecture is only valid for universal Mach-O.` }] });
});

test('reads a dep section from an unknown-machine ELF', async () => {
  const { record } = await inspectRustBytes(elfWithSection({ payload: auditableDocument({ packages: [{ name: 'odd' }] }), machine: 4242 }));

  expect(record).toMatchObject({ format: 'elf', architecture: 'unknown', bits: 64 });
  expect(record.auditable_metadata?.packages[0]?.name).toBe('odd');
});

test('defaults a package that declares no fields', async () => {
  const { record } = await inspectRustBytes(elfWithSection({ payload: auditableDocument({ packages: [{}] }) }));

  expect(record.auditable_metadata?.packages).toStrictEqual([{ name: '', version: '', source: '', kind: null, dependencies: [], features: null, root: false }]);
  expect(record.auditable_metadata?.format_version).toBeNull();
  expect(record.auditable_metadata?.root_package_index).toBeNull();
});

test('keeps a dependency index that has no package', async () => {
  const { record } = await inspectRustBytes(elfWithSection({ payload: auditableDocument({ packages: [{ name: 'solo', dependencies: [99] }] }) }));

  expect(record.auditable_metadata?.dependency_edges).toStrictEqual([{ from_index: 0, to_index: 99 }]);
  expect(record.auditable_metadata?.cyclic_dependency_indices).toStrictEqual([]);
  expect(record.auditable_metadata?.root_package_index).toBeNull();
});

test('reads a dep section name that runs to the string table end', async () => {
  const { record } = await inspectRustBytes(elfWithSection({ payload: auditableDocument({ packages: [{ name: 'unterminated' }] }), unterminatedNames: true }));

  expect(record.auditable_metadata?.section_name).toBe('.dep-v0');
  expect(record.auditable_metadata?.packages[0]?.name).toBe('unterminated');
});

test('reads a dep section from a 64-bit big-endian Mach-O', async () => {
  const payload = auditableDocument({ packages: [{ name: 'big-macho', version: '0.5.0' }] });
  const bytes = machOThin({ bits: 64, little: false, cpuType: 16777223, sections: [{ name: '.dep-v0', bytes: payload }] });
  const { record } = await inspectRustBytes(bytes);

  expect(record).toMatchObject({ format: 'macho', architecture: 'x86_64', bits: 64, byte_order: 'big' });
  expect(record.auditable_metadata?.packages[0]?.name).toBe('big-macho');
});

test('reads a thin 64-bit Mach-O slice descriptor', async () => {
  const bytes = machOThin({ bits: 64, little: true, cpuType: 16777228, cpuSubtype: 2 });
  const { record } = await inspectRustBytes(bytes);

  expect(record).toMatchObject({ format: 'macho', architecture: 'arm64', bits: 64, byte_order: 'little', auditable_metadata: null });
  expect(record.selected_slice).toStrictEqual({ kind: 'mach-o-slice', container: 'thin', offset: 0, byte_length: bytes.length, cpu_type: 16777228, cpu_subtype: 2, container_table_sha256: null });
});

test('reads a dep section from a Mach-O __DATA segment', async () => {
  const payload = auditableDocument({ packages: [{ name: 'macho', version: '3.1.4' }] });
  const bytes = machOThin({ bits: 64, little: true, segmentName: '__DATA', sections: [{ name: '.dep-v0', bytes: payload }] });
  const { record } = await inspectRustBytes(bytes);

  expect(record.auditable_metadata?.section_name).toBe('__DATA,.dep-v0');
  expect(record.auditable_metadata?.file_offset).toBe(192);
  expect(record.auditable_metadata?.packages[0]?.version).toBe('3.1.4');
  expect(record.selected_slice?.byte_length).toBe(bytes.length);
});

test('reads a 32-bit big-endian Mach-O without a dep section', async () => {
  const bytes = machOThin({ bits: 32, little: false, cpuType: 7, segmentName: '__TEXT', sections: [{ name: '.text', bytes: Buffer.from([1, 2, 3, 4]) }] });
  const { record } = await inspectRustBytes(bytes);

  expect(record).toMatchObject({ format: 'macho', architecture: 'x86', bits: 32, byte_order: 'big', auditable_metadata: null });
});

test('maps an unknown Mach-O cpu type to unknown architecture', async () => {
  const { record } = await inspectRustBytes(machOThin({ cpuType: 99 }));

  expect(record.architecture).toBe('unknown');
  expect(record.selected_slice?.cpu_type).toBe(99);
});

test.for([
  { architecture: undefined, detail: 'universal Mach-O requires architecture' },
  { architecture: 'arm64', detail: 'universal Mach-O slice selection is not implemented in this unit' },
])('rejects a universal Mach-O with architecture $architecture', async ({ architecture, detail }) => {
  const targets = await tempTargets();
  const path = await targets.write('fat.bin', Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]));
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path, architecture === undefined ? {} : { architecture }));

  expect(payload.details).toStrictEqual({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_format', message: `Cannot inspect ${path}: ${detail}` }] });
});

test('rejects an architecture option on a thin Mach-O', async () => {
  const targets = await tempTargets();
  const path = await targets.write('thin.bin', machOThin());
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path, { architecture: 'arm64' }));

  expect(payload.details).toStrictEqual({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_format', message: `Cannot inspect ${path}: architecture is only valid for universal Mach-O` }] });
});

test('reports a file with no known magic as unrecognised', async () => {
  const payload = await payloadOf(() => inspectRustBinaryFromPath(fixturePath('targets/note.txt')));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The inspection input is not usable. Check the argument and retry.',
    retryable: true,
    remediation: { action: 'The inspection input is not usable. Check the argument and retry.' },
    details: {
      operation: 'inspect_rust_binary',
      issues: [{ path: ['path'], reason: 'invalid_format', message: `Cannot inspect ${fixturePath('targets/note.txt')}: unrecognised binary format` }],
    },
  });
});

test('reports an ELF magic with a truncated header as not elf', async () => {
  const targets = await tempTargets();
  const path = await targets.write('stub.elf', Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path));

  expect(payload.details).toStrictEqual({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_format', message: `Cannot inspect ${path}: not elf` }] });
});

test('maps a two-byte file to a format error from the reader', async () => {
  const targets = await tempTargets();
  const path = await targets.write('short.bin', Buffer.from([0x61, 0x62]));
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path));

  expect(payload.code).toBe('invalid_request');
  expect(payload.details).toMatchObject({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_format', message: expect.stringContaining(`Cannot inspect ${path}: `) }] });
});

test('reports a missing rust artifact path', async () => {
  const targets = await tempTargets();
  const path = join(targets.dir, 'absent.bin');
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path));

  expect(payload.details).toStrictEqual({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: no file exists there` }] });
});

test('reports an unreadable rust artifact path', async () => {
  const targets = await tempTargets();
  const file = await targets.write('plain.txt', 'text');
  const path = join(file, 'child');
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path));
  const issues = (payload.details as { issues: { reason: string; message: string }[] }).issues;

  expect(issues[0]?.reason).toBe('invalid_value');
  expect(issues[0]?.message.startsWith(`Cannot inspect ${path}: it could not be read (ENOTDIR`)).toBe(true);
});

test('resolves a relative rust artifact path against the cwd option', async () => {
  const targets = await tempTargets();
  const bytes = elfWithSection({ payload: auditableDocument(), machine: 62 });
  await targets.write('relative.elf', bytes);
  const { record, resolvedPath } = await inspectRustBinaryFromPath('relative.elf', { cwd: targets.dir });

  expect(resolvedPath).toBe(join(targets.dir, 'relative.elf'));
  expect(record.artifact.path).toBe('relative.elf');
  expect(record.artifact.bytes).toBe(bytes.length);
});

test('reads a dep section from a PE image', async () => {
  const payload = auditableDocument({ packages: [{ name: 'win-crate', version: '4.2.0' }] });
  const { record } = await inspectRustBytes(peWithSection('.dep-v0', payload));

  expect(record).toMatchObject({ format: 'pe', architecture: 'x86_64', bits: 64, byte_order: 'little', selected_slice: null });
  expect(record.auditable_metadata?.section_name).toBe('.dep-v0');
  expect(record.auditable_metadata?.file_offset).toBe(TEXT_RAW_OFFSET);
  expect(record.auditable_metadata?.packages[0]?.name).toBe('win-crate');
});

test('reports a PE without a dep section as having no metadata', async () => {
  const { record } = await inspectRustBytes(peWithSection('.rdata', auditableDocument()));

  expect(record.format).toBe('pe');
  expect(record.auditable_metadata).toBeNull();
  expect(record.architecture).toBe('x86_64');
});

test('reports a zero-length PE dep section as invalid', async () => {
  const targets = await tempTargets();
  const path = await targets.write('zero.exe', peWithSection('.dep-v0', auditableDocument(), 0));
  const payload = await payloadOf(() => inspectRustBinaryFromPath(path));

  expect(payload.details).toStrictEqual({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_format', message: `Cannot inspect ${path}: \`.dep-v0\` payload is not zlib-compressed` }] });
});

test('classifies a crafted CLI image with complete metadata', async () => {
  const bytes = deepPe();
  const metadata = deepMetadata();
  const { record, path, resolvedPath, requestedPath } = await inspectManagedBytes(bytes);

  expect(path).toBe(requestedPath);
  expect(resolvedPath).toBe(await realpath(requestedPath));
  expect(record).toStrictEqual({
    artifact: { path: resolvedPath, sha256: sha256(bytes), byte_length: bytes.length, format: 'pe' },
    pe: {
      machine: 34404,
      machine_hex: '0x8664',
      architecture: 'x86_64',
      optional_header: 'pe32-plus',
      section_count: 1,
      characteristics: 0x22,
      cli: {
        header_offset: TEXT_RAW_OFFSET,
        header_size: 72,
        runtime_version: '2.5',
        flags: 0x1,
        flag_names: ['ILOnly'],
        entry_point: { kind: 'metadata-token', value: '0x6000002' },
        metadata_rva: TEXT_RVA + METADATA_TEXT_OFFSET,
        metadata_size: metadata.length,
        resources_rva: 0x2200,
        resources_size: 24,
        strong_name_rva: 0,
        strong_name_size: 0,
        managed_native_header_rva: 0,
        managed_native_header_size: 0,
        ready_to_run_signature: false,
      },
    },
    classification: {
      status: 'managed',
      container: 'pe',
      runtime_family: 'unknown',
      implementation: 'cil',
      managed_architecture: 'anycpu',
      evidence: [{ code: 'clr-directory', detail: `CLR header at file offset ${TEXT_RAW_OFFSET}`, file_offset: TEXT_RAW_OFFSET }],
    },
    metadata: { status: 'complete', version: 'v4.0.30319', stream_names: DEEP_STREAMS, table_row_counts: DEEP_ROWS },
    module: { name: 'Fixture.dll', mvid: null },
    assembly: null,
    target_frameworks: [],
    references: [],
    resources: [],
    attributes: [],
    coverage: { state: 'complete', issues: [] },
    limitations: ['Managed metadata is inventoried without loading assemblies or executing CIL.', 'Custom attribute blobs and strong-name signatures are not verified.'],
  });
});

test('trusts a tables heap shorter than its header as complete', async () => {
  const { record } = await inspectManagedBytes(buildMinimalCliPeFixture());

  expect(record.metadata).toStrictEqual({ status: 'complete', version: 'v4.0.30319', stream_names: ['#~'], table_row_counts: {} });
  expect(record.module).toBeNull();
  expect(record.pe.cli).toMatchObject({ flags: 1, runtime_version: '2.5', entry_point: { kind: 'none', value: null } });
  expect(record.classification).toMatchObject({ status: 'managed', implementation: 'cil', managed_architecture: 'anycpu' });
});

test('classifies a PE with no CLI directory as not-managed', async () => {
  const bytes = cliPe({ directory: null });
  const { record } = await inspectManagedBytes(bytes);

  expect(record.pe.cli).toBeNull();
  expect(record.classification).toStrictEqual({
    status: 'not-managed',
    container: 'pe',
    runtime_family: 'unknown',
    implementation: 'not-managed',
    managed_architecture: 'unknown',
    evidence: [{ code: 'cli-directory-absent', detail: 'The PE has no CLI data directory; managed metadata and CIL are unavailable.', file_offset: null }],
  });
  expect(record.metadata).toStrictEqual({ status: 'absent', version: null, stream_names: [], table_row_counts: {} });
  expect(record.coverage).toStrictEqual({ state: 'unavailable', issues: [] });
  expect(record.limitations).toStrictEqual(['The PE has no CLI data directory; managed metadata and CIL are unavailable.']);
});

test.for([
  { name: 'zero rva', directory: { rva: 0, size: 8 } },
  { name: 'zero size', directory: { rva: TEXT_RVA, size: 0 } },
])('treats a CLI directory with $name as absent', async ({ directory }) => {
  const { record } = await inspectManagedBytes(cliPe({ directory }));

  expect(record.classification.status).toBe('not-managed');
  expect(record.pe.cli).toBeNull();
  expect(record.classification.evidence).toStrictEqual([{ code: 'cli-directory-absent', detail: 'The PE has no CLI data directory; managed metadata and CIL are unavailable.', file_offset: null }]);
});

test('maps a RISC-V PE architecture onto x86 when not managed', async () => {
  const { record } = await inspectManagedBytes(cliPe({ directory: null, machine: 20580 }));

  expect(record.pe.architecture).toBe('x86');
  expect(record.pe.machine).toBe(20580);
});

test.for([
  { machine: 332, architecture: 'x86' },
  { machine: 43620, architecture: 'arm64' },
  { machine: 448, architecture: 'arm' },
])('keeps the $architecture machine code for a not-managed PE', async ({ machine, architecture }) => {
  const { record } = await inspectManagedBytes(cliPe({ directory: null, machine }));

  expect(record.pe.architecture).toBe(architecture);
  expect(record.pe.machine).toBe(machine);
  expect(record.classification.status).toBe('not-managed');
});

test('maps an unknown machine in the managed branch to x86', async () => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: metadataRoot(), machine: 0x1234 }));

  expect(record.pe.architecture).toBe('x86');
  expect(record.classification.status).toBe('managed');
});

test('reads a version string longer than its declared length', async () => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: metadataRoot({ versionLength: 4 }) }));

  expect(record.metadata.version).toBe('v4.0');
  expect(record.metadata.status).toBe('partial');
});

test('stops reading streams when a declared header is missing', async () => {
  const metadata = metadataRoot();
  metadata.writeUInt16LE(1, 30);
  const { record } = await inspectManagedBytes(cliPe({ metadata }));

  expect(record.metadata).toStrictEqual({ status: 'partial', version: 'v4.0.30319', stream_names: [], table_row_counts: {} });
});

test.for([
  { name: 'unmapped rva', directory: { rva: 0x9000, size: 72 }, textBytes: 0x1000 },
  { name: 'header past the file', directory: { rva: 0x2f00, size: 72 }, textBytes: 0x400 },
])('reports a CLI header with an $name as malformed', async ({ directory, textBytes }) => {
  const { record } = await inspectManagedBytes(cliPe({ directory, textBytes, declaredRawSize: 0x1000 }));

  expect(record.pe.cli).toBeNull();
  expect(record.classification).toStrictEqual({
    status: 'malformed',
    container: 'pe',
    runtime_family: 'unknown',
    implementation: 'unknown',
    managed_architecture: 'unknown',
    evidence: [{ code: 'clr-header-unmapped', detail: 'CLR header RVA could not be mapped', file_offset: null }],
  });
  expect(record.metadata.status).toBe('malformed');
  expect(record.coverage).toStrictEqual({ state: 'partial', issues: ['CLR header unmapped'] });
});

test('maps an unknown machine PE to x86 in the malformed branch', async () => {
  const { record } = await inspectManagedBytes(cliPe({ directory: { rva: 0x9000, size: 72 }, machine: 0x1234 }));

  expect(record.pe.architecture).toBe('x86');
  expect(record.pe.machine_hex).toBe('0x1234');
  expect(record.classification.status).toBe('malformed');
});

test('reports managed metadata whose RVA does not map', async () => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: deepMetadata(), header: { metadataRva: 0x9000 } }));

  expect(record.classification.status).toBe('managed');
  expect(record.metadata).toStrictEqual({ status: 'malformed', version: null, stream_names: [], table_row_counts: {} });
  expect(record.module).toBeNull();
  expect(record.coverage).toStrictEqual({ state: 'partial', issues: ['metadata RVA unmapped'] });
});

test.for([
  { name: 'offset past the file', metadataRva: 0x2300, textBytes: 0x200, metadataSize: 32, declaredRawSize: 0x1000 },
  { name: 'declared size past the file', metadataRva: TEXT_RVA + METADATA_TEXT_OFFSET, textBytes: 0x400, metadataSize: 0x100000, declaredRawSize: 0x400 },
])('reports a metadata root with $name as malformed', async ({ metadataRva, textBytes, metadataSize, declaredRawSize }) => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: metadataRoot(), textBytes, metadataSize, declaredRawSize, header: { metadataRva } }));

  expect(record.metadata).toStrictEqual({ status: 'malformed', version: null, stream_names: [], table_row_counts: {} });
  expect(record.coverage).toStrictEqual({ state: 'partial', issues: ['CLI metadata root extends past the file'] });
});

test('reports a metadata root without the BSJB signature', async () => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: metadataRoot({ signature: 'XXJB' }) }));

  expect(record.metadata.status).toBe('malformed');
  expect(record.coverage).toStrictEqual({ state: 'partial', issues: ['CLI metadata signature is not BSJB'] });
});

test('reports metadata truncated before its stream headers', async () => {
  const metadata = metadataRoot({ streams: [{ name: '#~', bytes: deepTables() }] });
  const { record } = await inspectManagedBytes(cliPe({ metadata, metadataSize: 20 }));

  expect(record.metadata).toStrictEqual({ status: 'partial', version: 'v4.0.30319', stream_names: [], table_row_counts: {} });
  expect(record.coverage).toStrictEqual({ state: 'partial', issues: ['stream header truncated'] });
});

test('reports partial metadata when no tables stream exists', async () => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: metadataRoot({ streams: [{ name: '#Strings', bytes: stringsHeap(['Only.dll']) }] }) }));

  expect(record.metadata).toStrictEqual({ status: 'partial', version: 'v4.0.30319', stream_names: ['#Strings'], table_row_counts: {} });
  expect(record.coverage).toStrictEqual({ state: 'complete', issues: [] });
});

test('reports partial metadata when the tables heap declares no streams', async () => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: metadataRoot() }));

  expect(record.metadata).toStrictEqual({ status: 'partial', version: 'v4.0.30319', stream_names: [], table_row_counts: {} });
  expect(record.module).toBeNull();
});

test('reads table counts through the uncatalogued #- stream name', async () => {
  const metadata = metadataRoot({
    streams: [
      { name: '#-', bytes: tablesHeap({ rows: { 0: 1, 6: 5 }, moduleRows: 1, moduleNameIndex: 1 }) },
      { name: '#Strings', bytes: stringsHeap(['Alt.dll']) },
    ],
  });
  const { record } = await inspectManagedBytes(cliPe({ metadata }));

  expect(record.metadata).toStrictEqual({ status: 'complete', version: 'v4.0.30319', stream_names: ['#-', '#Strings'], table_row_counts: { Module: 1, MethodDef: 5 } });
  expect(record.module).toStrictEqual({ name: 'Alt.dll', mvid: null });
});

test('reports partial metadata when the row-count region is cut short', async () => {
  const metadata = metadataRoot({ streams: [{ name: '#~', bytes: tablesHeap({ rows: { 0: 1 }, length: 24 }) }] });
  const { record } = await inspectManagedBytes(cliPe({ metadata }));

  expect(record.metadata.status).toBe('partial');
  expect(record.metadata.table_row_counts).toStrictEqual({});
  expect(record.coverage).toStrictEqual({ state: 'partial', issues: ['table row-count region truncated'] });
});

test('consumes a row count for a table index past the name table', async () => {
  const metadata = metadataRoot({ streams: [{ name: '#~', bytes: tablesHeap({ rows: { 63: 1 } }) }] });
  const { record } = await inspectManagedBytes(cliPe({ metadata }));

  expect(record.metadata.status).toBe('complete');
  expect(record.metadata.table_row_counts).toStrictEqual({});
});

test('reports an empty module name for an out-of-range string index', async () => {
  const metadata = metadataRoot({
    streams: [
      { name: '#~', bytes: tablesHeap({ rows: { 0: 1 }, moduleRows: 1, moduleNameIndex: 999 }) },
      { name: '#Strings', bytes: stringsHeap(['Fixture.dll']) },
    ],
  });
  const { record } = await inspectManagedBytes(cliPe({ metadata }));

  expect(record.module).toStrictEqual({ name: '', mvid: null });
  expect(record.metadata.status).toBe('complete');
});

test('reports an empty module name when the strings heap is absent', async () => {
  const metadata = metadataRoot({ streams: [{ name: '#~', bytes: tablesHeap({ rows: { 0: 1 }, moduleRows: 1, moduleNameIndex: 1 }) }] });
  const { record } = await inspectManagedBytes(cliPe({ metadata }));

  expect(record.module).toStrictEqual({ name: '', mvid: null });
});

test('reads a module name through four-byte heap indexes', async () => {
  const metadata = metadataRoot({
    streams: [
      { name: '#~', bytes: tablesHeap({ heapSizes: 0x03, rows: { 0: 1 }, moduleRows: 1, moduleNameIndex: 1 }) },
      { name: '#Strings', bytes: stringsHeap(['Wide.dll']) },
    ],
  });
  const { record } = await inspectManagedBytes(cliPe({ metadata }));

  expect(record.module).toStrictEqual({ name: 'Wide.dll', mvid: null });
  expect(record.metadata.table_row_counts).toStrictEqual({ Module: 1 });
});

test('reports no module when the module table declares no rows', async () => {
  const metadata = metadataRoot({ streams: [{ name: '#~', bytes: tablesHeap({ rows: { 0: 0, 2: 3 } }) }] });
  const { record } = await inspectManagedBytes(cliPe({ metadata }));

  expect(record.module).toBeNull();
  expect(record.metadata.table_row_counts).toStrictEqual({ Module: 0, TypeDef: 3 });
});

test('names every CLI flag bit that is set', async () => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: metadataRoot(), header: { flags: 0x3001f, entryToken: 0x2000 } }));

  expect(record.pe.cli?.flag_names).toStrictEqual(['ILOnly', 'Requires32Bit', 'ILLibrary', 'StrongNameSigned', 'NativeEntryPoint', 'TrackDebugEnabled', 'Prefer32Bit']);
  expect(record.pe.cli?.entry_point).toStrictEqual({ kind: 'native-rva', value: '0x2000' });
  expect(record.classification).toMatchObject({ implementation: 'cpp-cli-mixed', managed_architecture: 'anycpu-prefer-32' });
});

test.for([
  { name: 'il-only', flags: 0x1, entryToken: 0x06000002, managedNativeRva: 0, managedNativeSize: 0, implementation: 'cil', managedArchitecture: 'anycpu', entryKind: 'metadata-token', entryValue: '0x6000002', readyToRun: false },
  { name: 'native-entry', flags: 0x10, entryToken: 0x2000, managedNativeRva: 0, managedNativeSize: 0, implementation: 'cpp-cli-mixed', managedArchitecture: 'x86_64', entryKind: 'native-rva', entryValue: '0x2000', readyToRun: false },
  { name: 'no-flags', flags: 0, entryToken: 0, managedNativeRva: 0, managedNativeSize: 0, implementation: 'unknown', managedArchitecture: 'x86_64', entryKind: 'none', entryValue: null, readyToRun: false },
  { name: 'ready-to-run', flags: 0, entryToken: 0, managedNativeRva: 0x2010, managedNativeSize: 8, implementation: 'cil-and-ready-to-run', managedArchitecture: 'x86_64', entryKind: 'none', entryValue: null, readyToRun: true },
])('classifies a $name CLI header', async ({ flags, entryToken, managedNativeRva, managedNativeSize, implementation, managedArchitecture, entryKind, entryValue, readyToRun }) => {
  const { record } = await inspectManagedBytes(cliPe({ metadata: metadataRoot(), header: { flags, entryToken, managedNativeRva, managedNativeSize } }));

  expect(record.pe.cli).toMatchObject({ flags, entry_point: { kind: entryKind, value: entryValue }, ready_to_run_signature: readyToRun });
  expect(record.classification).toMatchObject({ implementation, managed_architecture: managedArchitecture });
});

test('reports a non-PE file as an unusable managed artifact', async () => {
  const path = fixturePath('targets/note.txt');
  const payload = await payloadOf(() => inspectManagedArtifactFromPath(path));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The inspection input is not usable. Check the argument and retry.',
    retryable: true,
    remediation: { action: 'The inspection input is not usable. Check the argument and retry.' },
    details: { operation: 'inspect_managed_artifact', issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: it is not a PE image (not an MZ image)` }] },
  });
});

test('reports a missing managed artifact path', async () => {
  const targets = await tempTargets();
  const path = join(targets.dir, 'absent.exe');
  const payload = await payloadOf(() => inspectManagedArtifactFromPath(path));
  const issues = (payload.details as { issues: { reason: string; message: string }[] }).issues;

  expect(issues[0]?.reason).toBe('invalid_value');
  expect(issues[0]?.message.startsWith(`Cannot inspect ${path}: it could not be read (ENOENT`)).toBe(true);
});

test('resolves a relative managed artifact path against the cwd option', async () => {
  const targets = await tempTargets();
  await targets.write('relative.exe', deepPe());
  const { path, resolvedPath, record } = await inspectManagedArtifactFromPath('relative.exe', { cwd: targets.dir });

  expect(path).toBe('relative.exe');
  expect(resolvedPath).toBe(await realpath(join(targets.dir, 'relative.exe')));
  expect(record.artifact.path).toBe(resolvedPath);
  expect(record.classification.status).toBe('managed');
});

test('inventories managed members from complete metadata', async () => {
  const bytes = deepPe();
  const { record, resolvedPath } = await inspectManagedMembersFromPath(await tempFile('members.exe', bytes));
  const digest = sha256(bytes);

  expect(record.signature_resolution).toBe('type-names-v1');
  expect(record.artifact).toStrictEqual({ path: resolvedPath, sha256: digest, byte_length: bytes.length, format: 'pe' });
  expect(record.module).toStrictEqual({ name: 'Fixture.dll', mvid: null });
  expect(record.assembly).toBeNull();
  expect(record.metadata).toStrictEqual({ status: 'complete', version: 'v4.0.30319', stream_names: DEEP_STREAMS, table_row_counts: DEEP_ROWS });
  expect(record.identity_scope).toStrictEqual({ token_identity: 'build-local', requires_artifact_sha256: digest, requires_mvid: null });
  expect(record.exported_types).toStrictEqual([]);
  expect(record.types).toStrictEqual([]);
  expect(record.methods).toStrictEqual([]);
  expect(record.fields).toStrictEqual([]);
  expect(record.member_refs).toStrictEqual([]);
  expect(record.call_edges).toStrictEqual([]);
  expect(record.field_accesses).toStrictEqual([]);
  expect(record.user_strings).toBeNull();
  expect(record.method_rows).toBeNull();
  expect(record.selection).toBeNull();
  expect(record.nesting_read).toBe(false);
  expect(record.coverage).toStrictEqual({ state: 'partial', issues: ['TypeDef rows declared: 2', 'MethodDef rows declared: 4', 'Field rows declared: 3', 'MemberRef rows declared: 2'] });
  expect(record.limitations).toHaveLength(4);
  expect(record.limitations[3]).toBe('Metadata tokens remain build-local coordinates bound to the artifact digest and MVID when present.');
});

test('reports exported types as null when none are declared', async () => {
  const metadata = metadataRoot({ streams: [{ name: '#~', bytes: tablesHeap({ rows: { 0: 1, 39: 0 } }) }] });
  const { record } = await inspectManagedMembersFromPath(await tempFile('plain.exe', cliPe({ metadata })));

  expect(record.exported_types).toBeNull();
  expect(record.metadata.table_row_counts).toStrictEqual({ Module: 1, ExportedType: 0 });
  expect(record.coverage.issues).toStrictEqual(['TypeDef rows declared: 0', 'MethodDef rows declared: 0', 'Field rows declared: 0', 'MemberRef rows declared: 0']);
});

test('reports exported types as null when the table is not declared', async () => {
  const metadata = metadataRoot({ streams: [{ name: '#~', bytes: tablesHeap({ rows: { 0: 1 } }) }] });
  const { record } = await inspectManagedMembersFromPath(await tempFile('undeclared.exe', cliPe({ metadata })));

  expect(record.exported_types).toBeNull();
  expect(record.metadata.table_row_counts).toStrictEqual({ Module: 1 });
  expect(record.coverage.state).toBe('partial');
});

test('reports member inspection as unavailable for a non-managed PE', async () => {
  const bytes = cliPe({ directory: null });
  const { record, resolvedPath, architecture } = await inspectManagedMembersFromPath(await tempFile('native.exe', bytes));

  expect(architecture).toBe('x86_64');
  expect(resolvedPath.endsWith('native.exe')).toBe(true);
  expect(record).toMatchObject({ signature_resolution: 'type-names-v1', module: null, assembly: null, nesting_read: false, exported_types: null, user_strings: null, method_rows: null, selection: null });
  expect(record.metadata).toStrictEqual({ status: 'absent', version: null, table_row_counts: {} });
  expect(record.identity_scope).toStrictEqual({ token_identity: 'build-local', requires_artifact_sha256: record.artifact.sha256, requires_mvid: null });
  expect(record.coverage).toStrictEqual({ state: 'unavailable', issues: [] });
  expect(record.limitations).toStrictEqual(['The PE has no admitted CLI metadata; managed member inspection is unavailable.']);
});

test('reports member inspection as unavailable for a malformed CLI image', async () => {
  const { record } = await inspectManagedMembersFromPath(await tempFile('broken.exe', cliPe({ directory: { rva: 0x9000, size: 72 } })));

  expect(record.metadata).toStrictEqual({ status: 'absent', version: null, table_row_counts: {} });
  expect(record.coverage).toStrictEqual({ state: 'unavailable', issues: [] });
  expect(record.limitations).toStrictEqual(['The PE has no admitted CLI metadata; managed member inspection is unavailable.']);
});

test('summarizes managed member pairing counts', () => {
  const left = evidenceRecord(LEFT_ID, {
    identity_scope: { artifact_sha256: 'aa'.repeat(32), mvid: 'mvid-left' },
    classification: { status: 'managed' },
    module: { name: 'Left.dll', mvid: 'module-left' },
    methods: [{ declared_type: 'Ns.Type', name: 'Run', cil: 'ldarg.0' }, { declared_type: 'Ns.Type', name: 'Stop', signature: 'void()' }, { declared_type: 'Ns.Type' }],
    fields: [
      { type_name: 'Ns.Type', name: 'count', signature: 'int32' },
      { type_name: 'Ns.Type', name: 'gone', signature: 'int64' },
    ],
    coverage: { status: 'complete' },
    exported_types: [],
    user_strings: [],
    method_rows: {},
  });
  const right = evidenceRecord(RIGHT_ID, {
    identity_scope: { artifact_sha256: 'bb'.repeat(32) },
    module: { name: 'Right.dll' },
    methods: [
      { declared_type: 'Ns.Type', name: 'Run', cil: 'ldarg.0' },
      { declared_type: 'Ns.Type', name: 'Start', signature: 'void()' },
    ],
    fields: [
      { type_name: 'Ns.Type', name: 'count', signature: 'int32' },
      { type_name: 'Ns.Type', name: 'fresh', signature: 'int32' },
    ],
    coverage: { state: 'complete' },
    exported_types: [],
    user_strings: [],
    method_rows: {},
  });

  const record = compareManagedMemberEvidence(left, right);
  const summary = { unchanged: 2, changed: 0, added: 2, removed: 2, unknown: 1 };
  const comparisonId = `mmc_${createHash('sha256')
    .update(JSON.stringify({ left: LEFT_ID, right: RIGHT_ID, summary }))
    .digest('hex')}`;

  expect(record).toMatchObject({
    comparison_id: comparisonId,
    algorithm: { name: 'rea-managed-member-comparison', token_identity: 'build-local', name_matching: 'exact-signature-fallback' },
    left: { evidence_id: LEFT_ID, artifact_sha256: 'aa'.repeat(32), mvid: 'mvid-left', module_name: 'Left.dll', metadata_status: 'present', methods_total: 3, fields_total: 2 },
    right: { evidence_id: RIGHT_ID, artifact_sha256: 'bb'.repeat(32), mvid: null, module_name: 'Right.dll', metadata_status: 'present', methods_total: 2, fields_total: 2 },
    summary,
    matching: { exact_il_signature: 1, exact_signature: 0, structural_method_shape: 0, field_signature: 1, ambiguous: 0, unmatched: 4 },
    methods: [],
    fields: [],
    coverage: { status: 'partial', left_status: 'complete', right_status: 'complete' },
    evidence_links: [LEFT_ID, RIGHT_ID],
  });
  expect(record.limitations).toHaveLength(3);
  expect(record.limitations[0]).toBe('Metadata tokens are build-local coordinates; matched pairs are remaps, not persistent identities.');
});

test('collapses duplicate member keys on one side', () => {
  const duplicate = { declared_type: 'Ns.Type', name: 'Run', cil: 'nop' };
  const left = evidenceRecord(LEFT_ID, { methods: [duplicate, duplicate, { declared_type: 'Ns.Type', name: 'Other', cil: 'nop' }], fields: [] });
  const right = evidenceRecord(RIGHT_ID, { methods: [duplicate], fields: [] });

  const record = compareManagedMemberEvidence(left, right);

  expect(record.summary).toStrictEqual({ unchanged: 1, changed: 0, added: 0, removed: 1, unknown: 0 });
  expect(record.matching.exact_il_signature).toBe(1);
  expect(record.coverage.left_status).toBe('partial');
});

test('falls back to artifact digests for side summaries', () => {
  const left = evidenceRecord(LEFT_ID, { artifact: { sha256: 'cc'.repeat(32) }, module: { mvid: 'fallback-mvid', name: 'Fallback.dll' }, methods: [] });
  const right = evidenceRecord(RIGHT_ID, { classification: { status: 'not-managed' }, coverage: { status: 'partial' }, methods: [{ declared_type: 'Ns.Type', name: 'Run' }] });

  const record = compareManagedMemberEvidence(left, right);

  expect(record.left).toStrictEqual({ evidence_id: LEFT_ID, artifact_sha256: 'cc'.repeat(32), mvid: 'fallback-mvid', module_name: 'Fallback.dll', metadata_status: 'absent', methods_total: 0, fields_total: 0 });
  expect(record.right).toStrictEqual({ evidence_id: RIGHT_ID, artifact_sha256: null, mvid: null, module_name: null, metadata_status: 'absent', methods_total: 1, fields_total: 0 });
  expect(record.coverage).toStrictEqual({ status: 'partial', left_status: 'unavailable', right_status: 'partial' });
  expect(record.summary).toStrictEqual({ unchanged: 0, changed: 0, added: 1, removed: 0, unknown: 0 });
});

test('counts member rows that are not objects as unknown', () => {
  const left = evidenceRecord(LEFT_ID, { methods: [null, 'row', 7], fields: [] });
  const right = evidenceRecord(RIGHT_ID, { methods: [{ name: 'Orphan' }], fields: [] });

  const record = compareManagedMemberEvidence(left, right);

  expect(record.summary).toStrictEqual({ unchanged: 0, changed: 0, added: 0, removed: 0, unknown: 4 });
  expect(record.matching.unmatched).toBe(0);
});

test('marks partial observation limitations when no coverage is recorded', () => {
  const left = evidenceRecord(LEFT_ID, null);
  const right = evidenceRecord(RIGHT_ID, null);

  const record = compareManagedMemberEvidence(left, right);

  expect(record.left).toStrictEqual({ evidence_id: LEFT_ID, artifact_sha256: null, mvid: null, module_name: null, metadata_status: 'absent', methods_total: 0, fields_total: 0 });
  expect(record.right).toStrictEqual({ evidence_id: RIGHT_ID, artifact_sha256: null, mvid: null, module_name: null, metadata_status: 'absent', methods_total: 0, fields_total: 0 });
  expect(record.coverage).toStrictEqual({ status: 'partial', left_status: 'unavailable', right_status: 'unavailable' });
  expect(record.limitations).toHaveLength(7);
  expect(record.limitations[3]).toBe('At least one managed member observation is partial.');
});

test.for([
  { label: 'left', value: null, message: 'compare_managed_members left must be an Evidence object.' },
  { label: 'right', value: [], message: 'compare_managed_members right must be an Evidence object.' },
])('rejects a $label that is not an evidence object', ({ label, value, message }) => {
  const left = label === 'left' ? value : evidenceRecord(LEFT_ID, {});
  const right = label === 'right' ? value : evidenceRecord(RIGHT_ID, {});

  let thrown: unknown;
  try {
    compareManagedMemberEvidence(left, right);
  } catch (error) {
    thrown = error;
  }

  expect((thrown as ReaError).payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message,
    retryable: true,
    remediation: { action: message },
    details: { operation: 'compare_managed_members', parameter: label },
  });
});

test('rejects evidence without a digest-qualified id', () => {
  let thrown: unknown;
  try {
    compareManagedMemberEvidence({ evidence_id: 'left', operation: 'inspect_managed_members' }, evidenceRecord(RIGHT_ID, {}));
  } catch (error) {
    thrown = error;
  }

  expect((thrown as ReaError).payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'compare_managed_members left must carry an evidence_id.',
    retryable: true,
    remediation: { action: 'compare_managed_members left must carry an evidence_id.' },
    details: { operation: 'compare_managed_members', parameter: 'left' },
  });
});

test('rejects evidence from another operation', () => {
  let thrown: unknown;
  try {
    compareManagedMemberEvidence(evidenceRecord(LEFT_ID, {}, 'inspect_managed_artifact'), evidenceRecord(RIGHT_ID, {}));
  } catch (error) {
    thrown = error;
  }

  expect((thrown as ReaError).payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'compare_managed_members left must be inspect_managed_members Evidence.',
    retryable: true,
    remediation: { action: 'compare_managed_members left must be inspect_managed_members Evidence.' },
    details: { operation: 'compare_managed_members', parameter: 'left', observed_operation: 'inspect_managed_artifact' },
  });
});

test('rejects comparing one evidence record with itself', () => {
  let thrown: unknown;
  try {
    compareManagedMemberEvidence(evidenceRecord(LEFT_ID, {}), evidenceRecord(LEFT_ID, {}));
  } catch (error) {
    thrown = error;
  }

  expect((thrown as ReaError).payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'right: Managed member Evidence must be distinct',
    retryable: true,
    remediation: { action: 'right: Managed member Evidence must be distinct' },
    details: { operation: 'compare_managed_members', issues: [{ path: [], reason: 'invalid_value', message: 'right: Managed member Evidence must be distinct' }] },
  });
});

test('inspect_rust_binary records an ELF evidence record', async () => {
  const session = new ReaSession(RUNTIME);
  const targets = await tempTargets();
  const bytes = elfWithSection({ payload: auditableDocument({ packages: [{ name: 'tool-crate', version: '1.4.0' }] }) });
  const path = await targets.write('tool.elf', bytes);
  const result = await inspectRustBinary(session, { path, detail: 'complete' });
  const normalized = normalizedOf(result);

  expect((result.structuredContent as { operation: string }).operation).toBe('inspect_rust_binary');
  expect(normalized['format']).toBe('elf');
  expect(normalized['artifact']).toStrictEqual({ path, sha256: sha256(bytes), bytes: bytes.length });
  expect((normalized['auditable_metadata'] as { packages: { name: string }[] }).packages[0]?.name).toBe('tool-crate');
  expect((result.structuredContent as { parameters: Record<string, unknown> }).parameters).toStrictEqual({ path, detail: 'complete' });
  expect(session.evidence.size).toBe(1);
});

test('inspect_rust_binary rejects an ELF with an architecture parameter', async () => {
  const session = new ReaSession(RUNTIME);
  const targets = await tempTargets();
  const path = await targets.write('tool-elf.bin', elfWithSection());
  const payload = await payloadOf(() => inspectRustBinary(session, { path, architecture: 'x86_64' }));

  expect(payload.details).toStrictEqual({ operation: 'inspect_rust_binary', issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: architecture is only valid for universal Mach-O.` }] });
  expect(session.evidence.size).toBe(0);
});

test('inspect_managed_artifact records a managed evidence record', async () => {
  const session = new ReaSession(RUNTIME);
  const targets = await tempTargets();
  const path = await targets.write('tool.exe', deepPe());
  const result = await inspectManagedArtifact(session, { path, detail: 'summary' });
  const normalized = normalizedOf(result);

  expect((result.structuredContent as { operation: string }).operation).toBe('inspect_managed_artifact');
  expect((normalized['pe'] as { cli: { runtime_version: string } }).cli.runtime_version).toBe('2.5');
  expect((normalized['classification'] as { status: string }).status).toBe('managed');
  expect((result.structuredContent as { parameters: Record<string, unknown> }).parameters).toStrictEqual({ input_path: path, detail: 'summary' });
  expect(session.evidence.size).toBe(1);
});

test('inspect_managed_artifact rejects a relative path', async () => {
  const session = new ReaSession(RUNTIME);
  const payload = await payloadOf(() => inspectManagedArtifact(session, { path: 'relative.exe' }));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'inspect_managed_artifact requires an absolute path or an open PE target.',
    retryable: true,
    remediation: { action: 'inspect_managed_artifact requires an absolute path or an open PE target.' },
    details: { operation: 'inspect_managed_artifact', parameter: 'path' },
  });
  expect(session.evidence.size).toBe(0);
});

test('inspect_managed_members records type name parameters', async () => {
  const session = new ReaSession(RUNTIME);
  const targets = await tempTargets();
  const path = await targets.write('members-tool.exe', deepPe());
  const result = await inspectManagedMembers(session, { path, type_names: ['Ns.Type'] });
  const normalized = normalizedOf(result);

  expect((result.structuredContent as { operation: string }).operation).toBe('inspect_managed_members');
  expect((normalized['coverage'] as { state: string }).state).toBe('partial');
  expect((normalized['module'] as { name: string }).name).toBe('Fixture.dll');
  expect((result.structuredContent as { parameters: Record<string, unknown> }).parameters).toStrictEqual({ input_path: path, type_names: ['Ns.Type'] });
  expect(session.evidence.size).toBe(1);
});

test('inspect_managed_members rejects an empty path', async () => {
  const session = new ReaSession(RUNTIME);
  const payload = await payloadOf(() => inspectManagedMembers(session, { path: '' }));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'inspect_managed_members requires an absolute path or an open PE target.',
    retryable: true,
    remediation: { action: 'inspect_managed_members requires an absolute path or an open PE target.' },
    details: { operation: 'inspect_managed_members', parameter: 'path' },
  });
  expect(session.evidence.size).toBe(0);
});

test('compare_managed_members links two member inventories', async () => {
  const session = new ReaSession(RUNTIME);
  const targets = await tempTargets();
  const leftPath = await targets.write('left.exe', deepPe());
  const rightPath = await targets.write('right.exe', cliPe({ directory: null }));
  const left = await inspectManagedMembers(session, { path: leftPath });
  const right = await inspectManagedMembers(session, { path: rightPath });
  const result = compareManagedMembers(session, { left: left.structuredContent, right: right.structuredContent });
  const normalized = normalizedOf(result);

  expect((result.structuredContent as { operation: string }).operation).toBe('compare_managed_members');
  expect(normalized['left']).toMatchObject({ module_name: 'Fixture.dll', metadata_status: 'absent', methods_total: 0, fields_total: 0 });
  expect(normalized['right']).toMatchObject({ module_name: null, metadata_status: 'absent', methods_total: 0 });
  expect(normalized['summary']).toStrictEqual({ unchanged: 0, changed: 0, added: 0, removed: 0, unknown: 0 });
  expect(normalized['evidence_links']).toStrictEqual([(left.structuredContent as { evidence_id: string }).evidence_id, (right.structuredContent as { evidence_id: string }).evidence_id]);
  expect(session.evidence.size).toBe(3);
});
