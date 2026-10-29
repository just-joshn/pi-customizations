import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { expect, test } from 'vitest';
import { inspectPeCertificatesFromPath } from '../src/analysis/pe-certificates.ts';
import { DEFAULT_MAX_FILE_BYTES, DOS_MAGIC, formatVa, mapRva, type PeSection, parsePeImage, peInputError, readCString, resolvePathBytes, sectionForRva, vaToRva } from '../src/analysis/pe-core.ts';
import { inspectPeImportsFromPath, peImportsArchitecture } from '../src/analysis/pe-imports.ts';
import { inspectPeLoadConfigFromPath, peLoadConfigArchitecture } from '../src/analysis/pe-load-config.ts';
import { inspectPeResourcesFromPath, mapRva as mapResourceRva, parsePe as parseResourcePe } from '../src/analysis/pe-resources.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectPeImports } from '../src/tools/pe-tools.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

const PE_OFFSET = 0x40;
const OPTIONAL_START = PE_OFFSET + 24;
const SECTION: SectionSpec = { name: '.data', virtualAddress: 0x1000, rawOffset: 0x200, rawSize: 0x400 };
const IMAGE_BASE = 0x140000000n;
const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

interface SectionSpec {
  readonly name?: string;
  readonly virtualAddress: number;
  readonly virtualSize?: number;
  readonly rawOffset: number;
  readonly rawSize: number;
}

interface DirectorySpec {
  readonly index: number;
  readonly rva: number;
  readonly size: number;
}

interface PeSpec {
  readonly bits?: 32 | 64;
  readonly machine?: number;
  readonly imageBase?: bigint;
  readonly magic?: number;
  readonly dosMagic?: number;
  readonly signature?: string;
  readonly peOffset?: number;
  readonly optionalSize?: number;
  readonly sectionCount?: number;
  readonly directoryCount?: number;
  readonly directories?: readonly DirectorySpec[];
  readonly sections?: readonly SectionSpec[];
  readonly length?: number;
}

const u16 = (bytes: Buffer, offset: number, value: number): void => {
  bytes.writeUInt16LE(value, offset);
};

const u32 = (bytes: Buffer, offset: number, value: number): void => {
  bytes.writeUInt32LE(value, offset);
};

const u64 = (bytes: Buffer, offset: number, value: bigint): void => {
  bytes.writeBigUInt64LE(value, offset);
};

const buildPe = (spec: PeSpec = {}): Buffer => {
  const bits = spec.bits ?? 64;
  const magic = spec.magic ?? (bits === 64 ? 0x20b : 0x10b);
  const optionalSize = spec.optionalSize ?? (bits === 64 ? 240 : 224);
  const peOffset = spec.peOffset ?? PE_OFFSET;
  const optionalStart = peOffset + 24;
  const sections = spec.sections ?? [];
  const sectionTable = optionalStart + optionalSize;
  const length = spec.length ?? Math.max(0x40, sectionTable + sections.length * 40);
  const bytes = Buffer.alloc(length);
  const fits = (offset: number, size: number): boolean => offset + size <= length;
  if (fits(0, 2)) u16(bytes, 0, spec.dosMagic ?? DOS_MAGIC);
  if (fits(0x3c, 4)) u32(bytes, 0x3c, peOffset);
  if (fits(peOffset, 24)) {
    bytes.write(spec.signature ?? 'PE\0\0', peOffset, 'latin1');
    u16(bytes, peOffset + 4, spec.machine ?? (bits === 64 ? 34404 : 332));
    u16(bytes, peOffset + 6, spec.sectionCount ?? sections.length);
    u16(bytes, peOffset + 20, optionalSize);
  }
  if (fits(optionalStart, 2)) u16(bytes, optionalStart, magic);
  if (bits === 64 ? fits(optionalStart + 24, 8) : fits(optionalStart + 28, 4)) {
    if (bits === 64) u64(bytes, optionalStart + 24, spec.imageBase ?? IMAGE_BASE);
    else u32(bytes, optionalStart + 28, Number(spec.imageBase ?? 0x400000n));
  }
  const directoryCountOffset = bits === 64 ? 108 : 92;
  const directoriesOffset = bits === 64 ? 112 : 96;
  if (fits(optionalStart + directoryCountOffset, 4)) u32(bytes, optionalStart + directoryCountOffset, spec.directoryCount ?? 16);
  for (const directory of spec.directories ?? []) {
    const entryOffset = optionalStart + directoriesOffset + directory.index * 8;
    if (!fits(entryOffset, 8)) continue;
    u32(bytes, entryOffset, directory.rva);
    u32(bytes, entryOffset + 4, directory.size);
  }
  sections.forEach((section, index) => {
    const at = sectionTable + index * 40;
    if (!fits(at, 40)) return;
    bytes.write(section.name ?? '.data', at, 'latin1');
    u32(bytes, at + 8, section.virtualSize ?? section.rawSize);
    u32(bytes, at + 12, section.virtualAddress);
    u32(bytes, at + 16, section.rawSize);
    u32(bytes, at + 20, section.rawOffset);
  });
  return bytes;
};

const sectionImage = (directories: readonly DirectorySpec[], options: { readonly length?: number; readonly sections?: readonly SectionSpec[]; readonly bits?: 32 | 64; readonly machine?: number; readonly imageBase?: bigint } = {}): Buffer =>
  buildPe({
    directories,
    sections: options.sections ?? [SECTION],
    length: options.length ?? 0x600,
    ...(options.bits === undefined ? {} : { bits: options.bits }),
    ...(options.machine === undefined ? {} : { machine: options.machine }),
    ...(options.imageBase === undefined ? {} : { imageBase: options.imageBase }),
  });

const withFile = async (bytes: Buffer, name = 'image.exe'): Promise<string> => {
  const targets = await tempTargets();
  return targets.write(name, bytes);
};

const payloadOf = async (run: () => Promise<unknown>): Promise<ReaError['payload']> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the analyzer returned instead of throwing');
};

const messageOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the analyzer returned instead of throwing');
};

const issueMessage = (payload: ReaError['payload']): string => {
  const issues = payload.details?.['issues'];
  if (!Array.isArray(issues)) throw new Error('payload carries no issues');
  const [first] = issues as { message?: string }[];
  return first?.message ?? '';
};

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const inputDetails = (operation: string, path: string, reason: string, detail: string): Record<string, unknown> => ({
  operation,
  issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
});

test('parses a PE32+ header into an exact image model', () => {
  const bytes = buildPe({
    directories: [
      { index: 0, rva: 0, size: 0 },
      { index: 1, rva: 0x2000, size: 40 },
    ],
    sections: [{ name: '.rdata', virtualAddress: 0x2000, rawOffset: 0x200, rawSize: 0x200 }],
    length: 0x400,
  });

  expect(parsePeImage(bytes)).toStrictEqual({
    format: 'pe32-plus',
    machine: 34404,
    bits: 64,
    architecture: 'x86_64',
    imageBase: IMAGE_BASE,
    sections: [{ name: '.rdata', virtualAddress: 0x2000, virtualSize: 0x200, rawOffset: 0x200, rawSize: 0x200 }],
    directories: { 1: { rva: 0x2000, size: 40, entryOffset: OPTIONAL_START + 120 } },
    peOffset: PE_OFFSET,
    optionalStart: OPTIONAL_START,
  });
});

test('parses a PE32 header through the 32-bit directory table', () => {
  const bytes = buildPe({
    bits: 32,
    machine: 448,
    imageBase: 0x400000n,
    directories: [{ index: 2, rva: 0x1000, size: 0x10 }],
    sections: [{ name: '.rsrc', virtualAddress: 0x1000, rawOffset: 0x200, rawSize: 0x100 }],
    length: 0x300,
  });

  const image = parsePeImage(bytes);
  expect(image).toMatchObject({ format: 'pe32', bits: 32, architecture: 'arm', imageBase: 0x400000n });
  expect(image.directories).toStrictEqual({ 2: { rva: 0x1000, size: 0x10, entryOffset: OPTIONAL_START + 112 } });
});

test.for([
  { name: 'a short buffer', bytes: Buffer.alloc(32), message: 'not an MZ image' },
  { name: 'a foreign DOS magic', bytes: buildPe({ length: 0x40, dosMagic: 0x1234 }), message: 'not an MZ image' },
  { name: 'no PE signature', bytes: buildPe({ signature: 'PX\0\0' }), message: 'no PE signature' },
  { name: 'a PE offset past the end', bytes: buildPe({ peOffset: 0x800, length: 0x100 }), message: 'no PE signature' },
  { name: 'a truncated optional header', bytes: buildPe({ length: OPTIONAL_START + 100 }), message: 'truncated optional header' },
  { name: 'an unknown optional magic', bytes: buildPe({ magic: 0x107 }), message: 'unsupported optional header magic' },
  { name: 'a truncated directory count', bytes: buildPe({ optionalSize: 110, length: OPTIONAL_START + 110 }), message: 'truncated data directories' },
])('rejects $name', ({ bytes, message }) => {
  expect(messageOf(() => parsePeImage(bytes))).toBe(message);
});

test('stops the data directory walk at the optional header end', () => {
  const bytes = buildPe({
    optionalSize: 128,
    length: OPTIONAL_START + 168,
    directories: [
      { index: 0, rva: 1, size: 1 },
      { index: 1, rva: 2, size: 2 },
    ],
  });

  expect(parsePeImage(bytes).directories).toStrictEqual({
    0: { rva: 1, size: 1, entryOffset: OPTIONAL_START + 112 },
    1: { rva: 2, size: 2, entryOffset: OPTIONAL_START + 120 },
  });
});

test('stops the section table at the end of the file', () => {
  const bytes = buildPe({
    sectionCount: 4,
    length: OPTIONAL_START + 240 + 40,
    sections: [
      { name: '.textbss', virtualAddress: 0x1000, rawOffset: 0x200, rawSize: 0x100 },
      { virtualAddress: 0x2000, rawOffset: 0x300, rawSize: 0x100 },
    ],
  });

  expect(parsePeImage(bytes).sections).toStrictEqual([{ name: '.textbss', virtualAddress: 0x1000, virtualSize: 0x100, rawOffset: 0x200, rawSize: 0x100 }]);
});

test('maps an RVA only through exactly one readable section', () => {
  const text: PeSection = { name: '.text', virtualAddress: 0x1000, virtualSize: 0x400, rawOffset: 0x200, rawSize: 0x200 };

  expect(mapRva([text], 0x1000)).toBe(0x200);
  expect(mapRva([text], 0x1200)).toBeUndefined();
  expect(mapRva([text], 0x9000)).toBeUndefined();
  expect(mapRva([text, { ...text, name: '.alias' }], 0x1000)).toBeUndefined();
});

test('selects the single section that covers an RVA', () => {
  const text: PeSection = { name: '.text', virtualAddress: 0x1000, virtualSize: 0x400, rawOffset: 0x200, rawSize: 0x200 };

  expect(sectionForRva([text], 0x1200)?.name).toBe('.text');
  expect(sectionForRva([text], 0x9000)).toBeUndefined();
  expect(sectionForRva([text, { ...text, name: '.alias' }], 0x1000)).toBeUndefined();
});

test('reads C strings within the requested limit', () => {
  const bytes = Buffer.from('alpha\0beta', 'latin1');

  expect(readCString(bytes, 0)).toBe('alpha');
  expect(readCString(bytes, 3)).toBe('ha');
  expect(readCString(bytes, 6)).toBe('beta');
  expect(readCString(bytes, 0, 3)).toBe('alp');
  expect(readCString(bytes, -1)).toBeNull();
  expect(readCString(bytes, 10)).toBeNull();
});

test('converts a virtual address only above the image base', () => {
  expect(vaToRva(IMAGE_BASE, IMAGE_BASE + 0x1000n)).toBe(0x1000);
  expect(vaToRva(IMAGE_BASE, 0x1000n)).toBeNull();
  expect(vaToRva(0n, BigInt(Number.MAX_SAFE_INTEGER) + 2n)).toBeNull();
  expect(formatVa(0x1fn)).toBe('0x1f');
});

test('builds the shared input error payload', () => {
  expect(peInputError('inspect_pe_imports', 'x.exe', 'invalid_value', 'bad input').payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The inspection input is not usable. Check the argument and retry.',
    retryable: true,
    remediation: { action: 'The inspection input is not usable. Check the argument and retry.' },
    details: inputDetails('inspect_pe_imports', 'x.exe', 'invalid_value', 'bad input'),
  });
});

test('reads a file through an absolute path', async () => {
  const targets = await tempTargets();
  const path = await targets.write('image.bin', Buffer.alloc(200, 7));

  const result = await resolvePathBytes(path, { operation: 'inspect_pe_imports' });
  expect(result.path).toBe(path);
  expect(result.resolvedPath).toBe(path);
  expect(result.bytes.equals(Buffer.alloc(200, 7))).toBe(true);
});

test('resolves a relative path against the supplied directory', async () => {
  const targets = await tempTargets();
  await targets.write('image.bin', 'bytes');

  const result = await resolvePathBytes('image.bin', { cwd: targets.dir, operation: 'inspect_pe_imports' });
  expect(result.resolvedPath).toBe(join(targets.dir, 'image.bin'));
  expect(result.bytes.toString('utf8')).toBe('bytes');
});

test('resolves a relative path against the working directory', async () => {
  const result = await resolvePathBytes('package.json', { operation: 'inspect_pe_imports' });

  expect(isAbsolute(result.resolvedPath)).toBe(true);
  expect(result.resolvedPath.endsWith('/package.json')).toBe(true);
  expect(result.bytes.equals(readFileSync(result.resolvedPath))).toBe(true);
});

test.for([63, 536_870_913, 1.5])('rejects max_file_bytes %s', async (value) => {
  const payload = await payloadOf(() => resolvePathBytes('x.exe', { maxFileBytes: value, operation: 'inspect_pe_imports' }));

  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_imports', 'x.exe', 'invalid_value', 'max_file_bytes must be an integer between 64 and 536870912.'));
});

test('reports a missing file as unusable input', async () => {
  const targets = await tempTargets();
  const missing = join(targets.dir, 'absent.exe');

  const payload = await payloadOf(() => resolvePathBytes(missing, { operation: 'inspect_pe_imports' }));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_imports', missing, 'invalid_value', 'no file exists there'));
});

test('reports an unreadable path as unusable input', async () => {
  const targets = await tempTargets();

  const payload = await payloadOf(() => resolvePathBytes(targets.dir, { operation: 'inspect_pe_imports' }));
  expect(payload.code).toBe('invalid_request');
  expect(issueMessage(payload)).toMatch(/^Cannot inspect .*: it could not be read \(/);
});

test('rejects an image above the byte limit', async () => {
  const targets = await tempTargets();
  const path = await targets.write('big.bin', Buffer.alloc(300));

  const payload = await payloadOf(() => resolvePathBytes(path, { maxFileBytes: 128, operation: 'inspect_pe_imports' }));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_imports', path, 'invalid_value', 'the image is 300 bytes, more than the 128 byte limit'));
});

interface ImportLayout {
  readonly bits?: 32 | 64;
  readonly machine?: number;
  readonly thunk: bigint;
  readonly originalFirstThunk?: number;
  readonly iatRva?: number;
  readonly dllNameRva?: number;
}

const importImage = (layout: ImportLayout): Buffer => {
  const bits = layout.bits ?? 64;
  const bytes = sectionImage([{ index: 1, rva: 0x1000, size: 40 }], {
    ...(bits === 32 ? { bits, machine: layout.machine ?? 332 } : { machine: layout.machine ?? 34404 }),
  });
  const writeThunk = (offset: number, value: bigint): void => {
    if (bits === 64) u64(bytes, offset, value);
    else u32(bytes, offset, Number(value));
  };
  u32(bytes, 0x200, layout.originalFirstThunk ?? 0x1040);
  u32(bytes, 0x20c, layout.dllNameRva ?? 0x1080);
  u32(bytes, 0x210, layout.iatRva ?? 0x1060);
  writeThunk(0x240, layout.thunk);
  writeThunk(0x240 + (bits === 64 ? 8 : 4), 0n);
  writeThunk(0x260, layout.thunk);
  writeThunk(0x260 + (bits === 64 ? 8 : 4), 0n);
  bytes.write('KERNEL32.dll\0', 0x280, 'latin1');
  u16(bytes, 0x2a0, 7);
  bytes.write('CreateFileW\0', 0x2a2, 'latin1');
  return bytes;
};

test('inventories a named import with its imphash', async () => {
  const bytes = importImage({ thunk: 0x10a0n });
  const path = await withFile(bytes);

  const { record, resolvedPath } = await inspectPeImportsFromPath(path);
  expect(resolvedPath).toBe(path);
  expect(record.artifact).toStrictEqual({ path, sha256: sha256(bytes), bytes: bytes.length });
  expect(record).toMatchObject({ format: 'pe32-plus', machine: 34404, bits: 64, architecture: 'amd64' });
  expect(record.import_directory).toStrictEqual({ rva: 0x1000, size: 40, locations: [{ offset: 0x200, bytes: 40 }] });
  expect(record.delay_import_directory).toBeNull();
  expect(record.imports).toStrictEqual([
    {
      index: 0,
      name: 'KERNEL32.dll',
      name_rva: 0x1080,
      original_first_thunk_rva: 0x1040,
      first_thunk_rva: 0x1060,
      time_date_stamp: 0,
      forwarder_chain: 0,
      location: { offset: 0x200, bytes: 20 },
      functions: [{ hint: 7, name: 'CreateFileW', ordinal: null, ilt_rva: 0x1040, iat_rva: 0x1060, thunk_hex: '10a0' }],
    },
  ]);
  expect(record.imphash).toStrictEqual({ algorithm: 'pefile', md5: '4fe4cbe3f1eef29244a0a0b01016c849', reason: null });
  expect(record.coverage).toStrictEqual({ status: 'complete', reason: null, examined_dlls: 1, imports: 1, delay_imports: 0 });
  expect(record.issues).toStrictEqual([]);
  expect(record.limitations).toHaveLength(2);
});

test('reads thunks from the IAT when the original thunk is absent', async () => {
  const bytes = importImage({ thunk: 0x10a0n, originalFirstThunk: 0 });
  u64(bytes, 0x260, 0x10b0n);
  u16(bytes, 0x2b0, 9);
  bytes.write('DeleteFileW\0', 0x2b2, 'latin1');
  const path = await withFile(bytes);

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.imports[0]?.original_first_thunk_rva).toBe(0);
  expect(record.imports[0]?.functions[0]).toStrictEqual({ hint: 9, name: 'DeleteFileW', ordinal: null, ilt_rva: null, iat_rva: 0x1060, thunk_hex: '10b0' });
  expect(record.imphash.md5).toBe('5e58d0c080fff3efd1b29d3331696cd7');
});

test('reads a 32-bit ordinal import as an ordinal', async () => {
  const path = await withFile(importImage({ bits: 32, thunk: 0x80000005n }));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record).toMatchObject({ format: 'pe32', bits: 32, machine: 332, architecture: '386' });
  expect(record.imports[0]?.functions[0]).toStrictEqual({ hint: null, name: null, ordinal: 5, ilt_rva: 0x1040, iat_rva: 0x1060, thunk_hex: '80000005' });
  expect(record.imphash).toStrictEqual({ algorithm: 'pefile', md5: '9955267f0bde481657b972168f4c3161', reason: null });
});

test('reads a named import from a 32-bit image', async () => {
  const path = await withFile(importImage({ bits: 32, thunk: 0x10a0n }));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.imports[0]?.functions[0]).toStrictEqual({ hint: 7, name: 'CreateFileW', ordinal: null, ilt_rva: 0x1040, iat_rva: 0x1060, thunk_hex: '10a0' });
  expect(record.bits).toBe(32);
});

test.for([
  { name: 'an x86_64 image', machine: 34404, expected: 'amd64' },
  { name: 'an x86 image', machine: 332, expected: '386' },
  { name: 'an arm64 image', machine: 43620, expected: 'arm64' },
  { name: 'an unknown machine', machine: 9999, expected: 'unknown' },
])('maps $name to its analysis architecture', ({ machine, expected }) => {
  const image = parsePeImage(importImage({ machine, thunk: 0x10a0n }));

  expect(peImportsArchitecture(image.architecture)).toBe(expected);
  expect(peLoadConfigArchitecture(image.architecture)).toBe(expected);
});

test('records an unreadable DLL name without an imphash', async () => {
  const path = await withFile(importImage({ thunk: 0x10a0n, dllNameRva: 0x9000 }));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.imports[0]?.name).toBeNull();
  expect(record.issues).toStrictEqual([{ code: 'name_unreadable', location: '0x9000', message: 'Import descriptor DLL name: Virtual address or string range is not file mapped' }]);
  expect(record.imphash).toStrictEqual({ algorithm: 'pefile', md5: null, reason: "The standard import table is incomplete (1 issue(s)); a hash of the retained rows would not be this image's import hash." });
  expect(record.coverage).toStrictEqual({ status: 'partial', reason: '1 import table issue(s) affect reported rows or metadata; see issues', examined_dlls: 1, imports: 1, delay_imports: 0 });
});

test('drops an import whose name is unreadable', async () => {
  const path = await withFile(importImage({ thunk: 0x9000n }));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.imports[0]?.functions).toStrictEqual([]);
  expect(record.issues).toStrictEqual([{ code: 'name_unreadable', location: '0x9000', message: 'Virtual address or string range is not file mapped' }]);
  expect(record.coverage.status).toBe('partial');
  expect(record.imphash.reason).toBe("The standard import table is incomplete (1 issue(s)); a hash of the retained rows would not be this image's import hash.");
});

test('drops an import name past the file end and marks coverage partial', async () => {
  const bytes = importImage({ thunk: 0x13fen }).subarray(0, 0x5ff);
  const path = await withFile(Buffer.from(bytes));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.imports[0]?.functions).toStrictEqual([]);
  expect(record.issues).toStrictEqual([{ code: 'name_unreadable', location: '0x13fe', message: 'Virtual address or string range is not file mapped' }]);
  expect(record.coverage).toStrictEqual({ status: 'partial', reason: '1 import table issue(s) affect reported rows or metadata; see issues', examined_dlls: 1, imports: 0, delay_imports: 0 });
});

test('drops an import name RVA that is not file mapped at the file end', async () => {
  const bytes = importImage({ thunk: 0x13fen, iatRva: 0x13fe }).subarray(0, 0x5ff);
  const path = await withFile(Buffer.from(bytes));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.imports[0]?.functions).toStrictEqual([]);
  expect(record.issues).toStrictEqual([{ code: 'name_unreadable', location: '0x13fe', message: 'Virtual address or string range is not file mapped' }]);
  expect(record.coverage).toStrictEqual({ status: 'partial', reason: '1 import table issue(s) affect reported rows or metadata; see issues', examined_dlls: 1, imports: 0, delay_imports: 0 });
});

test('refuses an import table above the function budget', async () => {
  const bytes = importImage({ thunk: 0x10a0n });
  u64(bytes, 0x248, 0x10a0n);
  u64(bytes, 0x268, 0x10a0n);
  const path = await withFile(bytes);

  const payload = await payloadOf(() => inspectPeImportsFromPath(path, { maxFunctions: 1 }));
  expect(payload).toMatchObject({ code: 'resource_constraint', category: 'resource_constraint', retryable: false });
  expect(payload.details).toMatchObject({ operation: 'inspect_pe_imports', resource: 'capacity', reported_limits: { boundary: 'structure', maximum: 1, limit: 'functions' } });
  expect(payload.details?.['reason']).toMatch(/: Import inventory declares 2 functions, above the 1-entry function allowance$/);
  expect(payload.remediation.action).toBe('Raise max_functions above 1 or select a smaller artifact; the limit is the caller-selected function budget.');
});

test('records a delay-import directory that maps to no section', async () => {
  const path = await withFile(sectionImage([{ index: 13, rva: 0x9000, size: 64 }]));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.delay_import_directory).toStrictEqual({ rva: 0x9000, size: 64, locations: [] });
  expect(record.issues).toStrictEqual([{ code: 'descriptor_unreadable', location: '0x9000', message: 'Import descriptor: Virtual address or string range is not file mapped' }]);
  expect(record.coverage.status).toBe('partial');
});

test('records a delay import with an unreadable DLL name', async () => {
  const bytes = sectionImage([{ index: 13, rva: 0x1000, size: 64 }]);
  u32(bytes, 0x200, 1);
  u32(bytes, 0x204, 0x9000);
  u32(bytes, 0x20c, 0x1060);
  u32(bytes, 0x210, 0x1040);
  u64(bytes, 0x240, 0x10a0n);
  u64(bytes, 0x248, 0n);
  u64(bytes, 0x260, 0x10a0n);
  u64(bytes, 0x268, 0n);
  bytes.write('USER32.dll\0', 0x280, 'latin1');
  u16(bytes, 0x2a0, 3);
  bytes.write('MessageBoxW\0', 0x2a2, 'latin1');
  const path = await withFile(bytes);

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.delay_imports[0]?.name).toBeNull();
  expect(record.delay_imports[0]?.functions[0]?.name).toBe('MessageBoxW');
  expect(record.coverage.status).toBe('partial');
  expect(record.imphash.reason).toBe("The standard import table is incomplete (1 issue(s)); a hash of the retained rows would not be this image's import hash.");
});

test('resolves an imports path against the supplied directory', async () => {
  const targets = await tempTargets();
  await targets.write('image.exe', importImage({ thunk: 0x10a0n }));

  const { resolvedPath } = await inspectPeImportsFromPath('image.exe', { cwd: targets.dir });
  expect(resolvedPath).toBe(join(targets.dir, 'image.exe'));
});

test('inventories delay imports with their descriptors', async () => {
  const bytes = sectionImage([{ index: 13, rva: 0x1000, size: 64 }]);
  u32(bytes, 0x200, 1);
  u32(bytes, 0x204, 0x1080);
  u32(bytes, 0x20c, 0x1060);
  u32(bytes, 0x210, 0x1040);
  u64(bytes, 0x240, 0x10a0n);
  u64(bytes, 0x248, 0n);
  u64(bytes, 0x260, 0x10a0n);
  u64(bytes, 0x268, 0n);
  bytes.write('USER32.dll\0', 0x280, 'latin1');
  u16(bytes, 0x2a0, 3);
  bytes.write('MessageBoxW\0', 0x2a2, 'latin1');
  const path = await withFile(bytes);

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.import_directory).toBeNull();
  expect(record.delay_import_directory).toStrictEqual({ rva: 0x1000, size: 64, locations: [{ offset: 0x200, bytes: 64 }] });
  expect(record.delay_imports).toStrictEqual([
    {
      index: 0,
      name: 'USER32.dll',
      name_rva: 0x1080,
      attributes: 1,
      import_address_table_rva: 0x1060,
      import_name_table_rva: 0x1040,
      bound_import_rva: 0,
      unload_information_table_rva: 0,
      module_handle_rva: 0,
      time_date_stamp: 0,
      location: { offset: 0x200, bytes: 32 },
      functions: [{ hint: 3, name: 'MessageBoxW', ordinal: null, ilt_rva: 0x1040, iat_rva: 0x1060, thunk_hex: '10a0' }],
    },
  ]);
  expect(record.imphash).toStrictEqual({ algorithm: 'pefile', md5: 'd41d8cd98f00b204e9800998ecf8427e', reason: null });
  expect(record.coverage).toStrictEqual({ status: 'complete', reason: null, examined_dlls: 1, imports: 0, delay_imports: 1 });
});

test('records an import descriptor past the end of the file', async () => {
  const path = await withFile(sectionImage([{ index: 1, rva: 0x13f0, size: 40 }]));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.imports).toStrictEqual([]);
  expect(record.issues).toStrictEqual([{ code: 'descriptor_unreadable', location: '0x13f0', message: 'Import descriptor: Virtual address or string range is not file mapped' }]);
  expect(record.coverage.status).toBe('partial');
});

test('records a truncated delay-import descriptor', async () => {
  const path = await withFile(sectionImage([{ index: 13, rva: 0x13f0, size: 32 }]));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.delay_imports).toStrictEqual([]);
  expect(record.issues).toStrictEqual([{ code: 'descriptor_unreadable', location: '0x13f0', message: 'Import descriptor: Virtual address or string range is not file mapped' }]);
  expect(record.coverage.status).toBe('partial');
});

test('records an import directory that maps to no section', async () => {
  const path = await withFile(sectionImage([{ index: 1, rva: 0x9000, size: 40 }]));

  const { record } = await inspectPeImportsFromPath(path);
  expect(record.import_directory).toStrictEqual({ rva: 0x9000, size: 40, locations: [] });
  expect(record.issues).toStrictEqual([{ code: 'descriptor_unreadable', location: '0x9000', message: 'Import descriptor: Virtual address or string range is not file mapped' }]);
  expect(record.coverage.status).toBe('partial');
});

test('refuses DLL descriptors past the max_dlls budget', async () => {
  const bytes = importImage({ thunk: 0x10a0n });
  bytes.copy(bytes, 0x214, 0x200, 0x214);
  const path = await withFile(bytes);

  const payload = await payloadOf(() => inspectPeImportsFromPath(path, { maxDlls: 1 }));
  expect(payload).toMatchObject({ code: 'resource_constraint', category: 'resource_constraint', retryable: false });
  expect(payload.details).toMatchObject({ operation: 'inspect_pe_imports', resource: 'capacity', reported_limits: { boundary: 'structure', maximum: 1, limit: 'dlls' } });
  expect(payload.details?.['reason']).toMatch(/: Import inventory declares 2 descriptors, above the 1-entry DLL allowance$/);
  expect(payload.remediation.action).toBe('Raise max_dlls above 1 or select a smaller artifact; the limit is the caller-selected DLL budget.');
});

test.for([
  { name: 'max_dlls below the floor', options: { maxDlls: 0 }, detail: 'max_dlls must be an integer between 1 and 4096.' },
  { name: 'max_dlls above the ceiling', options: { maxDlls: 4097 }, detail: 'max_dlls must be an integer between 1 and 4096.' },
  { name: 'a fractional max_dlls', options: { maxDlls: 1.5 }, detail: 'max_dlls must be an integer between 1 and 4096.' },
  { name: 'max_functions above the ceiling', options: { maxFunctions: 262_145 }, detail: 'max_functions must be an integer between 1 and 262144.' },
])('rejects $name', async ({ options, detail }) => {
  const payload = await payloadOf(() => inspectPeImportsFromPath('x.exe', options));

  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_imports', 'x.exe', 'invalid_value', detail));
});

test('rejects a non-PE image for imports', async () => {
  const path = await withFile(Buffer.from([0x4d, 0x5a, 0x00, 0x00]));

  const payload = await payloadOf(() => inspectPeImportsFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_imports', path, 'invalid_format', 'the file is not an MZ PE image.'));
});

test('reports an empty path as unreadable input', async () => {
  const payload = await payloadOf(() => inspectPeImportsFromPath(''));

  expect(payload.details?.['operation']).toBe('inspect_pe_imports');
  expect(issueMessage(payload)).toMatch(/^Cannot inspect : it could not be read \(/);
});

test('rejects an imports image above the byte limit', async () => {
  const path = await withFile(importImage({ thunk: 0x10a0n }));

  const payload = await payloadOf(() => inspectPeImportsFromPath(path, { maxFileBytes: 100 }));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_imports', path, 'invalid_value', 'the image is 1536 bytes, more than the 100 byte limit'));
});

const refAt = (rva: number): Record<string, unknown> => ({
  va: `0x${(IMAGE_BASE + BigInt(rva)).toString(16)}`,
  rva,
  file_offset: 0x200 + (rva - 0x1000),
  section: '.data',
});

const loadConfigImage = (): Buffer => {
  const bytes = sectionImage([
    { index: 9, rva: 0x1000, size: 40 },
    { index: 10, rva: 0x1100, size: 244 },
  ]);
  u64(bytes, 0x200, IMAGE_BASE + 0x1220n);
  u64(bytes, 0x208, IMAGE_BASE + 0x1230n);
  u64(bytes, 0x210, IMAGE_BASE + 0x1240n);
  u64(bytes, 0x218, IMAGE_BASE + 0x1260n);
  u32(bytes, 0x220, 0);
  u32(bytes, 0x224, 0x400000);
  u64(bytes, 0x460, IMAGE_BASE + 0x12a0n);
  u64(bytes, 0x468, IMAGE_BASE + 0x12b0n);
  u64(bytes, 0x470, 0n);
  u32(bytes, 0x300, 244);
  u64(bytes, 0x358, IMAGE_BASE + 0x1300n);
  u64(bytes, 0x360, IMAGE_BASE + 0x1310n);
  u32(bytes, 0x368, 2);
  u64(bytes, 0x370, IMAGE_BASE + 0x1320n);
  u64(bytes, 0x378, IMAGE_BASE + 0x1330n);
  u64(bytes, 0x380, IMAGE_BASE + 0x1340n);
  u32(bytes, 0x388, 3);
  u32(bytes, 0x390, 0x33d30700);
  u64(bytes, 0x3a4, IMAGE_BASE + 0x1350n);
  u64(bytes, 0x3ac, 4n);
  u64(bytes, 0x3b4, IMAGE_BASE + 0x1360n);
  u64(bytes, 0x3bc, 5n);
  u64(bytes, 0x3c4, IMAGE_BASE + 0x1370n);
  u64(bytes, 0x3cc, IMAGE_BASE + 0x1380n);
  u32(bytes, 0x3d4, 6);
  u32(bytes, 0x3d8, 7);
  u64(bytes, 0x3dc, IMAGE_BASE + 0x1390n);
  u64(bytes, 0x3e4, 8n);
  u64(bytes, 0x3ec, IMAGE_BASE + 0x13a0n);
  return bytes;
};

test('reads TLS callbacks from a PE32+ load config', async () => {
  const path = await withFile(loadConfigImage());

  const { record } = await inspectPeLoadConfigFromPath(path);
  expect(record.tls).toStrictEqual({
    directory: { rva: 0x1000, size: 40, file_offset: 0x200 },
    start_address_of_raw_data: '0x140001220',
    end_address_of_raw_data: '0x140001230',
    raw_data_size: 16,
    raw_data_file_offset: 0x420,
    raw_data_section: '.data',
    address_of_index: refAt(0x1240),
    address_of_callbacks: '0x140001260',
    size_of_zero_fill: 0,
    characteristics: 0x400000,
    alignment: null,
    callbacks: [refAt(0x12a0), refAt(0x12b0)],
    callback_array_locations: [
      { offset: 0x460, bytes: 8 },
      { offset: 0x468, bytes: 8 },
      { offset: 0x470, bytes: 8 },
    ],
  });
  expect(record.examined_callbacks).toBe(2);

  const config = record.load_config;
  expect(config?.directory).toStrictEqual({ rva: 0x1100, size: 244, file_offset: 0x300 });
  expect(config?.structure_location).toStrictEqual({ offset: 0x300, bytes: 244 });
  expect(config?.security_cookie).toStrictEqual(refAt(0x1300));
  expect(config?.se_handler_table).toBeNull();
  expect(config?.se_handler_count).toBeNull();
  expect(config?.guard_cf_check_function_pointer).toStrictEqual(refAt(0x1320));
  expect(config?.guard_cf_function_count).toBe(3);
  expect(config?.guard_flags).toStrictEqual({
    raw: 0x33d30700,
    flags: [
      'IMAGE_GUARD_CF_INSTRUMENTED',
      'IMAGE_GUARD_CFW_INSTRUMENTED',
      'IMAGE_GUARD_CF_FUNCTION_TABLE_PRESENT',
      'IMAGE_GUARD_CF_LONGJUMP_TABLE_PRESENT',
      'IMAGE_GUARD_RF_INSTRUMENTED',
      'IMAGE_GUARD_RETPOLINE_PRESENT',
      'IMAGE_GUARD_EH_CONTINUATION_TABLE_PRESENT',
      'IMAGE_GUARD_XFG_ENABLED',
      'IMAGE_GUARD_CASTGUARD_PRESENT',
      'IMAGE_GUARD_MEMCPY_PRESENT',
    ],
    unrecognized: 0,
    cf_function_table_stride: 3,
  });
  expect(config?.guard_address_taken_iat_entry_count).toBe(4);
  expect(config?.guard_long_jump_target_count).toBe(5);
  expect(config?.dynamic_value_reloc_table).toBe('0x140001370');
  expect(config?.chpe_metadata_pointer).toBe('0x140001380');
  expect(config?.dynamic_value_reloc_table_offset).toBe(6);
  expect(config?.dynamic_value_reloc_table_section).toBe(7);
  expect(config?.guard_eh_continuation_count).toBe(8);
  expect(config?.guard_xfg_check_function_pointer).toStrictEqual(refAt(0x13a0));
  expect(config?.inferences.map((entry) => entry.id)).toStrictEqual(['cfg_instrumented', 'cf_write_instrumented', 'rf_instrumented', 'retpoline_present', 'xfg_enabled', 'castguard_present']);
  expect(record).toMatchObject({ format: 'pe32-plus', bits: 64, machine: 34404, architecture: 'amd64' });
});

test('reads a PE32 load config through the 32-bit field offsets', async () => {
  const bytes = sectionImage([{ index: 10, rva: 0x1100, size: 152 }], { bits: 32, machine: 332, imageBase: 0x400000n });
  u32(bytes, 0x300, 152);
  u32(bytes, 0x33c, 0x401200);
  u32(bytes, 0x340, 0x401210);
  u32(bytes, 0x344, 9);
  u32(bytes, 0x348, 0x401220);
  u32(bytes, 0x34c, 0x401230);
  u32(bytes, 0x350, 0x401240);
  u32(bytes, 0x354, 2);
  u32(bytes, 0x358, 0);
  u32(bytes, 0x36c, 0x401250);
  u32(bytes, 0x370, 11);
  u32(bytes, 0x374, 0x401260);
  u32(bytes, 0x378, 12);
  u32(bytes, 0x37c, 0x401270);
  u32(bytes, 0x380, 0x401280);
  u32(bytes, 0x384, 13);
  u32(bytes, 0x388, 14);
  u32(bytes, 0x38c, 0x401290);
  u32(bytes, 0x390, 15);
  u32(bytes, 0x394, 0x4012a0);
  const path = await withFile(bytes);

  const { record } = await inspectPeLoadConfigFromPath(path);
  const config = record.load_config;
  expect(record).toMatchObject({ format: 'pe32', bits: 32, machine: 332, architecture: '386' });
  expect(record.tls).toBeNull();
  expect(config?.security_cookie).toStrictEqual({ va: '0x401200', rva: 0x1200, file_offset: 0x400, section: '.data' });
  expect(config?.se_handler_table).toStrictEqual({ va: '0x401210', rva: 0x1210, file_offset: 0x410, section: '.data' });
  expect(config?.se_handler_count).toBe(9);
  expect(config?.guard_flags).toStrictEqual({ raw: 0, flags: [], unrecognized: 0, cf_function_table_stride: 0 });
  expect(config?.inferences).toStrictEqual([]);
  expect(config?.guard_cf_function_count).toBe(2);
  expect(config?.guard_address_taken_iat_entry_count).toBe(11);
  expect(config?.guard_long_jump_target_count).toBe(12);
  expect(config?.dynamic_value_reloc_table).toBe('0x401270');
  expect(config?.chpe_metadata_pointer).toBe('0x401280');
  expect(config?.dynamic_value_reloc_table_offset).toBe(13);
  expect(config?.dynamic_value_reloc_table_section).toBe(14);
  expect(config?.guard_eh_continuation_count).toBe(15);
  expect(config?.guard_xfg_check_function_pointer).toStrictEqual({ va: '0x4012a0', rva: 0x12a0, file_offset: 0x4a0, section: '.data' });
});

test('reports a guard flag outside the known bits as unrecognized', async () => {
  const bytes = loadConfigImage();
  u32(bytes, 0x390, 0x00200000);

  const { record } = await inspectPeLoadConfigFromPath(await withFile(bytes));
  expect(record.load_config?.guard_flags).toStrictEqual({ raw: 0x00200000, flags: [], unrecognized: 0x00200000, cf_function_table_stride: 0 });
  expect(record.load_config?.inferences).toStrictEqual([]);
});

test('leaves load-config fields past the declared size unread', async () => {
  const bytes = loadConfigImage();
  u32(bytes, 0x300, 100);
  const path = await withFile(bytes);

  const { record } = await inspectPeLoadConfigFromPath(path);
  const config = record.load_config;
  expect(config?.size).toBe(100);
  expect(config?.security_cookie).toStrictEqual(refAt(0x1300));
  expect(config?.guard_cf_check_function_pointer).toBeNull();
  expect(config?.guard_cf_function_count).toBeNull();
  expect(config?.guard_flags).toBeNull();
  expect(config?.guard_address_taken_iat_entry_table).toBeNull();
  expect(config?.guard_address_taken_iat_entry_count).toBeNull();
  expect(config?.guard_long_jump_target_count).toBeNull();
  expect(config?.dynamic_value_reloc_table).toBeNull();
  expect(config?.chpe_metadata_pointer).toBeNull();
  expect(config?.dynamic_value_reloc_table_offset).toBeNull();
  expect(config?.dynamic_value_reloc_table_section).toBeNull();
  expect(config?.guard_eh_continuation_count).toBeNull();
  expect(config?.guard_xfg_check_function_pointer).toBeNull();
  expect(config?.inferences).toStrictEqual([]);
});

const tlsImage = (options: { readonly start: bigint; readonly end: bigint; readonly index: bigint; readonly callbacks: bigint }): Buffer => {
  const bytes = sectionImage([{ index: 9, rva: 0x1000, size: 40 }]);
  u64(bytes, 0x200, options.start);
  u64(bytes, 0x208, options.end);
  u64(bytes, 0x210, options.index);
  u64(bytes, 0x218, options.callbacks);
  u32(bytes, 0x220, 0);
  u32(bytes, 0x224, 0x400000);
  return bytes;
};

test('reports TLS pointers below the image base as unmapped', async () => {
  const path = await withFile(tlsImage({ start: 0x1000n, end: 0x2000n, index: 0x1500n, callbacks: 0x2000n }));

  const { record } = await inspectPeLoadConfigFromPath(path);
  expect(record.tls?.raw_data_size).toBe(0);
  expect(record.tls?.raw_data_file_offset).toBeNull();
  expect(record.tls?.raw_data_section).toBeNull();
  expect(record.tls?.start_address_of_raw_data).toBe('0x1000');
  expect(record.tls?.address_of_index).toStrictEqual({ va: '0x1500', rva: null, file_offset: null, section: null });
  expect(record.tls?.callbacks).toStrictEqual([]);
  expect(record.tls?.callback_array_locations).toStrictEqual([]);
  expect(record.examined_callbacks).toBe(0);
});

test.for([
  { name: 'an unmapped TLS directory', directory: { index: 9, rva: 0x9000, size: 40 }, detail: 'TLS directory RVA does not map.' },
  { name: 'a truncated TLS directory', directory: { index: 9, rva: 0x13f0, size: 40 }, detail: 'TLS directory is truncated.' },
  { name: 'an unmapped load-config directory', directory: { index: 10, rva: 0x9000, size: 244 }, detail: 'load config directory RVA does not map.' },
  { name: 'a truncated load-config header', directory: { index: 10, rva: 0x13fe, size: 244 }, detail: 'load config directory is truncated.' },
])('refuses $name', async ({ directory, detail }) => {
  const path = await withFile(sectionImage([directory]));

  const payload = await payloadOf(() => inspectPeLoadConfigFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_load_config', path, 'invalid_format', detail));
});

test('refuses more TLS callbacks than the budget', async () => {
  const path = await withFile(loadConfigImage());

  const payload = await payloadOf(() => inspectPeLoadConfigFromPath(path, { maxCallbacks: 1 }));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_load_config', path, 'invalid_value', 'TLS callbacks exceed max_callbacks=1'));
});

test('refuses a TLS callback array that ends early', async () => {
  const bytes = tlsImage({ start: IMAGE_BASE + 0x1220n, end: IMAGE_BASE + 0x1230n, index: IMAGE_BASE + 0x1240n, callbacks: IMAGE_BASE + 0x13f8n });
  u64(bytes, 0x5f8, IMAGE_BASE + 0x1300n);
  const path = await withFile(bytes);

  const payload = await payloadOf(() => inspectPeLoadConfigFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_load_config', path, 'invalid_format', 'TLS callback array is truncated.'));
});

test.for([2, 1000])('refuses a load-config structure of %s bytes', async (size) => {
  const bytes = loadConfigImage();
  u32(bytes, 0x300, size);
  const path = await withFile(bytes);

  const payload = await payloadOf(() => inspectPeLoadConfigFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_load_config', path, 'invalid_format', 'load config structure is truncated.'));
});

test.for([0, 65_537, 1.5])('rejects max_callbacks %s', async (value) => {
  const payload = await payloadOf(() => inspectPeLoadConfigFromPath('x.exe', { maxCallbacks: value }));

  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_load_config', 'x.exe', 'invalid_value', 'max_callbacks must be an integer between 1 and 65536.'));
});

test('reports TLS pointers past the raw data as unmapped', async () => {
  const targets = await tempTargets();
  const bytes = buildPe({
    directories: [{ index: 9, rva: 0x1000, size: 40 }],
    sections: [{ name: '.data', virtualAddress: 0x1000, virtualSize: 0x800, rawOffset: 0x200, rawSize: 0x400 }],
    length: 0x600,
  });
  u64(bytes, 0x200, IMAGE_BASE + 0x1600n);
  u64(bytes, 0x208, IMAGE_BASE + 0x1620n);
  u64(bytes, 0x210, IMAGE_BASE + 0x1610n);
  u64(bytes, 0x218, IMAGE_BASE + 0x1600n);
  await targets.write('image.exe', bytes);

  const { record, resolvedPath } = await inspectPeLoadConfigFromPath('image.exe', { cwd: targets.dir, maxFileBytes: 4096 });
  expect(resolvedPath).toBe(join(targets.dir, 'image.exe'));
  expect(record.tls?.raw_data_size).toBe(32);
  expect(record.tls?.raw_data_file_offset).toBeNull();
  expect(record.tls?.raw_data_section).toBe('.data');
  expect(record.tls?.address_of_index).toStrictEqual({ va: '0x140001610', rva: 0x1610, file_offset: null, section: '.data' });
  expect(record.tls?.callbacks).toStrictEqual([]);
});

test('rejects a non-PE image for the load config', async () => {
  const path = await withFile(Buffer.from('not a PE image', 'utf8'));

  const payload = await payloadOf(() => inspectPeLoadConfigFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_load_config', path, 'invalid_format', 'the file is not an MZ PE image.'));
});

test('reports absent TLS with absent load-config directories', async () => {
  const path = await withFile(sectionImage([]));

  const { record } = await inspectPeLoadConfigFromPath(path);
  expect(record).toMatchObject({ format: 'pe32-plus', bits: 64, machine: 34404, architecture: 'amd64', examined_callbacks: 0 });
  expect(record.tls).toBeNull();
  expect(record.load_config).toBeNull();
  expect(record.limitations).toHaveLength(6);
});

const tlv = (tag: number, body: Buffer): Buffer => {
  const header = body.length < 0x80 ? Buffer.from([tag, body.length]) : body.length < 0x100 ? Buffer.from([tag, 0x81, body.length]) : Buffer.from([tag, 0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([header, body]);
};

const oid = (dotted: string): Buffer => {
  const parts = dotted.split('.').map(Number);
  const first = (parts[0] ?? 0) * 40 + (parts[1] ?? 0);
  const encoded = [first];
  for (const part of parts.slice(2)) {
    const stack = [part & 0x7f];
    let value = part >> 7;
    while (value > 0) {
      stack.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    encoded.push(...stack);
  }
  return tlv(0x06, Buffer.from(encoded));
};

const seq = (...children: Buffer[]): Buffer => tlv(0x30, Buffer.concat(children));
const set = (...children: Buffer[]): Buffer => tlv(0x31, Buffer.concat(children));
const integer = (value: number): Buffer => tlv(0x02, Buffer.from([value]));

const SHA256_OID = oid('2.16.840.1.101.3.4.2.1');
const SIGNED_DATA_OID = oid('1.2.840.113549.1.7.2');
const DATA_OID = oid('1.2.840.113549.1.7.1');

// The trailing signerInfo keeps the last DER byte non-zero, so WIN_CERTIFICATE padding trimming leaves the payload intact.
const signedDataWith = (signers: readonly Buffer[], digestAlgorithms: readonly Buffer[]): Buffer => seq(SIGNED_DATA_OID, tlv(0xa0, seq(integer(1), set(...digestAlgorithms), seq(SHA256_OID), set(...signers))));
const minimalSignedData = (): Buffer => signedDataWith([seq(integer(1), seq(integer(1)), seq(SHA256_OID))], [seq(SHA256_OID)]);

interface CertificateEntrySpec {
  readonly type: number;
  readonly payload: Buffer;
  readonly length?: number;
}

const securityImage = (entries: readonly CertificateEntrySpec[], options: { readonly tableOffset?: number; readonly tableSize?: number } = {}): Buffer => {
  const tableOffset = options.tableOffset ?? 0x200;
  let size = 0;
  for (const entry of entries) size = (size + (entry.length ?? 8 + entry.payload.length) + 7) & ~7;
  const bytes = sectionImage([{ index: 4, rva: tableOffset, size: options.tableSize ?? size }]);
  let cursor = tableOffset;
  for (const entry of entries) {
    const length = entry.length ?? 8 + entry.payload.length;
    u32(bytes, cursor, length);
    u16(bytes, cursor + 4, 0x200);
    u16(bytes, cursor + 6, entry.type);
    entry.payload.copy(bytes, cursor + 8);
    cursor = (cursor + length + 7) & ~7;
  }
  return bytes;
};

test('decodes the certificate fixture into exact PKCS#7 fields', async () => {
  const path = fixturePath('targets/pe/fixture-pe-certificate.exe');

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.table).toStrictEqual({ location: { offset: 1024, bytes: 1432 }, data_directory_location: { offset: 296, bytes: 8 } });
  expect(record.entries).toHaveLength(1);
  const [entry] = record.entries;
  expect(entry).toMatchObject({ index: 0, length: 1432, revision: 512, certificate_type: 2, certificate_type_name: 'pkcs7' });
  expect(entry?.payload.sha256).toBe('be0bf15a76bbbfca1e4e6497190ccee552c3c3a7fce9f26d377d90a7891161b8');
  expect(entry?.pkcs7?.content_type_oid).toBe('1.2.840.113549.1.7.2');
  expect(entry?.pkcs7?.digest_algorithm_oids).toStrictEqual(['2.16.840.1.101.3.4.2.1']);
  expect(entry?.pkcs7?.certificates[0]?.issuer.text).toBe('commonName=Fixture, organizationName=Test, countryName=US');
  expect(entry?.pkcs7?.certificates[0]?.not_before).toBe('261028035530Z');
  expect(entry?.pkcs7?.certificates[0]?.signature_algorithm_name).toBe('sha256WithRSAEncryption');
  expect(entry?.pkcs7?.signers[0]).toStrictEqual({
    digest_algorithm_oid: '2.16.840.1.101.3.4.2.1',
    digest_algorithm_name: 'sha256',
    signature_algorithm_oid: '1.2.840.113549.1.1.1',
    signature_algorithm_name: 'rsaEncryption',
    issuer: entry?.pkcs7?.certificates[0]?.issuer,
    serial_hex: '349e97196c398c877e6c21c0afc667c1214dba3d',
    subject_key_identifier_hex: null,
    authenticated_attributes: true,
  });
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 1, certificates: 1 });
});

test('trims certificate payload padding for every entry type', async () => {
  const path = await withFile(
    securityImage([
      { type: 2, payload: minimalSignedData() },
      { type: 1, payload: Buffer.alloc(0) },
      { type: 3, payload: Buffer.from('AB\0\0\0\0', 'latin1') },
      { type: 4, payload: Buffer.from([1, 2, 3]) },
      { type: 9, payload: Buffer.from([9]) },
    ]),
  );

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.entries.map((entry) => [entry.index, entry.certificate_type_name, entry.length, entry.payload.bytes])).toStrictEqual([
    [0, 'pkcs7', 81, 73],
    [1, 'x509', 8, 0],
    [2, 'reserved', 14, 2],
    [3, 'ts_stack_signed', 11, 3],
    [4, 'unknown', 9, 1],
  ]);
  expect(record.entries[1]?.payload.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(record.entries[2]?.payload.sha256).toBe('38164fbd17603d73f696b8b4d72664d735bb6a7c88577687fd2ae33fd6964153');
  expect(record.table?.location).toStrictEqual({ offset: 0x200, bytes: 144 });
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 5, certificates: 0 });
});

test('decodes a minimal signedData entry', async () => {
  const path = await withFile(securityImage([{ type: 2, payload: minimalSignedData() }]));

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.entries[0]?.pkcs7).toStrictEqual({
    content_type_oid: '1.2.840.113549.1.7.2',
    content_type_name: 'signedData',
    digest_algorithm_oids: ['2.16.840.1.101.3.4.2.1'],
    certificates: [],
    signers: [],
  });
});

test.for([
  { name: 'a payload that is not a sequence', payload: Buffer.from([0x02, 0x01, 0x05]), detail: 'PKCS#7 ContentInfo must be a SEQUENCE' },
  { name: 'a ContentInfo without content', payload: seq(DATA_OID), detail: 'PKCS#7 ContentInfo is truncated' },
  { name: 'a non-signedData content type', payload: seq(DATA_OID, tlv(0xa0, integer(1))), detail: 'PKCS#7 content type is not signedData' },
  { name: 'an implicit content wrapper', payload: seq(SIGNED_DATA_OID, tlv(0x04, integer(1))), detail: 'PKCS#7 signedData content is not [0] EXPLICIT' },
  { name: 'a signedData with two fields', payload: seq(SIGNED_DATA_OID, tlv(0xa0, seq(integer(1), set(seq(SHA256_OID))))), detail: 'PKCS#7 signedData lacks required fields' },
])('refuses $name', async ({ payload, detail }) => {
  const path = await withFile(securityImage([{ type: 2, payload }]));

  const failure = await payloadOf(() => inspectPeCertificatesFromPath(path));
  expect(failure.details).toStrictEqual(inputDetails('inspect_pe_certificates', path, 'invalid_format', `PKCS#7 decode failed: ${detail}`));
});

test('decodes a signer that carries a subject key identifier', async () => {
  const signer = seq(integer(1), tlv(0xa0, tlv(0x04, Buffer.from([0xab, 0xcd]))), seq(oid('1.2.3.4')), seq(oid('1.2.3.5')));
  const path = await withFile(securityImage([{ type: 2, payload: signedDataWith([signer], [seq(oid('2.16.840.1.101.3.4.2.1'))]) }]));

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.entries[0]?.pkcs7?.signers).toStrictEqual([
    {
      digest_algorithm_oid: '1.2.3.4',
      digest_algorithm_name: null,
      signature_algorithm_oid: '1.2.3.5',
      signature_algorithm_name: null,
      issuer: null,
      serial_hex: null,
      subject_key_identifier_hex: 'abcd',
      authenticated_attributes: false,
    },
  ]);
});

test('decodes a signer with authenticated attributes only', async () => {
  const signer = seq(integer(1), seq(integer(2), integer(3)), seq(SHA256_OID), tlv(0xa0, integer(1)));
  const path = await withFile(securityImage([{ type: 2, payload: signedDataWith([signer], [seq(SHA256_OID)]) }]));

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.entries[0]?.pkcs7?.signers[0]).toStrictEqual({
    digest_algorithm_oid: '2.16.840.1.101.3.4.2.1',
    digest_algorithm_name: 'sha256',
    signature_algorithm_oid: '',
    signature_algorithm_name: null,
    issuer: { attributes: [], text: '' },
    serial_hex: '03',
    subject_key_identifier_hex: null,
    authenticated_attributes: true,
  });
});

test('decodes a signer with unresolvable reference fields', async () => {
  const signer = seq(integer(1), integer(4), seq(), seq(oid('1.2.3.4')));
  const path = await withFile(securityImage([{ type: 2, payload: signedDataWith([signer], [seq(SHA256_OID)]) }]));

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.entries[0]?.pkcs7?.signers).toStrictEqual([
    {
      digest_algorithm_oid: '',
      digest_algorithm_name: null,
      signature_algorithm_oid: '1.2.3.4',
      signature_algorithm_name: null,
      issuer: null,
      serial_hex: null,
      subject_key_identifier_hex: null,
      authenticated_attributes: false,
    },
  ]);
});

test('drops a digest algorithm without an OID', async () => {
  const signer = seq(integer(1), seq(integer(1)), seq(SHA256_OID));
  const path = await withFile(securityImage([{ type: 2, payload: signedDataWith([signer], [seq()]) }]));

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.entries[0]?.pkcs7?.digest_algorithm_oids).toStrictEqual([]);
  expect(record.entries[0]?.pkcs7?.signers).toStrictEqual([]);
});

test('resolves a certificate path against the supplied directory', async () => {
  const targets = await tempTargets();
  await targets.write('cert.exe', securityImage([{ type: 1, payload: Buffer.alloc(0) }]));

  const { resolvedPath, record } = await inspectPeCertificatesFromPath('cert.exe', { cwd: targets.dir, maxFileBytes: 4096 });
  expect(resolvedPath).toBe(join(targets.dir, 'cert.exe'));
  expect(record.entries).toHaveLength(1);
});

test('refuses a certificate table above its entry budget', async () => {
  const path = await withFile(
    securityImage([
      { type: 1, payload: Buffer.alloc(0) },
      { type: 1, payload: Buffer.alloc(0) },
    ]),
  );

  const payload = await payloadOf(() => inspectPeCertificatesFromPath(path, { maxEntries: 1 }));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_certificates', path, 'invalid_value', 'the security table exceeds max_entries=1'));
});

test('refuses a certificate entry shorter than its header', async () => {
  const path = await withFile(securityImage([{ type: 1, payload: Buffer.alloc(0), length: 4 }]));

  const payload = await payloadOf(() => inspectPeCertificatesFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_certificates', path, 'invalid_format', 'a WIN_CERTIFICATE entry is truncated.'));
});

test('refuses a security table past the end of the file', async () => {
  const path = await withFile(securityImage([{ type: 1, payload: Buffer.alloc(0) }], { tableSize: 0x500 }));

  const payload = await payloadOf(() => inspectPeCertificatesFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_certificates', path, 'invalid_format', 'the security directory is truncated.'));
});

test('reads a zero-address security directory as an empty table', async () => {
  const bytes = sectionImage([{ index: 4, rva: 0, size: 5 }]);
  const path = await withFile(bytes);

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.table).toStrictEqual({ location: { offset: 0, bytes: 5 }, data_directory_location: { offset: OPTIONAL_START + 144, bytes: 8 } });
  expect(record.entries).toStrictEqual([]);
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 0, certificates: 0 });
});

test.for([0, 4097, 1.5])('rejects max_entries %s for certificates', async (value) => {
  const payload = await payloadOf(() => inspectPeCertificatesFromPath('x.exe', { maxEntries: value }));

  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_certificates', 'x.exe', 'invalid_value', 'max_entries must be an integer between 1 and 4096.'));
});

test('reports an unsigned image as an empty certificate table', async () => {
  const path = await withFile(sectionImage([]));

  const { record } = await inspectPeCertificatesFromPath(path);
  expect(record.table).toBeNull();
  expect(record.entries).toStrictEqual([]);
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 0, certificates: 0 });
});

test('rejects a non-PE image for certificates', async () => {
  const path = await withFile(Buffer.from('not a PE image', 'utf8'));

  const payload = await payloadOf(() => inspectPeCertificatesFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_certificates', path, 'invalid_format', 'the file is not an MZ PE image.'));
});

type ResourceName = { readonly id: number } | { readonly text: string };
type ResourceNode = { readonly kind: 'dir'; readonly name: ResourceName; readonly children: readonly ResourceNode[] } | { readonly kind: 'data'; readonly name: ResourceName; readonly payloadRva: number; readonly payloadSize: number };

interface ResourceLayout {
  readonly bytes: Buffer;
  readonly base: number;
  readonly directories: ReadonlyMap<string, number>;
  readonly dataEntries: ReadonlyMap<string, number>;
}

const nameKey = (name: ResourceName): string => ('id' in name ? String(name.id) : name.text);

const resourceImage = (root: readonly ResourceNode[]): ResourceLayout => {
  const bytes = buildPe({
    directories: [{ index: 2, rva: 0x1000, size: 0x200 }],
    sections: [SECTION],
    length: 0x600,
  });
  const base = 0x200;
  const directoryRel = new Map<ResourceNode, number>();
  const dataRel = new Map<ResourceNode, number>();
  const paths = new Map<ResourceNode, string>();
  const directoryOffset = new Map<string, number>();
  const textNames = new Set<string>();
  let cursor = 0;
  const allocate = (children: readonly ResourceNode[], key: string): number => {
    const rel = cursor;
    cursor += 16 + children.length * 8;
    directoryOffset.set(key, base + rel);
    for (const child of children) {
      const childKey = key === '' ? nameKey(child.name) : `${key}/${nameKey(child.name)}`;
      paths.set(child, childKey);
      if ('text' in child.name) textNames.add(child.name.text);
      if (child.kind === 'dir') {
        directoryRel.set(child, allocate(child.children, childKey));
      } else {
        dataRel.set(child, cursor);
        cursor += 16;
      }
    }
    return rel;
  };
  const rootRel = allocate(root, '');
  const nameOffsets = new Map<string, number>();
  for (const text of textNames) {
    nameOffsets.set(text, cursor);
    cursor += 2 + text.length * 2;
  }
  const nameField = (name: ResourceName): number => {
    if ('id' in name) return name.id;
    const offset = nameOffsets.get(name.text);
    if (offset === undefined) throw new Error(`missing name string ${name.text}`);
    return 0x80000000 + offset;
  };
  for (const [text, offset] of nameOffsets) {
    u16(bytes, base + offset, text.length);
    bytes.write(text, base + offset + 2, 'utf16le');
  }
  const writeDirectory = (children: readonly ResourceNode[], rel: number): void => {
    const offset = base + rel;
    const named = children.filter((child) => 'text' in child.name).length;
    u16(bytes, offset + 12, named);
    u16(bytes, offset + 14, children.length - named);
    children.forEach((child, index) => {
      const entryOffset = offset + 16 + index * 8;
      u32(bytes, entryOffset, nameField(child.name));
      if (child.kind === 'dir') {
        const childRel = directoryRel.get(child);
        if (childRel === undefined) throw new Error('missing directory allocation');
        u32(bytes, entryOffset + 4, 0x80000000 + childRel);
        writeDirectory(child.children, childRel);
      } else {
        const entryRel = dataRel.get(child);
        if (entryRel === undefined) throw new Error('missing data allocation');
        u32(bytes, entryOffset + 4, entryRel);
        u32(bytes, base + entryRel, child.payloadRva);
        u32(bytes, base + entryRel + 4, child.payloadSize);
        u32(bytes, base + entryRel + 8, 1252);
      }
    });
  };
  writeDirectory(root, rootRel);
  const dataEntries = new Map<string, number>();
  for (const [node, rel] of dataRel) dataEntries.set(paths.get(node) ?? '', base + rel);
  return { bytes, base, directories: directoryOffset, dataEntries };
};

const typeNode = (type: number, children: readonly ResourceNode[]): ResourceNode => ({ kind: 'dir', name: { id: type }, children });
const nameNode = (name: number, children: readonly ResourceNode[]): ResourceNode => ({ kind: 'dir', name: { id: name }, children });
const dataNode = (language: number, payloadRva: number, payloadSize: number): ResourceNode => ({ kind: 'data', name: { id: language }, payloadRva, payloadSize });

const namedImage = (): ResourceLayout => {
  const layout = resourceImage([{ kind: 'dir', name: { text: 'MYTYPE' }, children: [nameNode(1, [dataNode(1033, 0x1200, 4)])] }, typeNode(3, [nameNode(2, [dataNode(1033, 0x1210, 16)])])]);
  layout.bytes.write('DATA', 0x400, 'latin1');
  layout.bytes.fill(0x5a, 0x410, 0x420);
  return layout;
};

test('inventories a resource tree with exact entry locations', async () => {
  const layout = namedImage();
  const path = await withFile(layout.bytes);

  const { record, resolvedPath } = await inspectPeResourcesFromPath(path);
  expect(resolvedPath).toBe(path);
  expect(record.directory).toStrictEqual({ rva: 0x1000, location: { offset: 0x200, bytes: 0x200 }, data_directory_location: { offset: OPTIONAL_START + 128, bytes: 8 } });
  expect(record.directories).toHaveLength(5);
  expect(record.directories[0]).toMatchObject({ path: [], entry_locations: [], named_entries: 1, id_entries: 1 });
  expect(record.directories[0]?.location).toStrictEqual({ offset: 0x200, bytes: 32 });
  expect(record.resources).toStrictEqual([
    {
      index: 0,
      type: { kind: 'name', name: 'MYTYPE' },
      name: { kind: 'id', id: 1 },
      language: { kind: 'id', id: 1033 },
      entry_locations: [
        { offset: 0x210, bytes: 8 },
        { offset: (layout.directories.get('MYTYPE') ?? -1) + 16, bytes: 8 },
        { offset: (layout.directories.get('MYTYPE/1') ?? -1) + 16, bytes: 8 },
      ],
      data_entry_location: { offset: layout.dataEntries.get('MYTYPE/1/1033') ?? -1, bytes: 16 },
      code_page: 1252,
      reserved: 0,
      payload: { rva: 0x1200, location: { offset: 0x400, bytes: 4 }, sha256: sha256(Buffer.from('DATA', 'latin1')) },
    },
    {
      index: 1,
      type: { kind: 'id', id: 3 },
      name: { kind: 'id', id: 2 },
      language: { kind: 'id', id: 1033 },
      entry_locations: [
        { offset: 0x218, bytes: 8 },
        { offset: (layout.directories.get('3') ?? -1) + 16, bytes: 8 },
        { offset: (layout.directories.get('3/2') ?? -1) + 16, bytes: 8 },
      ],
      data_entry_location: { offset: layout.dataEntries.get('3/2/1033') ?? -1, bytes: 16 },
      code_page: 1252,
      reserved: 0,
      payload: { rva: 0x1210, location: { offset: 0x410, bytes: 16 }, sha256: sha256(Buffer.alloc(16, 0x5a)) },
    },
  ]);
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 6, resources: 2 });
  expect(record.icon_groups).toStrictEqual([]);
});

test('pairs an icon group with its icon resources', async () => {
  const layout = resourceImage([
    typeNode(14, [nameNode(1, [dataNode(1033, 0x1200, 34)])]),
    typeNode(3, [nameNode(1, [dataNode(1033, 0x1240, 16)])]),
    typeNode(3, [nameNode(2, [dataNode(1033, 0x1260, 32)])]),
    typeNode(14, [nameNode(2, [dataNode(1033, 0x1280, 4)])]),
    typeNode(14, [nameNode(3, [dataNode(1041, 0x13e8, 20)])]),
  ]);
  u16(layout.bytes, 0x400, 0);
  u16(layout.bytes, 0x402, 1);
  u16(layout.bytes, 0x404, 2);
  const entry = (offset: number, width: number, bitCount: number, declared: number, id: number): void => {
    layout.bytes.writeUInt8(width, offset);
    layout.bytes.writeUInt8(width, offset + 1);
    u16(layout.bytes, offset + 4, 1);
    u16(layout.bytes, offset + 6, bitCount);
    u32(layout.bytes, offset + 8, declared);
    u16(layout.bytes, offset + 12, id);
  };
  entry(0x406, 32, 32, 16, 1);
  entry(0x414, 16, 8, 64, 2);
  u16(layout.bytes, 0x480, 0);
  u16(layout.bytes, 0x482, 1);
  u16(layout.bytes, 0x484, 2);
  entry(0x5ee, 48, 4, 16, 2);
  u16(layout.bytes, 0x5e8, 0);
  u16(layout.bytes, 0x5ea, 1);
  u16(layout.bytes, 0x5ec, 2);
  layout.bytes.fill(0x5a, 0x440, 0x460);
  const path = await withFile(layout.bytes);

  const { record } = await inspectPeResourcesFromPath(path);
  expect(record.icon_groups).toHaveLength(3);
  expect(record.icon_groups[0]).toStrictEqual({
    resource_index: 0,
    images: [
      {
        location: { offset: 0x406, bytes: 14 },
        width: 32,
        height: 32,
        color_count: 0,
        reserved: 0,
        planes: 1,
        bit_count: 32,
        declared_bytes: 16,
        resource_id: 1,
        candidate_resource_indices: [1],
        same_language_resource_index: 1,
        size_matches: true,
      },
      {
        location: { offset: 0x414, bytes: 14 },
        width: 16,
        height: 16,
        color_count: 0,
        reserved: 0,
        planes: 1,
        bit_count: 8,
        declared_bytes: 64,
        resource_id: 2,
        candidate_resource_indices: [2],
        same_language_resource_index: 2,
        size_matches: false,
      },
    ],
  });
  expect(record.icon_groups[1]).toStrictEqual({ resource_index: 3, images: [] });
  expect(record.icon_groups[2]?.images).toHaveLength(1);
  expect(record.icon_groups[2]?.images[0]).toMatchObject({ resource_id: 2, candidate_resource_indices: [2], same_language_resource_index: null, size_matches: false });
});

test('refuses a resource tree deeper than the three levels', async () => {
  const path = await withFile(resourceImage([typeNode(3, [nameNode(1, [{ kind: 'dir', name: { id: 1033 }, children: [] }])])]).bytes);

  const payload = await payloadOf(() => inspectPeResourcesFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', path, 'invalid_format', 'resource tree is deeper than type/name/language'));
});

test('refuses a data entry outside a language directory', async () => {
  const path = await withFile(resourceImage([typeNode(3, [dataNode(1, 0x1200, 4)])]).bytes);

  const payload = await payloadOf(() => inspectPeResourcesFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', path, 'invalid_format', 'a resource data entry is not under type, name and language'));
});

test('refuses a resource payload that maps to no section', async () => {
  const path = await withFile(resourceImage([typeNode(3, [nameNode(1, [dataNode(1033, 0x9000, 4)])])]).bytes);

  const payload = await payloadOf(() => inspectPeResourcesFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', path, 'invalid_format', 'a resource payload does not map to one file range.'));
});

test('refuses a resource tree above its entry budget', async () => {
  const path = await withFile(namedImage().bytes);

  const payload = await payloadOf(() => inspectPeResourcesFromPath(path, { maxEntries: 1 }));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', path, 'invalid_value', 'the resource tree exceeds the 1 entry limit'));
});

test('refuses a resource directory that maps to no section', async () => {
  const bytes = sectionImage([{ index: 2, rva: 0x9000, size: 0x100 }]);
  const path = await withFile(bytes);

  const payload = await payloadOf(() => inspectPeResourcesFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', path, 'invalid_format', 'the resource directory RVA does not map to exactly one file range.'));
});

test.for([
  { name: 'a short buffer', bytes: Buffer.alloc(16), message: 'not an MZ image' },
  { name: 'a foreign DOS magic', bytes: buildPe({ length: 0x40, dosMagic: 0x1234 }), message: 'not an MZ image' },
  { name: 'no PE signature', bytes: buildPe({ signature: 'PX\0\0' }), message: 'no PE signature' },
  { name: 'a truncated optional header', bytes: buildPe({ length: OPTIONAL_START + 100 }), message: 'truncated optional header' },
  { name: 'an unknown optional magic', bytes: buildPe({ magic: 0x107 }), message: 'unsupported optional header magic' },
  { name: 'two data directories', bytes: buildPe({ directoryCount: 2 }), message: 'no resource data directory' },
  { name: 'a truncated resource directory', bytes: buildPe({ optionalSize: 116, directoryCount: 5, length: OPTIONAL_START + 116 }), message: 'truncated resource data directory' },
])('parsePe rejects $name', ({ bytes, message }) => {
  expect(messageOf(() => parseResourcePe(bytes))).toBe(message);
});

test.for([
  { name: 'max_file_bytes below the floor', options: { maxFileBytes: 63 }, detail: 'max_file_bytes must be an integer between 64 and 536870912.' },
  { name: 'max_file_bytes above the ceiling', options: { maxFileBytes: 536_870_913 }, detail: 'max_file_bytes must be an integer between 64 and 536870912.' },
  { name: 'a fractional max_file_bytes', options: { maxFileBytes: 1.5 }, detail: 'max_file_bytes must be an integer between 64 and 536870912.' },
  { name: 'max_entries below the floor', options: { maxEntries: 0 }, detail: 'max_entries must be an integer between 1 and 65536.' },
  { name: 'max_entries above the ceiling', options: { maxEntries: 65_537 }, detail: 'max_entries must be an integer between 1 and 65536.' },
])('rejects $name for resources', async ({ options, detail }) => {
  const payload = await payloadOf(() => inspectPeResourcesFromPath('x.exe', options));

  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', 'x.exe', 'invalid_value', detail));
});

test('rejects a resources image above the byte limit', async () => {
  const path = await withFile(namedImage().bytes);

  const payload = await payloadOf(() => inspectPeResourcesFromPath(path, { maxFileBytes: 100 }));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', path, 'invalid_value', 'the image is 1536 bytes, more than the 100 byte limit'));
});

test('reports a missing resource file', async () => {
  const targets = await tempTargets();
  const missing = join(targets.dir, 'absent.exe');

  const payload = await payloadOf(() => inspectPeResourcesFromPath(missing));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', missing, 'invalid_value', 'no file exists there'));
});

test('resolves a relative resource path against the given directory', async () => {
  const targets = await tempTargets();
  await targets.write('image.exe', namedImage().bytes);

  const { resolvedPath } = await inspectPeResourcesFromPath('image.exe', { cwd: targets.dir });
  expect(resolvedPath).toBe(join(targets.dir, 'image.exe'));
});

test('parses a 32-bit resource image with the 32-bit directory offsets', () => {
  const bytes = buildPe({
    bits: 32,
    directoryCount: 5,
    directories: [{ index: 2, rva: 0x2000, size: 0x40 }],
    sections: [{ name: '.rsrc', virtualAddress: 0x2000, rawOffset: 0x200, rawSize: 0x100 }],
    length: 0x300,
  });

  const pe = parseResourcePe(bytes);
  expect(pe.format).toBe('pe32');
  expect(pe.directoryRva).toBe(0x2000);
  expect(pe.dataDirectoryLocation).toStrictEqual({ offset: OPTIONAL_START + 112, bytes: 8 });
});

test('reads an eight byte section name without a terminator', () => {
  const bytes = buildPe({ sections: [{ name: '.textbss', virtualAddress: 0x1000, rawOffset: 0x200, rawSize: 0x100 }], length: 0x300 });

  expect(parseResourcePe(bytes).sections).toStrictEqual([{ name: '.textbss', virtualSize: 0x100, virtualAddress: 0x1000, rawSize: 0x100, rawOffset: 0x200 }]);
});

test('stops the resource section table at the end of the file', () => {
  const bytes = buildPe({
    sectionCount: 3,
    sections: [{ name: '.rsrc', virtualAddress: 0x1000, rawOffset: 0x200, rawSize: 0x100 }],
    length: OPTIONAL_START + 240 + 40,
  });

  expect(parseResourcePe(bytes).sections).toHaveLength(1);
});

test('maps a resource RVA only through readable raw data', () => {
  const text = { name: '.rsrc', virtualAddress: 0x1000, virtualSize: 0x800, rawOffset: 0x200, rawSize: 0x400 };

  expect(mapResourceRva([text], 0x1000)).toBe(0x200);
  expect(mapResourceRva([text], 0x1400)).toBeUndefined();
  expect(mapResourceRva([text], 0x9000)).toBeUndefined();
  expect(mapResourceRva([text, { ...text, name: '.alias' }], 0x1000)).toBeUndefined();
});

test('refuses a non-PE image for resources', async () => {
  const path = await withFile(Buffer.from('not a PE image', 'utf8'));

  const payload = await payloadOf(() => inspectPeResourcesFromPath(path));
  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', path, 'invalid_format', 'the file is not an MZ PE image.'));
});

test('reports an unreadable resource path', async () => {
  const targets = await tempTargets();

  const payload = await payloadOf(() => inspectPeResourcesFromPath(targets.dir));
  expect(payload.code).toBe('invalid_request');
  expect(issueMessage(payload)).toMatch(/^Cannot inspect .*: it could not be read \(/);
});

test('resolves a relative resource path against the working directory', async () => {
  const payload = await payloadOf(() => inspectPeResourcesFromPath('package.json'));

  expect(payload.details).toStrictEqual(inputDetails('inspect_pe_resources', 'package.json', 'invalid_format', 'the file is not an MZ PE image.'));
});

test('reports an image without a resource directory as empty', async () => {
  const path = await withFile(sectionImage([]));

  const { record } = await inspectPeResourcesFromPath(path);
  expect(record.directory).toBeNull();
  expect(record.directories).toStrictEqual([]);
  expect(record.resources).toStrictEqual([]);
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_entries: 0, resources: 0 });
  expect(record.limitations).toHaveLength(3);
});

test('records PE imports as Evidence through the tool', async () => {
  const path = await withFile(importImage({ thunk: 0x10a0n }));
  const session = new ReaSession(runtime);

  const result = await inspectPeImports(session, { path, max_dlls: 4 });
  const record = result.structuredContent as {
    operation: string;
    parameters: Record<string, unknown>;
    locations: readonly Record<string, unknown>[];
    normalized_result: { imphash: { md5: string }; coverage: unknown };
  };
  expect(record.operation).toBe('inspect_pe_imports');
  expect(record.parameters).toStrictEqual({ path, max_file_bytes: DEFAULT_MAX_FILE_BYTES, max_dlls: 4, max_functions: 8192 });
  expect(record.locations).toStrictEqual([
    { kind: 'artifact-path', path },
    { kind: 'file-offset-range', start: 0x200, end: 0x228 },
  ]);
  expect(record.normalized_result.imphash.md5).toBe('4fe4cbe3f1eef29244a0a0b01016c849');
  expect(record.normalized_result.coverage).toStrictEqual({ status: 'complete', reason: null, examined_dlls: 1, imports: 1, delay_imports: 0 });
  expect(session.evidence.size).toBe(1);
});
