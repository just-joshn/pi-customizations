import { expect, test } from 'vitest';
import { architectureName, cpuSubtypeName, cpuTypeName, isMachO, parseMachO, readSlices, selectHostSlice } from '../src/analysis/macho.ts';

const command = (cmd: number, payload: Buffer): Buffer => {
  const padded = Buffer.alloc(Math.ceil((8 + payload.length) / 8) * 8);
  padded.writeUInt32LE(cmd, 0);
  padded.writeUInt32LE(padded.length, 4);
  payload.copy(padded, 8);
  return padded;
};

const header64 = (commands: Buffer[], fileType = 2, cpuType = 0x0100000c, cpuSubtype = 0): Buffer => {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cpuType, 4);
  header.writeUInt32LE(cpuSubtype, 8);
  header.writeUInt32LE(fileType, 12);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(
    commands.reduce((total, entry) => total + entry.length, 0),
    20,
  );
  header.writeUInt32LE(0x00200085, 24);
  return Buffer.concat([header, ...commands, Buffer.alloc(16)]);
};

const header32 = (commands: Buffer[]): Buffer => {
  const header = Buffer.alloc(28);
  header.writeUInt32LE(0xfeedface, 0);
  header.writeUInt32LE(7, 4);
  header.writeUInt32LE(3, 8);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(
    commands.reduce((total, entry) => total + entry.length, 0),
    20,
  );
  header.writeUInt32LE(0x85, 24);
  return Buffer.concat([header, ...commands, Buffer.alloc(16)]);
};

test('TOOL-058: 32-bit and big-endian headers decode', () => {
  const segment32 = command(
    0x01,
    Buffer.concat([
      Buffer.from('__TEXT'.padEnd(16, '\0'), 'latin1'),
      (() => {
        const body = Buffer.alloc(36);
        body.writeUInt32LE(0x1000, 0);
        body.writeUInt32LE(0x1000, 4);
        body.writeUInt32LE(0, 8);
        body.writeUInt32LE(0x1000, 12);
        body.writeUInt32LE(5, 16);
        body.writeUInt32LE(5, 20);
        body.writeUInt32LE(0, 24);
        body.writeUInt32LE(0, 28);
        return body;
      })(),
    ]),
  );
  const decoded = parseMachO(header32([segment32]));
  expect(decoded.word_size).toBe(32);
  expect(decoded.flags).toStrictEqual(['0x00000085']);
  expect(decoded.segments.items[0]).toMatchObject({ name: '__TEXT', vm_address: '0x1000', maximum_permissions: { raw: '5' } });

  const bigEndian = Buffer.from(header64([]));
  bigEndian.writeUInt32BE(0xfeedfacf, 0);
  bigEndian.writeUInt32BE(0x01000007, 4);
  const decodedBig = parseMachO(bigEndian);
  expect(decodedBig.word_size).toBe(64);
  expect(decodedBig.architectures.items[0]?.name).toBe('x86_64');
});

test('TOOL-058: every supported load command contributes its fields', () => {
  const symtab = command(
    0x02,
    (() => {
      const body = Buffer.alloc(16);
      for (const [index, value] of [0x1000, 12, 0x2000, 64].entries()) body.writeUInt32LE(value, index * 4);
      return body;
    })(),
  );
  const dysymtab = command(
    0x0b,
    (() => {
      const body = Buffer.alloc(72);
      for (let index = 0; index < 18; index += 1) body.writeUInt32LE(index, index * 4);
      return body;
    })(),
  );
  const dyldInfo = command(
    0x80000022,
    (() => {
      const body = Buffer.alloc(40);
      for (let index = 0; index < 10; index += 1) body.writeUInt32LE(index * 100, index * 4);
      return body;
    })(),
  );
  const sourceVersion = command(
    0x2a,
    (() => {
      const body = Buffer.alloc(8);
      body.writeBigUInt64LE((487n << 40n) | (1n << 20n));
      return body;
    })(),
  );
  const functionStarts = command(
    0x26,
    (() => {
      const body = Buffer.alloc(8);
      body.writeUInt32LE(66992, 0);
      body.writeUInt32LE(80, 4);
      return body;
    })(),
  );
  const versionMin = command(
    0x24,
    (() => {
      const body = Buffer.alloc(8);
      body.writeUInt32LE(0x000a0f00, 0);
      body.writeUInt32LE(0x000b0000, 4);
      return body;
    })(),
  );
  const buildVersion = command(
    0x32,
    (() => {
      const body = Buffer.alloc(24);
      body.writeUInt32LE(1, 0);
      body.writeUInt32LE(0x000b0000, 4);
      body.writeUInt32LE(0x001b0000, 8);
      body.writeUInt32LE(1, 12);
      body.writeUInt32LE(3, 16);
      body.writeUInt32LE(27037 << 16, 20);
      return body;
    })(),
  );
  const unknown = command(0x5555, Buffer.alloc(8));
  const decoded = parseMachO(header64([symtab, dysymtab, dyldInfo, sourceVersion, functionStarts, versionMin, buildVersion, unknown]));
  const byKind = new Map(decoded.load_commands.items.map((item) => [item.kind, item.fields]));
  expect(byKind.get('LC_SYMTAB')).toMatchObject({ symoff: 0x1000, nsyms: 12, stroff: 0x2000, strsize: 64 });
  expect(byKind.get('LC_DYSYMTAB')).toMatchObject({ ilocalsym: 0, nundefsym: 5, nlocrel: 17 });
  expect(byKind.get('LC_DYLD_INFO_ONLY')).toMatchObject({ rebase_off: 0, bind_off: 200, export_size: 900 });
  expect(byKind.get('LC_SOURCE_VERSION')).toStrictEqual({ cmd: 'LC_SOURCE_VERSION', cmdsize: 16, version: '487.0.1' });
  expect(byKind.get('LC_FUNCTION_STARTS')).toMatchObject({ dataoff: 66992, datasize: 80 });
  expect(byKind.get('LC_VERSION_MIN_MACOSX')).toMatchObject({ version: '10.15', sdk: '11.0' });
  expect(byKind.get('LC_BUILD_VERSION')).toMatchObject({ platform: 1, minos: '11.0', sdk: '27.0', ntools: 1, tool: 3, version: '27037.0' });
  expect(byKind.get('0x5555')).toStrictEqual({ cmd: '0x5555', cmdsize: 16 });
  expect(decoded.build_metadata.items).toHaveLength(2);
  expect(decoded.build_metadata.items[1]).toStrictEqual({ platform: 'MACOS', minimum_os: '11.0', sdk: '27.0', tools: [{ name: '3', version: '27037.0' }] });
});

test('TOOL-058: a truncated image stops at the last readable command', () => {
  const good = command(0x1b, Buffer.from('11'.repeat(16), 'hex'));
  const truncated = command(0x19, Buffer.alloc(64));
  const bytes = header64([good, truncated]);
  const cut = bytes.subarray(0, 32 + good.length + 12);
  const decoded = parseMachO(cut);
  expect(decoded.load_commands.items.map((item) => item.kind)).toStrictEqual(['LC_UUID']);
  expect(decoded.uuid).toBe('11111111-1111-1111-1111-111111111111');
});

test('TOOL-058: unknown architectures and subtypes are named, not silently dropped', () => {
  expect(cpuTypeName(0x0100000c)).toBe('CPU_TYPE_ARM64');
  expect(cpuTypeName(0x999)).toBeNull();
  expect(cpuSubtypeName(0x0100000c, 0)).toBe('CPU_SUBTYPE_ARM64_ALL');
  expect(cpuSubtypeName(0x0100000c, 0x8000000c)).toBe('unknown arm64 cpusubtype');
  expect(cpuSubtypeName(0x999, 0)).toBeNull();
  expect(architectureName(0x0100000c, 0x80000002)).toBe('arm64e');
  expect(architectureName(0x0100000c, 0x8000000c)).toBe('arm64e.x1');
  expect(architectureName(0x999, 0)).toBe('cpu-2457');
});

test('TOOL-058: universal headers report their slices in order', () => {
  const slice = header64([]);
  const fat = Buffer.alloc(8 + 20 * 2);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8);
  fat.writeUInt32BE(3, 12);
  fat.writeUInt32BE(fat.length, 16);
  fat.writeUInt32BE(slice.length, 20);
  fat.writeUInt32BE(14, 24);
  fat.writeUInt32BE(0x0100000c, 28);
  fat.writeUInt32BE(2, 32);
  fat.writeUInt32BE(fat.length + slice.length, 36);
  fat.writeUInt32BE(slice.length, 40);
  fat.writeUInt32BE(12, 44);
  const bytes = Buffer.concat([fat, slice, slice]);
  const slices = readSlices(bytes);
  expect(slices).toHaveLength(2);
  expect(slices?.[0]).toMatchObject({ cpuType: 0x01000007, cpuSubtype: 3, fileOffset: 48, size: slice.length, alignment: 16384 });
  expect(slices?.[1]).toMatchObject({ alignment: 4096 });
  expect(selectHostSlice(slices ?? [])?.cpuType).toBe(process.arch === 'x64' ? 0x01000007 : 0x0100000c);
  expect(selectHostSlice([{ cpuType: 0x999, cpuSubtype: 0, fileOffset: 0, size: 1, alignment: 1 }])?.cpuType).toBe(0x999);

  const little = Buffer.alloc(fat.length);
  little.writeUInt32LE(0xcafebabe, 0);
  little.writeUInt32LE(2, 4);
  little.writeUInt32LE(0x01000007, 8);
  little.writeUInt32LE(3, 12);
  little.writeUInt32LE(fat.length, 16);
  little.writeUInt32LE(slice.length, 20);
  little.writeUInt32LE(14, 24);
  little.writeUInt32LE(0x0100000c, 28);
  little.writeUInt32LE(2, 32);
  little.writeUInt32LE(fat.length + slice.length, 36);
  little.writeUInt32LE(slice.length, 40);
  little.writeUInt32LE(12, 44);
  expect(readSlices(little)?.[0]).toMatchObject({ cpuType: 0x01000007, fileOffset: fat.length, alignment: 16384 });
  expect(readSlices(Buffer.from('not a macho'))).toBeUndefined();
});

test('TOOL-058: non Mach-O content is refused', () => {
  expect(isMachO(Buffer.from('plain text'))).toBe(false);
  expect(isMachO(Buffer.alloc(2))).toBe(false);
  expect(isMachO(header64([]))).toBe(true);
  expect(() => parseMachO(Buffer.from('plain text'))).toThrowError(/not a Mach-O image/);
  expect(parseMachO(header64([], 6)).file_type).toBe('6');
});

test('TOOL-058: the classic symbol table yields imports and exports', () => {
  const strings = Buffer.from('\0_undefined_ext\0_defined_ext\0_local\0', 'latin1');
  const at = (name: string): number => strings.indexOf(Buffer.from(`${name}\0`, 'latin1'));
  const entry = (stringIndex: number, type: number, descriptor = 0): Buffer => {
    const buffer = Buffer.alloc(16);
    buffer.writeUInt32LE(stringIndex, 0);
    buffer.writeUInt8(type, 4);
    buffer.writeUInt16LE(descriptor, 6);
    return buffer;
  };
  const table = Buffer.concat([entry(at('_undefined_ext'), 0x01, 0x0040), entry(at('_defined_ext'), 0x0f, 0x0080), entry(at('_local'), 0x0e), entry(0, 0x0e)]);
  const symtab = command(
    0x02,
    (() => {
      const body = Buffer.alloc(16);
      body.writeUInt32LE(0, 0);
      body.writeUInt32LE(4, 4);
      body.writeUInt32LE(0, 8);
      body.writeUInt32LE(strings.length, 12);
      return body;
    })(),
  );
  const header = header64([symtab]);
  const symoff = header.length;
  const stroff = symoff + table.length;
  const symtabAt = 32 + 8;
  header.writeUInt32LE(symoff, symtabAt);
  header.writeUInt32LE(stroff, symtabAt + 8);

  const decoded = parseMachO(Buffer.concat([header, table, strings]));
  expect(decoded.imports).toStrictEqual({
    items: [{ name: '_undefined_ext', raw_name: null, name_status: 'exact', addend: null, address: null, weak: null, reexport: null, source: '<this-image>' }],
    total: null,
    exhaustive: false,
    limitations: [expect.stringContaining('dyld_info textual imports')],
  });
  expect(decoded.exports.items).toStrictEqual([{ name: '_defined_ext', raw_name: null, name_status: 'exact', addend: null, address: null, weak: true, reexport: false, source: '<this-image>' }]);
  expect(decoded.exports.total).toBeNull();
  expect(decoded.exports.exhaustive).toBe(false);
});

test('TOOL-058: a truncated symbol table is reported as unavailable', () => {
  const symtab = command(
    0x02,
    (() => {
      const body = Buffer.alloc(16);
      body.writeUInt32LE(0x100000, 0);
      body.writeUInt32LE(4, 4);
      return body;
    })(),
  );
  const decoded = parseMachO(header64([symtab]));
  expect(decoded.imports.items).toStrictEqual([]);
  expect(decoded.imports.limitations[0]).toContain('no classic symbol table');
});
