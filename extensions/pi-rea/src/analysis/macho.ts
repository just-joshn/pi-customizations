import { invalidRequest } from '../contract/errors.ts';

export interface Coverage<T> {
  readonly items: T[];
  readonly total: number | null;
  readonly exhaustive: boolean;
  readonly limitations: string[];
}

const coverage = <T>(items: T[], limitations: string[] = []): Coverage<T> => ({
  items,
  total: items.length,
  exhaustive: true,
  limitations,
});

export interface MachHeader {
  readonly wordSize: 32 | 64;
  readonly littleEndian: boolean;
  readonly cpuType: number;
  readonly cpuSubtype: number;
  readonly fileType: number;
  readonly flags: number;
  readonly commandCount: number;
}

export interface MachSlice {
  readonly cpuType: number;
  readonly cpuSubtype: number;
  readonly fileOffset: number;
  readonly size: number;
  readonly alignment: number;
}

export interface MachDependency {
  readonly path: string;
  readonly kind: string;
  readonly current_version: string | null;
  readonly compatibility_version: string | null;
}

export interface MachSection {
  readonly segment: string;
  readonly name: string;
  readonly address: string;
  readonly size: number;
  readonly file_offset: number;
  readonly alignment: number;
  readonly flags: string[];
}

export interface MachSegment {
  readonly name: string;
  readonly vm_address: string;
  readonly vm_size: number;
  readonly file_offset: number;
  readonly file_size: number;
  readonly maximum_permissions: { read: boolean; write: boolean; execute: boolean; raw: string };
  readonly initial_permissions: { read: boolean; write: boolean; execute: boolean; raw: string };
  readonly sections: Coverage<MachSection>;
}

export interface MachLoadCommand {
  readonly index: number;
  readonly kind: string;
  readonly fields: Record<string, unknown>;
}

export interface MachArchitecture {
  readonly name: string;
  readonly hidden: false;
  readonly cpu_type: string | null;
  readonly cpu_subtype: string | null;
  readonly file_offset: number | null;
  readonly size: number | null;
  readonly alignment: number | null;
}

export interface MachSymbol {
  readonly name: string;
  readonly raw_name: null;
  readonly name_status: 'exact';
  readonly addend: null;
  readonly address: string | null;
  readonly weak: boolean | null;
  readonly reexport: boolean | null;
  readonly source: string;
}

export interface MachBuildMetadata {
  readonly platform: string;
  readonly minimum_os: string;
  readonly sdk: string;
  readonly tools: { name: string; version: string }[];
}

export interface MachInspection {
  readonly format: 'mach-o';
  readonly endian: 'little' | 'big';
  readonly word_size: 32 | 64;
  readonly file_type: string;
  readonly flags: string[];
  readonly uuid: string | null;
  readonly entrypoints: Coverage<{ file_offset: number }>;
  readonly architectures: Coverage<MachArchitecture>;
  readonly selected_architecture: { readonly name: string; readonly container_file_offset: number };
  readonly build_metadata: Coverage<MachBuildMetadata>;
  readonly load_commands: Coverage<MachLoadCommand>;
  readonly dependencies: Coverage<MachDependency>;
  readonly imports: Coverage<MachSymbol>;
  readonly exports: Coverage<MachSymbol>;
  readonly segments: Coverage<MachSegment>;
}

const CPU_TYPES = new Map<number, string>([
  [7, 'x86'],
  [0x01000007, 'x86_64'],
  [12, 'arm'],
  [0x0100000c, 'arm64'],
  [18, 'ppc'],
  [0x01000012, 'ppc64'],
]);

const CPU_SUBTYPES: Record<string, Map<number, string>> = {
  x86: new Map([
    [3, 'CPU_SUBTYPE_X86_ALL'],
    [4, 'CPU_SUBTYPE_X86_64_ALL'],
    [8, 'CPU_SUBTYPE_X86_64_H'],
  ]),
  x86_64: new Map([
    [3, 'CPU_SUBTYPE_X86_ALL'],
    [4, 'CPU_SUBTYPE_X86_64_ALL'],
    [8, 'CPU_SUBTYPE_X86_64_H'],
  ]),
  arm: new Map([
    [0, 'CPU_SUBTYPE_ARM_ALL'],
    [9, 'CPU_SUBTYPE_ARM_V7'],
    [12, 'CPU_SUBTYPE_ARM_V7S'],
  ]),
  arm64: new Map([
    [0, 'CPU_SUBTYPE_ARM64_ALL'],
    [1, 'CPU_SUBTYPE_ARM64_V8'],
    [2, 'CPU_SUBTYPE_ARM64E'],
  ]),
  ppc: new Map([[0, 'CPU_SUBTYPE_POWERPC_ALL']]),
  ppc64: new Map([[0, 'CPU_SUBTYPE_POWERPC_ALL']]),
};

export const architectureName = (cpuType: number, cpuSubtype: number): string => {
  const base = CPU_TYPES.get(cpuType) ?? `cpu-${cpuType}`;
  const masked = cpuSubtype & 0x00ff_ffff;
  const capabilities = cpuSubtype & 0xff00_0000;
  const named = masked === 2 && cpuType === 0x0100000c ? 'arm64e' : base;
  if (capabilities === 0 || masked === 2) return named;
  const flags = capabilities >>> 24;
  let count = 0;
  for (let bit = 0; bit < 8; bit += 1) if ((flags & (1 << bit)) !== 0) count += 1;
  return `${named}e.x${count}`;
};

export const cpuTypeName = (cpuType: number): string | null => {
  const base = CPU_TYPES.get(cpuType);
  if (base === undefined) return null;
  return `CPU_TYPE_${base.toUpperCase().replace('64_', '64_')}`;
};

export const cpuSubtypeName = (cpuType: number, cpuSubtype: number): string | null => {
  const base = CPU_TYPES.get(cpuType);
  if (base === undefined) return null;
  const masked = cpuSubtype & 0x00ff_ffff;
  const named = CPU_SUBTYPES[base]?.get(masked);
  return named ?? `unknown ${base} cpusubtype`;
};

const isThin = (magic: number): boolean => magic === 0xfeedface || magic === 0xfeedfacf;
const isFat = (magic: number): boolean => magic === 0xcafebabe || magic === 0xbebafeca;

export const isMachO = (bytes: Buffer): boolean => {
  if (bytes.length < 4) return false;
  const be = bytes.readUInt32BE(0);
  const le = bytes.readUInt32LE(0);
  return isThin(be) || isThin(le) || isFat(be) || isFat(le);
};

const sliceAlignment = (field: number): number => 2 ** field;

export const readSlices = (bytes: Buffer): MachSlice[] | undefined => {
  const be = bytes.readUInt32BE(0);
  if (!isFat(be)) return undefined;
  const littleEndian = be === 0xbebafeca;
  const read = (offset: number): number => (littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const count = read(4);
  const slices: MachSlice[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = 8 + index * 20;
    if (at + 20 > bytes.length) break;
    slices.push({
      cpuType: read(at),
      cpuSubtype: read(at + 4),
      fileOffset: read(at + 8),
      size: read(at + 12),
      alignment: sliceAlignment(read(at + 16)),
    });
  }
  return slices;
};

export const selectHostSlice = (slices: readonly MachSlice[]): MachSlice | undefined => {
  const host = process.arch === 'arm64' ? 0x0100000c : process.arch === 'x64' ? 0x01000007 : undefined;
  return slices.find((slice) => slice.cpuType === host) ?? (slices.length === 1 ? slices[0] : undefined);
};

const readHeader = (bytes: Buffer, base: number): MachHeader => {
  const magic = bytes.readUInt32BE(base);
  const littleEndian = bytes.readUInt32LE(base) === 0xfeedfacf || bytes.readUInt32LE(base) === 0xfeedface;
  const wordSize: 32 | 64 = (littleEndian ? bytes.readUInt32LE(base) : magic) === 0xfeedfacf ? 64 : 32;
  const at = (offset: number, size: 4 | 8): number =>
    littleEndian ? (size === 8 ? Number(bytes.readBigUInt64LE(base + offset)) : bytes.readUInt32LE(base + offset)) : size === 8 ? Number(bytes.readBigUInt64BE(base + offset)) : bytes.readUInt32BE(base + offset);
  const headerSize = wordSize === 64 ? 32 : 28;
  void headerSize;
  return {
    wordSize,
    littleEndian,
    cpuType: at(4, 4),
    cpuSubtype: at(8, 4),
    fileType: at(12, 4),
    flags: at(24, 4),
    commandCount: at(16, 4),
  };
};

const fixed = (bytes: Buffer, offset: number, littleEndian: boolean, size: 4 | 8): number =>
  size === 8 ? (littleEndian ? Number(bytes.readBigUInt64LE(offset)) : Number(bytes.readBigUInt64BE(offset))) : littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);

const cString = (bytes: Buffer, offset: number, length: number): string => {
  const raw = bytes.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
};

const version = (packed: number): string => {
  const major = (packed >>> 16) & 0xffff;
  const minor = (packed >>> 8) & 0xff;
  const patch = packed & 0xff;
  return patch === 0 ? `${major}.${minor}` : `${major}.${minor}.${patch}`;
};

const dylibVersion = (packed: number): string => `${(packed >>> 16) & 0xffff}.${(packed >>> 8) & 0xff}.${packed & 0xff}`;

const sourceVersion = (packed: bigint): string => {
  const parts = [Number((packed >> 40n) & 0xffffffn), Number((packed >> 30n) & 0x3ffn), Number((packed >> 20n) & 0x3ffn), Number((packed >> 10n) & 0x3ffn), Number(packed & 0x3ffn)];
  let last = parts.length - 1;
  while (last > 0 && parts[last] === 0) last -= 1;
  return parts.slice(0, last + 1).join('.');
};

const permissions = (raw: number): { read: boolean; write: boolean; execute: boolean; raw: string } => ({
  read: (raw & 0x1) !== 0,
  write: (raw & 0x2) !== 0,
  execute: (raw & 0x4) !== 0,
  raw: String(raw),
});

const NAMES: Record<number, string> = {
  1: 'LC_SEGMENT',
  2: 'LC_SYMTAB',
  3: 'LC_SYMSEG',
  11: 'LC_DYSYMTAB',
  12: 'LC_LOAD_DYLIB',
  13: 'LC_ID_DYLIB',
  14: 'LC_LOAD_DYLINKER',
  15: 'LC_ID_DYLINKER',
  25: 'LC_SEGMENT_64',
  27: 'LC_UUID',
  29: 'LC_CODE_SIGNATURE',
  30: 'LC_SEGMENT_SPLIT_INFO',
  31: 'LC_LOAD_WEAK_DYLIB',
  32: 'LC_LAZY_LOAD_DYLIB',
  34: 'LC_DYLD_INFO',
  35: 'LC_REEXPORT_DYLIB',
  36: 'LC_VERSION_MIN_MACOSX',
  37: 'LC_VERSION_MIN_IPHONEOS',
  38: 'LC_FUNCTION_STARTS',
  41: 'LC_DATA_IN_CODE',
  42: 'LC_SOURCE_VERSION',
  43: 'LC_DYLIB_CODE_SIGN_DRS',
  47: 'LC_VERSION_MIN_TVOS',
  48: 'LC_VERSION_MIN_WATCHOS',
  50: 'LC_BUILD_VERSION',
  51: 'LC_DYLD_EXPORTS_TRIE',
  52: 'LC_DYLD_CHAINED_FIXUPS',
  2147483679: 'LC_LOAD_WEAK_DYLIB',
  2147483682: 'LC_DYLD_INFO_ONLY',
  2147483688: 'LC_MAIN',
  2147483699: 'LC_DYLD_EXPORTS_TRIE',
  2147483700: 'LC_DYLD_CHAINED_FIXUPS',
};

const LOAD_DYLIB_KINDS = new Set([0x0c, 0x18, 0x1f, 0x20, 0x23, 0x8000001f, 0x80000018]);
const DYLINKER_KINDS = new Set([0x0e]);
const DATA_KINDS = new Set([0x1d, 0x1e, 0x26, 0x29, 0x2b, 0x33, 0x34]);
const BUILD_PLATFORMS: Record<number, string> = {
  1: 'MACOS',
  2: 'IOS',
  3: 'TVOS',
  4: 'WATCHOS',
  5: 'BRIDGEOS',
  6: 'MACCATALYST',
  7: 'IOSSIMULATOR',
  8: 'TVOSSIMULATOR',
  9: 'WATCHOSSIMULATOR',
  10: 'DRIVERKIT',
};
const VERSION_MIN_KINDS: Record<number, string> = { 36: 'MACOS', 37: 'IOS', 47: 'TVOS', 48: 'WATCHOS' };

const UUID_FORMAT = (hex: string): string => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toUpperCase();

const hex32 = (value: number): string => `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
const hexAddress = (value: number): string => `0x${(value >>> 0).toString(16)}`;
const hex64 = (value: bigint): string => `0x${value.toString(16)}`;

export const parseMachO = (bytes: Buffer): MachInspection => {
  if (!isMachO(bytes)) throw new Error('not a Mach-O image');
  const fat = isFat(bytes.readUInt32BE(0)) || isFat(bytes.readUInt32LE(0));
  const slices = fat ? readSlices(bytes) : undefined;
  const selected = slices === undefined ? 0 : (selectHostSlice(slices)?.fileOffset ?? slices[0]?.fileOffset ?? 0);
  const header = readHeader(bytes, selected);
  const { littleEndian, wordSize } = header;

  const loadCommands: MachLoadCommand[] = [];
  const segments: MachSegment[] = [];
  let symbolTable: { symoff: number; nsyms: number; stroff: number; strsize: number } | undefined;
  const dependencies: MachDependency[] = [];
  const buildMetadata: MachBuildMetadata[] = [];
  const entrypoints: { file_offset: number }[] = [];
  let uuid: string | null = null;

  const commandStart = selected + (wordSize === 64 ? 32 : 28);
  let position = commandStart;
  for (let index = 0; index < header.commandCount; index += 1) {
    if (position + 8 > bytes.length) break;
    const cmd = fixed(bytes, position, littleEndian, 4);
    const cmdsize = fixed(bytes, position + 4, littleEndian, 4);
    if (cmdsize < 8 || position + cmdsize > bytes.length) break;
    const kind = NAMES[cmd] ?? NAMES[cmd & 0x7fff_ffff] ?? `0x${cmd.toString(16)}`;
    const fields: Record<string, unknown> = { cmd: kind, cmdsize };

    if ((cmd & 0x7fff_ffff) === 0x19 || (cmd & 0x7fff_ffff) === 0x01) {
      const is64 = (cmd & 0x7fff_ffff) === 0x19;
      const name = cString(bytes, position + 8, 16);
      const word = is64 ? 8 : 4;
      const vmAddress = fixed(bytes, position + 24, littleEndian, word);
      const vmSize = fixed(bytes, position + 24 + word, littleEndian, word);
      const fileOffset = fixed(bytes, position + 24 + word * 2, littleEndian, word);
      const fileSize = fixed(bytes, position + 24 + word * 3, littleEndian, word);
      const maxprot = fixed(bytes, position + 24 + word * 4, littleEndian, 4);
      const initprot = fixed(bytes, position + 28 + word * 4, littleEndian, 4);
      const sectionCount = fixed(bytes, position + 32 + word * 4, littleEndian, 4);
      const flags = fixed(bytes, position + 36 + word * 4, littleEndian, 4);
      Object.assign(fields, {
        segname: name,
        vmaddr: vmAddress,
        vmsize: vmSize,
        fileoff: fileOffset,
        filesize: fileSize,
        maxprot,
        initprot,
        nsects: sectionCount,
        flags,
      });
      const sections: MachSection[] = [];
      const headerSize = is64 ? 72 : 56;
      const sectionSize = is64 ? 80 : 68;
      for (let section = 0; section < sectionCount; section += 1) {
        const at = position + headerSize + section * sectionSize;
        if (at + sectionSize > position + cmdsize) break;
        sections.push({
          segment: cString(bytes, at + 16, 16),
          name: cString(bytes, at, 16),
          address: is64 ? hex64(readBigInt(bytes, at + 32, littleEndian)) : hexAddress(fixed(bytes, at + 32, littleEndian, 4)),
          size: fixed(bytes, at + 32 + word, littleEndian, word),
          file_offset: fixed(bytes, at + 32 + word * 2, littleEndian, 4),
          alignment: 2 ** fixed(bytes, at + 36 + word * 2, littleEndian, 4),
          flags: [String(fixed(bytes, at + 48 + word * 2, littleEndian, 4))],
        });
      }
      segments.push({
        name,
        vm_address: is64 ? hex64(readBigInt(bytes, position + 24, littleEndian)) : hexAddress(vmAddress),
        vm_size: vmSize,
        file_offset: fileOffset,
        file_size: fileSize,
        maximum_permissions: permissions(maxprot),
        initial_permissions: permissions(initprot),
        sections: coverage(sections),
      });
    } else if ((cmd & 0x7fff_ffff) === 0x1b) {
      const value = bytes.subarray(position + 8, position + 24).toString('hex');
      uuid = UUID_FORMAT(value);
      fields['uuid'] = uuid;
    } else if (cmd === 0x80000028) {
      const entryoff = fixed(bytes, position + 8, littleEndian, 8);
      const stacksize = fixed(bytes, position + 16, littleEndian, 8);
      Object.assign(fields, { entryoff, stacksize });
      entrypoints.push({ file_offset: entryoff });
    } else if (cmd === 0x32) {
      const platform = fixed(bytes, position + 8, littleEndian, 4);
      const minos = fixed(bytes, position + 12, littleEndian, 4);
      const sdk = fixed(bytes, position + 16, littleEndian, 4);
      const toolCount = fixed(bytes, position + 20, littleEndian, 4);
      Object.assign(fields, { platform, minos: version(minos), sdk: version(sdk), ntools: toolCount });
      const tools: { name: string; version: string }[] = [];
      for (let tool = 0; tool < toolCount; tool += 1) {
        const at = position + 24 + tool * 8;
        if (at + 8 > position + cmdsize) break;
        const entry = { name: String(fixed(bytes, at, littleEndian, 4)), version: version(fixed(bytes, at + 4, littleEndian, 4)) };
        tools.push(entry);
        if (tool === 0) Object.assign(fields, { tool: Number(entry.name), version: entry.version });
      }
      buildMetadata.push({
        platform: BUILD_PLATFORMS[platform] ?? String(platform),
        minimum_os: version(minos),
        sdk: version(sdk),
        tools,
      });
    } else if (VERSION_MIN_KINDS[cmd & 0x7fff_ffff] !== undefined && (cmd & 0x7fff_ffff) !== 0x32) {
      const platform = VERSION_MIN_KINDS[cmd & 0x7fff_ffff] as string;
      const minos = fixed(bytes, position + 8, littleEndian, 4);
      const sdk = fixed(bytes, position + 12, littleEndian, 4);
      Object.assign(fields, { version: version(minos), sdk: version(sdk) });
      buildMetadata.push({ platform, minimum_os: version(minos), sdk: version(sdk), tools: [] });
    } else if (LOAD_DYLIB_KINDS.has(cmd) || DYLINKER_KINDS.has(cmd)) {
      const nameOffset = fixed(bytes, position + 8, littleEndian, 4);
      const path = cString(bytes, position + nameOffset, cmdsize - nameOffset);
      const nameField = `${path} (offset ${nameOffset})`;
      if (DYLINKER_KINDS.has(cmd)) {
        Object.assign(fields, { name: nameField });
      } else {
        const timestamp = fixed(bytes, position + 12, littleEndian, 4);
        const current = fixed(bytes, position + 16, littleEndian, 4);
        const compatibility = fixed(bytes, position + 20, littleEndian, 4);
        Object.assign(fields, {
          name: nameField,
          'time stamp': otoolTimestamp(timestamp),
          'current version': dylibVersion(current),
          'compatibility version': dylibVersion(compatibility),
        });
        if (cmd !== 0x0d) dependencies.push({ path, kind, current_version: dylibVersion(current), compatibility_version: dylibVersion(compatibility) });
      }
    } else if (cmd === 0x02) {
      symbolTable = {
        symoff: fixed(bytes, position + 8, littleEndian, 4),
        nsyms: fixed(bytes, position + 12, littleEndian, 4),
        stroff: fixed(bytes, position + 16, littleEndian, 4),
        strsize: fixed(bytes, position + 20, littleEndian, 4),
      };
      Object.assign(fields, symbolTable);
    } else if (cmd === 0x0b) {
      const names = [
        'ilocalsym',
        'nlocalsym',
        'iextdefsym',
        'nextdefsym',
        'iundefsym',
        'nundefsym',
        'tocoff',
        'ntoc',
        'modtaboff',
        'nmodtab',
        'extrefsymoff',
        'nextrefsyms',
        'indirectsymoff',
        'nindirectsyms',
        'extreloff',
        'nextrel',
        'locreloff',
        'nlocrel',
      ];
      for (const [offset, fieldName] of names.entries()) {
        Object.assign(fields, { [fieldName]: fixed(bytes, position + 8 + offset * 4, littleEndian, 4) });
      }
    } else if ((cmd & 0x7fff_ffff) === 0x22) {
      const names = ['rebase_off', 'rebase_size', 'bind_off', 'bind_size', 'weak_bind_off', 'weak_bind_size', 'lazy_bind_off', 'lazy_bind_size', 'export_off', 'export_size'];
      for (const [offset, fieldName] of names.entries()) {
        Object.assign(fields, { [fieldName]: fixed(bytes, position + 8 + offset * 4, littleEndian, 4) });
      }
    } else if (DATA_KINDS.has(cmd & 0x7fff_ffff)) {
      const dataoff = fixed(bytes, position + 8, littleEndian, 4);
      const datasize = fixed(bytes, position + 12, littleEndian, 4);
      Object.assign(fields, { dataoff, datasize });
    } else if ((cmd & 0x7fff_ffff) === 0x2a) {
      Object.assign(fields, { version: sourceVersion(readBigInt(bytes, position + 8, littleEndian)) });
    }

    loadCommands.push({ index, kind, fields });
    position += cmdsize;
  }

  void commandStart;
  const symbols = readSymbols(bytes, symbolTable, wordSize, littleEndian);
  const architectures: MachArchitecture[] =
    slices === undefined
      ? [
          {
            name: architectureName(header.cpuType, header.cpuSubtype),
            hidden: false,
            cpu_type: null,
            cpu_subtype: null,
            file_offset: null,
            size: null,
            alignment: null,
          },
        ]
      : slices.map((slice) => ({
          name: architectureName(slice.cpuType, slice.cpuSubtype),
          hidden: false,
          cpu_type: cpuTypeName(slice.cpuType),
          cpu_subtype: cpuSubtypeName(slice.cpuType, slice.cpuSubtype),
          file_offset: slice.fileOffset,
          size: slice.size,
          alignment: slice.alignment,
        }));
  const selectedArchitecture = architectures.find((entry) => entry.file_offset === selected) ?? architectures[0];

  return {
    format: 'mach-o',
    endian: littleEndian ? 'little' : 'big',
    word_size: wordSize,
    file_type: String(header.fileType),
    flags: [hex32(header.flags)],
    uuid,
    entrypoints: coverage(entrypoints),
    architectures: coverage(architectures),
    selected_architecture: {
      name: selectedArchitecture?.name ?? architectureName(header.cpuType, header.cpuSubtype),
      container_file_offset: selectedArchitecture?.file_offset ?? selected,
    },
    build_metadata: coverage(buildMetadata),
    load_commands: coverage(loadCommands),
    dependencies: coverage(dependencies),
    imports: symbolCoverage(symbols?.imports ?? [], symbols === undefined ? NO_SYMBOL_TABLE_LIMITATION : IMPORT_LIMITATION, (symbol) => ({
      name: symbol.name,
      raw_name: null,
      name_status: 'exact' as const,
      addend: null,
      address: null,
      weak: null,
      reexport: null,
      source: THIS_IMAGE,
    })),
    exports: symbolCoverage(symbols?.exports ?? [], symbols === undefined ? NO_SYMBOL_TABLE_LIMITATION : EXPORT_LIMITATION, (symbol) => ({
      name: symbol.name,
      raw_name: null,
      name_status: 'exact' as const,
      addend: null,
      address: null,
      weak: symbol.weak,
      reexport: false,
      source: THIS_IMAGE,
    })),
    segments: coverage(segments),
  };
};

interface Symbol {
  readonly name: string;
  readonly weak: boolean;
}

const readSymbols = (bytes: Buffer, table: { symoff: number; nsyms: number; stroff: number; strsize: number } | undefined, wordSize: 32 | 64, littleEndian: boolean): { imports: Symbol[]; exports: Symbol[] } | undefined => {
  if (table === undefined || table.nsyms === 0) return undefined;
  const entrySize = wordSize === 64 ? 16 : 12;
  if (table.symoff + table.nsyms * entrySize > bytes.length) return undefined;
  const strings = bytes.subarray(table.stroff, Math.min(bytes.length, table.stroff + table.strsize));
  const imports: Symbol[] = [];
  const exports: Symbol[] = [];
  for (let index = 0; index < table.nsyms; index += 1) {
    const at = table.symoff + index * entrySize;
    const stringIndex = bytes.readUInt32LE(at);
    const type = bytes.readUInt8(at + 4);
    const descriptor = bytes.readUInt16LE(at + 6);
    if (stringIndex === 0 || stringIndex >= strings.length) continue;
    const end = strings.indexOf(0, stringIndex);
    if (end === -1) continue;
    const name = strings.subarray(stringIndex, end).toString('utf8');
    if (name === '') continue;
    const kind = type & 0x0e;
    const external = (type & 0x01) !== 0;
    if (kind === 0x00 && external) imports.push({ name, weak: (descriptor & 0x0040) !== 0 });
    else if (kind === 0x0e && external) exports.push({ name, weak: (descriptor & 0x0080) !== 0 });
  }
  void littleEndian;
  return { imports, exports };
};

const symbolCoverage = <T>(symbols: readonly Symbol[], limitation: string, project: (symbol: Symbol) => T): Coverage<T> => ({
  items: symbols.map(project),
  total: null,
  exhaustive: false,
  limitations: [limitation],
});

export const IMPORT_LIMITATION = 'dyld_info textual imports may omit chained or toolchain-unsupported metadata.';
export const EXPORT_LIMITATION = 'Merged nm/dyld_info results may be incomplete for stripped binaries.';
export const NO_SYMBOL_TABLE_LIMITATION = 'The image carries no classic symbol table, so no symbol names are available.';
const THIS_IMAGE = '<this-image>';

const readBigInt = (bytes: Buffer, offset: number, littleEndian: boolean): bigint => (littleEndian ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset));

export const MACHO_LIMITATIONS = ['Imports and exports combine dyld_info and nm; stripped or toolchain-hidden symbols may be absent.', 'vtool output is retained as provenance but only otool build metadata is normalized.'];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const otoolTimestamp = (epochSeconds: number): string => {
  const date = new Date(epochSeconds * 1000);
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, ' ');
  return `${epochSeconds} ${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${date.getFullYear()}`;
};

export const machoInputError = (path: string, detail: string): ReturnType<typeof invalidRequest> =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_macho',
    issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${detail}.` }],
  });
