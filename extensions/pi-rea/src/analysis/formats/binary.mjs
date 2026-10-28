// biome-ignore-all lint/complexity/useSimpleNumberKeys: machine-code constants are clearer in hexadecimal

import { digestOf } from '../canonical.mjs';
import { coverage } from '../envelope.mjs';

const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_SYMBOLS = 200_000;
const MAX_IMPORT_DESCRIPTORS = 4096;
const MAX_THUNKS_PER_LIBRARY = 65_536;
const PLATFORM_LIMITATION = 'The reference implementation backs inspect_binary_layout with pwntools and supports Linux x64 only; this reader is a platform departure that reads Mach-O, ELF and PE in-process.';

export class FormatError extends Error {
  constructor(code, offset, message) {
    if (code !== 'truncated' && code !== 'malformed') throw new Error(`unknown format error code: ${code}`);
    super(message);
    this.name = 'FormatError';
    this.code = code;
    this.offset = Number.isInteger(offset) && offset >= 0 ? offset : null;
  }
}
const truncated = (offset, message) => new FormatError('truncated', offset, message);
const malformed = (offset, message) => new FormatError('malformed', offset, message);

function checkRange(view, offset, length, what) {
  if (!view.has(offset, length)) throw truncated(offset, `${what} needs ${length} byte(s) at offset ${offset}, but the readable region is [${view.start}, ${view.end})`);
  return offset;
}
const need = (view, offset, length, what) => checkRange(view, offset, length, what);

function checkedU64(bytes, offset, little, what) {
  const value = little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset);
  if (value > MAX_SAFE_BIG) throw malformed(offset, `${what} = ${value} exceeds Number.MAX_SAFE_INTEGER`);
  return Number(value);
}

function byteView(bytes, start, end) {
  const view = {
    start,
    end,
    bytes,
    has: (offset, length) => Number.isInteger(offset) && offset >= start && length >= 0 && offset + length <= end,
    u8: (offset, what) => bytes[checkRange(view, offset, 1, what)],
    u16: (offset, little, what) => (little ? bytes.readUInt16LE(checkRange(view, offset, 2, what)) : bytes.readUInt16BE(checkRange(view, offset, 2, what))),
    u32: (offset, little, what) => (little ? bytes.readUInt32LE(checkRange(view, offset, 4, what)) : bytes.readUInt32BE(checkRange(view, offset, 4, what))),
    u64raw: (offset, little, what) => (little ? bytes.readBigUInt64LE(checkRange(view, offset, 8, what)) : bytes.readBigUInt64BE(checkRange(view, offset, 8, what))),
    u64: (offset, little, what) => checkedU64(bytes, checkRange(view, offset, 8, what), little, what),
    cstring(offset, maxLength) {
      if (!view.has(offset, 0) || maxLength <= 0) return '';
      const nul = bytes.indexOf(0, offset);
      const limit = Math.min(offset + maxLength, end);
      return bytes.toString('utf8', offset, nul === -1 || nul > limit ? limit : nul);
    },
  };
  return view;
}

const readWide = (view, offset, width, little, what) => (width === 8 ? view.u64(offset, little, what) : view.u32(offset, little, what));

function readFixedString(view, offset, size) {
  need(view, offset, size, 'fixed name field');
  const nul = view.bytes.indexOf(0, offset);
  return view.bytes.toString('utf8', offset, nul === -1 || nul > offset + size ? offset + size : nul);
}

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new TypeError('binary readers require a Buffer or Uint8Array');
}

const MACH_O_THIN = { 0xfeedface: { bits: 32, little: false }, 0xcefaedfe: { bits: 32, little: true }, 0xfeedfacf: { bits: 64, little: false }, 0xcffaedfe: { bits: 64, little: true } };
const MACH_O_FAT = { 0xcafebabe: { wide: false, little: false }, 0xbebafeca: { wide: false, little: true }, 0xcafebabf: { wide: true, little: false }, 0xbfbafeca: { wide: true, little: true } };
const MACH_O_CPUS = { 7: 'x86', 0x01000007: 'x86_64', 12: 'arm', 0x0100000c: 'arm64', 18: 'powerpc', 0x01000012: 'powerpc' };
const MACH_O_FILE_TYPES = { 1: 'object', 2: 'executable', 4: 'core', 5: 'executable', 6: 'shared-library', 8: 'bundle' };
const MACH_O_THREAD = { 7: { flavor: 1, width: 4, pc: 40 }, 0x01000007: { flavor: 4, width: 8, pc: 128 }, 12: { flavor: 1, width: 4, pc: 60 }, 0x0100000c: { flavor: 6, width: 8, pc: 256 }, 18: { flavor: 1, width: 4, pc: 0 } };
const LC_SEGMENT = 0x1;
const LC_SYMTAB = 0x2;
const LC_UNIXTHREAD = 0x5;
const LC_LOAD_DYLIB = 0xc;
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_REEXPORT_DYLIB = 0x8000001f;
const LC_UUID = 0x1b;
const LC_SEGMENT_64 = 0x19;
const LC_MAIN = 0x80000028;
const LC_LOAD_UPWARD_DYLIB = 0x80000023;

const ELF_HEADER_32 = { ehsize: 52, wide: 4, entry: 24, phoff: 28, shoff: 32, phentsize: 42, phnum: 44, shentsize: 46, shnum: 48, shstrndx: 50 };
const ELF_HEADER_64 = { ehsize: 64, wide: 8, entry: 24, phoff: 32, shoff: 40, phentsize: 54, phnum: 56, shentsize: 58, shnum: 60, shstrndx: 62 };
const ELF_PHDR_32 = { size: 32, type: 0, flags: 24, offset: 4, vaddr: 8, filesz: 16, memsz: 20 };
const ELF_PHDR_64 = { size: 56, type: 0, flags: 4, offset: 8, vaddr: 16, filesz: 32, memsz: 40 };
const ELF_SHDR_32 = { size: 40, name: 0, flags: 8, addr: 12, offset: 16, sizeField: 20, link: 24, entsize: 36 };
const ELF_SHDR_64 = { size: 64, name: 0, flags: 8, addr: 16, offset: 24, sizeField: 32, link: 40, entsize: 56 };
const ELF_SYMBOL_32 = { size: 16, value: 8 };
const ELF_SYMBOL_64 = { size: 24, value: 8 };
const ELF_HEADER = { 32: ELF_HEADER_32, 64: ELF_HEADER_64 };
const ELF_PHDR = { 32: ELF_PHDR_32, 64: ELF_PHDR_64 };
const ELF_SHDR = { 32: ELF_SHDR_32, 64: ELF_SHDR_64 };
const ELF_SYMBOL = { 32: ELF_SYMBOL_32, 64: ELF_SYMBOL_64 };
const ELF_MACHINES = { 0x03: 'x86', 0x3e: 'x86_64', 0x28: 'arm', 0xb7: 'aarch64', 0x14: 'powerpc', 0x15: 'powerpc' };
const ELF_FILE_TYPES = { 1: 'object', 2: 'executable', 3: 'shared-library', 4: 'core' };
const ELF_TYPE_NAMES = { 1: 'ET_REL', 2: 'ET_EXEC', 3: 'ET_DYN', 4: 'ET_CORE' };
const ELF_SEGMENT_NAMES = { 1: 'PT_LOAD', 2: 'PT_DYNAMIC', 3: 'PT_INTERP', 4: 'PT_NOTE', 6: 'PT_PHDR', 7: 'PT_TLS', 0x6474e550: 'PT_GNU_EH_FRAME', 0x6474e551: 'PT_GNU_STACK', 0x6474e552: 'PT_GNU_RELRO' };
const SHT = { PROGBITS: 1, SYMTAB: 2, STRTAB: 3, DYNAMIC: 6, NOBITS: 8, DYNSYM: 11 };
const DT = { NEEDED: 1, STRTAB: 5, STRSZ: 10, BIND_NOW: 24, FLAGS: 30, FLAGS_1: 0x6ffffffb };
const DF = { BIND_NOW: 0x8, NOW: 0x1, PIE: 0x08000000 };

const PE_MACHINES = { 0x014c: 'x86', 0x8664: 'x86_64', 0xaa64: 'arm64', 0x01c0: 'arm', 0x01c4: 'arm', 0x5032: 'riscv', 0x5064: 'riscv64' };
const PE_OPTIONAL = { 32: { count: 92, table: 96 }, 64: { count: 108, table: 112 } };

export function detectFormat(bytes) {
  const data = asBuffer(bytes);
  if (data.length < 4) return null;
  if (data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) return 'elf';
  const big = data.readUInt32BE(0);
  const little = data.readUInt32LE(0);
  if (MACH_O_THIN[big] || MACH_O_THIN[little] || MACH_O_FAT[big] || MACH_O_FAT[little]) return 'mach-o';
  if (data[0] === 0x4d && data[1] === 0x5a) return 'pe';
  return null;
}

export function readBinaryLayout(bytes) {
  const data = asBuffer(bytes);
  const format = detectFormat(data);
  const sha256 = digestOf(data);
  if (format === 'mach-o') return readMachO(data, sha256);
  if (format === 'elf') return readElf(data, sha256);
  if (format === 'pe') return readPe(data, sha256);
  const preview = data.length === 0 ? '(empty)' : `0x${data.subarray(0, 4).toString('hex')}`;
  throw malformed(null, `unrecognised binary format: leading bytes ${preview}; expected Mach-O, ELF or PE`);
}

function readMachO(data, sha256) {
  const big = data.length >= 4 ? data.readUInt32BE(0) : 0;
  const little = data.length >= 4 ? data.readUInt32LE(0) : 0;
  const fat = MACH_O_FAT[big] ?? MACH_O_FAT[little];
  if (fat) return readFatMachO(data, fat, sha256);
  const spec = MACH_O_THIN[big] ?? MACH_O_THIN[little];
  if (!spec) throw malformed(0, 'Mach-O magic is not one of the four thin or four fat constants');
  return readThinMachO(data, spec, { offset: 0, size: data.length }, [], sha256, []);
}

function thinSpecAt(view, offset) {
  if (!view.has(offset, 4)) throw truncated(offset, 'Mach-O magic needs 4 bytes');
  return MACH_O_THIN[view.u32(offset, false, 'Mach-O magic')] ?? MACH_O_THIN[view.u32(offset, true, 'Mach-O magic')] ?? null;
}

function readFatMachO(data, fat, sha256) {
  const file = byteView(data, 0, data.length);
  const entrySize = fat.wide ? 32 : 20;
  const count = file.u32(4, fat.little, 'fat nfat_arch');
  const capacity = Math.floor((file.end - 8) / entrySize);
  if (count > capacity) throw truncated(4, `fat header declares ${count} slices of ${entrySize} bytes, but only ${capacity} fit in a ${file.end}-byte file`);
  if (count === 0) throw malformed(4, 'fat header declares zero slices');
  const slices = [];
  for (let index = 0; index < count; index += 1) {
    const base = 8 + index * entrySize;
    const offset = file.u32(base + 8, fat.little, 'fat slice offset');
    const size = file.u32(base + 12, fat.little, 'fat slice size');
    if (!file.has(offset, size)) throw truncated(base + 8, `fat slice ${index} spans [${offset}, ${offset + size}), past ${file.end}`);
    const spec = thinSpecAt(file, offset);
    if (!spec) throw malformed(offset, `fat slice ${index} at ${offset} is not a thin Mach-O image`);
    slices.push({ architecture: MACH_O_CPUS[file.u32(base, fat.little, 'fat cputype')] ?? 'unknown', bits: spec.bits, offset, size });
  }
  const first = slices[0];
  return readThinMachO(data, thinSpecAt(file, first.offset), first, slices, sha256, [
    `Fat image: segments, sections, symbols and entrypoint come from slice 0 (${first.architecture}, ${first.bits}-bit); all ${slices.length} slices are recorded.`,
    'Fat slice offsets and sizes are file-relative; segment and section file offsets are relative to slice 0.',
  ]);
}

function readThinMachO(data, spec, region, slices, sha256, extraNotes) {
  const file = byteView(data, region.offset, region.offset + region.size);
  const h = region.offset;
  const headerSize = spec.bits === 64 ? 32 : 28;
  need(file, h, headerSize, 'Mach-O header');
  const cputype = file.u32(h + 4, spec.little, 'Mach-O cputype');
  const ncmds = file.u32(h + 16, spec.little, 'Mach-O ncmds');
  const sizeofcmds = file.u32(h + 20, spec.little, 'Mach-O sizeofcmds');
  const commandSpace = file.end - (h + headerSize);
  const maxCommands = Math.floor(commandSpace / 8);
  if (ncmds > maxCommands) throw truncated(h + 16, `Mach-O declares ${ncmds} load commands, but only ${maxCommands} fit in the ${commandSpace} bytes after the header`);
  if (sizeofcmds > commandSpace) throw truncated(h + 20, `Mach-O sizeofcmds ${sizeofcmds} runs past the ${commandSpace} bytes available for load commands`);
  const state = parseLoadCommands(file, spec, { cputype, start: h + headerSize, ncmds });
  const symbols = machoSymbols(file, spec, state, region.offset);
  const flags = file.u32(h + 24, spec.little, 'Mach-O flags');
  return {
    format: 'mach-o',
    bits: spec.bits,
    endianness: spec.little ? 'little' : 'big',
    architecture: MACH_O_CPUS[cputype] ?? 'unknown',
    file_type: MACH_O_FILE_TYPES[file.u32(h + 12, spec.little, 'Mach-O filetype')] ?? 'unknown',
    slices,
    segments: state.segments,
    sections: state.sections,
    entrypoint: state.entrypoint,
    symbols: symbols.value,
    libraries: state.libraries,
    uuid: state.uuid,
    mitigations: machoMitigations(flags, h + 24, symbols),
    digests: { sha256 },
    limitations: [PLATFORM_LIMITATION, ...extraNotes, ...state.notes, ...symbols.value.coverage.limits],
  };
}

function parseLoadCommands(file, spec, { cputype, start, ncmds }) {
  let state = { cputype, segments: [], sections: [], libraries: [], uuid: null, entrypoint: null, symtab: null, notes: [] };
  let cursor = start;
  for (let index = 0; index < ncmds; index += 1) {
    const cmd = file.u32(cursor, spec.little, `load command ${index}`);
    const cmdsize = file.u32(cursor + 4, spec.little, `load command ${index} size`);
    if (cmdsize < 8) throw malformed(cursor + 4, `load command ${index} declares ${cmdsize} bytes, the minimum is 8`);
    if (!file.has(cursor, cmdsize)) throw truncated(cursor, `load command ${index} spans [${cursor}, ${cursor + cmdsize}), past ${file.end}`);
    state = applyLoadCommand(file, spec, { cmd, cmdsize, offset: cursor }, state);
    cursor += cmdsize;
  }
  return state;
}

function applyLoadCommand(file, spec, command, state) {
  const o = command.offset;
  if (command.cmd === LC_SEGMENT || command.cmd === LC_SEGMENT_64) return withSegment(file, spec, command, state);
  if (command.cmd === LC_MAIN) return { ...state, entrypoint: file.u64(o + 8, spec.little, 'LC_MAIN entryoff') };
  if (command.cmd === LC_UNIXTHREAD) return withUnixThread(file, spec, command, state);
  if (command.cmd === LC_UUID) {
    need(file, o + 8, 16, 'LC_UUID');
    const hex = file.bytes.subarray(o + 8, o + 24).toString('hex');
    return { ...state, uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` };
  }
  if ([LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB, LC_LOAD_UPWARD_DYLIB].includes(command.cmd)) {
    const nameOffset = file.u32(o + 8, spec.little, 'dylib name offset');
    if (nameOffset < 8 || nameOffset >= command.cmdsize) throw malformed(o + 8, `dylib name offset ${nameOffset} is outside its ${command.cmdsize}-byte load command`);
    return { ...state, libraries: [...state.libraries, file.cstring(o + nameOffset, command.cmdsize - nameOffset)] };
  }
  if (command.cmd === LC_SYMTAB)
    return {
      ...state,
      symtab: {
        symoff: file.u32(o + 8, spec.little, 'LC_SYMTAB symoff'),
        nsyms: file.u32(o + 12, spec.little, 'LC_SYMTAB nsyms'),
        stroff: file.u32(o + 16, spec.little, 'LC_SYMTAB stroff'),
        strsize: file.u32(o + 20, spec.little, 'LC_SYMTAB strsize'),
      },
    };
  return state;
}

function withSegment(file, spec, command, state) {
  const wide = spec.bits === 64 ? 8 : 4;
  const layout = spec.bits === 64 ? { fileoff: 40, filesize: 48, initprot: 60, nsects: 64, vmaddr: 24, vmsize: 32 } : { fileoff: 32, filesize: 36, initprot: 44, nsects: 48, vmaddr: 24, vmsize: 28 };
  const headerSize = spec.bits === 64 ? 72 : 68;
  const sectionSize = spec.bits === 64 ? 80 : 68;
  if (command.cmdsize < headerSize) throw malformed(command.offset, `segment command is ${command.cmdsize} bytes, needs at least ${headerSize}`);
  const name = readFixedString(file, command.offset + 8, 16);
  const initprot = file.u32(command.offset + layout.initprot, spec.little, 'segment initprot');
  const nsects = file.u32(command.offset + layout.nsects, spec.little, 'segment nsects');
  const available = Math.floor((command.cmdsize - headerSize) / sectionSize);
  if (nsects > available) throw truncated(command.offset + layout.nsects, `segment ${name} declares ${nsects} sections, but only ${available} fit in its ${command.cmdsize}-byte load command`);
  const sectionAt = command.offset + headerSize;
  const segment = {
    name,
    file_offset: readWide(file, command.offset + layout.fileoff, wide, spec.little, 'segment fileoff'),
    file_size: readWide(file, command.offset + layout.filesize, wide, spec.little, 'segment filesize'),
    virtual_address: readWide(file, command.offset + layout.vmaddr, wide, spec.little, 'segment vmaddr'),
    virtual_size: readWide(file, command.offset + layout.vmsize, wide, spec.little, 'segment vmsize'),
    permissions: { read: (initprot & 1) !== 0, write: (initprot & 2) !== 0, execute: (initprot & 4) !== 0 },
  };
  return { ...state, segments: [...state.segments, segment], sections: [...state.sections, ...readMachoSectionRange(file, spec, sectionAt, nsects, sectionSize, name)] };
}

function readMachoSectionRange(file, spec, base, count, size, segmentName) {
  const sections = [];
  for (let index = 0; index < count; index += 1) sections.push(readMachoSection(file, spec, base + index * size, segmentName));
  return sections;
}

function machoSectionKind(flags, name) {
  const type = flags & 0xff;
  if (type === 0x1 || type === 0xc || type === 0x12) return 'zerofill';
  if (type === 0x2) return 'cstring';
  if (type === 0x3 || type === 0x4 || type === 0x5 || type === 0xe) return 'literal';
  if (type === 0x6 || type === 0x7 || type === 0x10) return 'symbol-pointer';
  if (type === 0x8) return 'stubs';
  if (type === 0x9 || type === 0xa) return 'function-pointers';
  if ((flags & 0x80000400) !== 0 || (type === 0x0 && name.startsWith('__text'))) return 'code';
  return 'data';
}

function readMachoSection(file, spec, base, segmentName) {
  const wide = spec.bits === 64 ? 8 : 4;
  const l = spec.bits === 64 ? { addr: 32, size: 40, offset: 48, flags: 64 } : { addr: 32, size: 36, offset: 40, flags: 56 };
  const name = readFixedString(file, base, 16);
  return {
    name,
    segment: segmentName,
    file_offset: file.u32(base + l.offset, spec.little, 'section offset'),
    size: readWide(file, base + l.size, wide, spec.little, 'section size'),
    virtual_address: readWide(file, base + l.addr, wide, spec.little, 'section addr'),
    kind: machoSectionKind(file.u32(base + l.flags, spec.little, 'section flags'), name),
  };
}

function withUnixThread(file, spec, command, state) {
  const layout = MACH_O_THREAD[state.cputype];
  const flavor = file.u32(command.offset + 8, spec.little, 'LC_UNIXTHREAD flavor');
  if (!layout || layout.flavor !== flavor) return { ...state, notes: [...state.notes, `LC_UNIXTHREAD flavor ${flavor} for cputype 0x${state.cputype.toString(16)} was not decoded; the entrypoint is unknown.`] };
  const pc = command.offset + 16 + layout.pc;
  if (pc + layout.width > command.offset + command.cmdsize) return { ...state, notes: [...state.notes, 'LC_UNIXTHREAD thread state is shorter than its declared flavor; the entrypoint is unknown.'] };
  const value = layout.width === 8 ? file.u64(pc, spec.little, 'thread state pc') : file.u32(pc, spec.little, 'thread state pc');
  return { ...state, entrypoint: state.entrypoint ?? value };
}

function machoSymbols(file, spec, state, sliceOffset) {
  if (!state.symtab) {
    const message = 'No LC_SYMTAB load command is present, so imports and exports were not established; this is not evidence that the image imports or exports nothing.';
    return { value: { imports: [], exports: [], table: 'none', coverage: coverage({ status: 'unavailable', limits: [message] }) } };
  }
  const scan = scanMachoNlist(file, spec, state, sliceOffset);
  const notes = ['The dyld export trie is not decoded, so exports are the LC_SYMTAB nlist set only and the dynamic export list is not established.', 'LC_SYMTAB nlist entries carry no import kind, so Mach-O imports report kind unknown.'];
  if (scan.omitted > 0) notes.push(`LC_SYMTAB declares more symbols than the ${MAX_SYMBOLS} this reader retains.`);
  const block = scan.omitted > 0 ? coverage({ status: 'partial', truncated: true, omittedCount: scan.omitted, limits: notes }) : coverage({ status: 'partial', limits: notes });
  return { value: { imports: scan.imports, exports: scan.exports, table: 'symtab', coverage: block } };
}

function scanMachoNlist(file, spec, state, sliceOffset) {
  const entrySize = spec.bits === 64 ? 16 : 12;
  const symtab = state.symtab;
  const symbolsAt = sliceOffset + symtab.symoff;
  const stringsAt = sliceOffset + symtab.stroff;
  const capacity = Math.floor((file.end - symbolsAt) / entrySize);
  if (symtab.nsyms > capacity) throw truncated(symbolsAt, `LC_SYMTAB declares ${symtab.nsyms} symbols of ${entrySize} bytes at slice offset ${symtab.symoff} (file ${symbolsAt}), but only ${capacity} fit in [${symbolsAt}, ${file.end})`);
  const count = Math.min(symtab.nsyms, MAX_SYMBOLS);
  const imports = [];
  const exports = [];
  for (let index = 0; index < count; index += 1) {
    const base = symbolsAt + index * entrySize;
    const strx = file.u32(base, spec.little, 'nlist n_strx');
    const type = file.u8(base + 4, 'nlist n_type');
    const section = file.u8(base + 5, 'nlist n_sect');
    const value = readWide(file, base + 8, spec.bits === 64 ? 8 : 4, spec.little, 'nlist n_value');
    if ((type & 0xe0) !== 0) continue;
    const name = strx < symtab.strsize ? file.cstring(stringsAt + strx, symtab.strsize - strx) : '';
    if (name === '') continue;
    if ((type & 0x0e) === 0 && (type & 0x01) !== 0) imports.push({ name, library: null, kind: 'unknown' });
    else if ((type & 0x0e) !== 0 && (type & 0x01) !== 0) exports.push({ name, kind: state.sections[section - 1]?.kind === 'code' ? 'function' : 'unknown', virtual_address: value });
  }
  return { imports, exports, omitted: symtab.nsyms - count };
}

function machoMitigations(flags, flagsOffset, symbols) {
  const flag = (bit) => (flags & bit) !== 0;
  return [
    { name: 'pie', value: flag(0x200000), marker: `Mach-O header flags 0x${flags.toString(16)} at file offset ${flagsOffset}: MH_PIE (0x200000) is ${flag(0x200000) ? 'set' : 'clear'}` },
    { name: 'nx', value: !flag(0x20000), marker: `Mach-O header flags 0x${flags.toString(16)} at file offset ${flagsOffset}: MH_ALLOW_STACK_EXECUTION (0x20000) is ${flag(0x20000) ? 'set' : 'clear'}` },
    ...symbolMitigations(
      symbols.value.imports.map((symbol) => symbol.name),
      symbols.value.coverage.status !== 'unavailable',
      'LC_SYMTAB nlist imports',
    ),
  ];
}

function symbolMitigations(names, available, source) {
  if (!available) {
    return [
      { name: 'stack-canary', value: 'unknown', marker: `no symbol table was read (${source}), so __stack_chk_fail was not looked up` },
      { name: 'fortify', value: 'unknown', marker: `no symbol table was read (${source}), so __*_chk symbols were not looked up` },
    ];
  }
  const canary = names.some((name) => name === '__stack_chk_fail' || name === '___stack_chk_fail');
  const chk = names.filter((name) => name.startsWith('__') && name.endsWith('_chk'));
  return [
    { name: 'stack-canary', value: canary, marker: canary ? `symbol __stack_chk_fail in ${source}` : `no __stack_chk_fail among ${names.length} imports in ${source}` },
    { name: 'fortify', value: chk.length > 0, marker: chk.length > 0 ? `symbols ${chk.join(', ')} in ${source}` : `no __*_chk symbols among ${names.length} imports in ${source}` },
  ];
}

function readElf(data, sha256) {
  const file = byteView(data, 0, data.length);
  need(file, 0, 16, 'ELF identification');
  if (data[4] !== 1 && data[4] !== 2) throw malformed(4, `ELF class ${data[4]} is neither ELFCLASS32 (1) nor ELFCLASS64 (2)`);
  if (data[5] !== 1 && data[5] !== 2) throw malformed(5, `ELF data encoding ${data[5]} is neither little (1) nor big (2)`);
  const bits = data[4] === 1 ? 32 : 64;
  const little = data[5] === 1;
  const header = ELF_HEADER[bits];
  need(file, 0, header.ehsize, 'ELF header');
  const etype = file.u16(16, little, 'e_type');
  const machine = file.u16(18, little, 'e_machine');
  const phoff = readWide(file, header.phoff, header.wide, little, 'e_phoff');
  const segments = elfSegments(file, little, bits, header, { phoff, phentsize: file.u16(header.phentsize, little, 'e_phentsize'), phnum: file.u16(header.phnum, little, 'e_phnum') });
  const sections = elfSections(
    file,
    little,
    bits,
    header,
    {
      shoff: readWide(file, header.shoff, header.wide, little, 'e_shoff'),
      shentsize: file.u16(header.shentsize, little, 'e_shentsize'),
      shnum: file.u16(header.shnum, little, 'e_shnum'),
      shstrndx: file.u16(header.shstrndx, little, 'e_shstrndx'),
    },
    segments,
  );
  const dynamic = elfDynamic(file, little, bits, sections, segments);
  const symbols = elfSymbols(file, little, bits, sections, dynamic);
  return {
    format: 'elf',
    bits,
    endianness: little ? 'little' : 'big',
    architecture: machine === 0xf3 ? (bits === 64 ? 'riscv64' : 'riscv') : (ELF_MACHINES[machine] ?? 'unknown'),
    file_type: ELF_FILE_TYPES[etype] ?? 'unknown',
    slices: [],
    segments,
    sections: sections.map(({ name, segment, file_offset, size, virtual_address, kind }) => ({ name, segment, file_offset, size, virtual_address, kind })),
    entrypoint: readWide(file, header.entry, header.wide, little, 'e_entry'),
    symbols: symbols.value,
    libraries: dynamic.needed,
    uuid: null,
    mitigations: elfMitigations({ etype, segments, dynamic, dynamicImports: symbols.dynamicImports }),
    digests: { sha256 },
    limitations: [PLATFORM_LIMITATION, ...dynamic.notes, ...symbols.value.coverage.limits],
  };
}

function elfSegments(file, little, bits, header, { phoff, phentsize, phnum }) {
  const layout = ELF_PHDR[bits];
  if (phnum === 0) return [];
  if (phentsize < layout.size) throw malformed(header.phentsize, `e_phentsize ${phentsize} is smaller than the ${layout.size}-byte program header`);
  const capacity = Number.isInteger(phoff) && phoff <= file.end ? Math.floor((file.end - phoff) / phentsize) : 0;
  if (phnum > capacity) throw truncated(header.phnum, `e_phnum ${phnum} program headers of ${phentsize} bytes at ${phoff} run past ${file.end}`);
  const segments = [];
  for (let index = 0; index < phnum; index += 1) {
    const base = phoff + index * phentsize;
    const offset = readWide(file, base + layout.offset, header.wide, little, `program header ${index} p_offset`);
    const filesz = readWide(file, base + layout.filesz, header.wide, little, `program header ${index} p_filesz`);
    if (filesz > 0 && !file.has(offset, filesz)) throw truncated(base + layout.offset, `program header ${index} spans [${offset}, ${offset + filesz}), past ${file.end}`);
    const flags = file.u32(base + layout.flags, little, `program header ${index} p_flags`);
    const type = file.u32(base + layout.type, little, `program header ${index} p_type`);
    segments.push({
      name: ELF_SEGMENT_NAMES[type] ?? `PT_0x${type.toString(16)}`,
      file_offset: offset,
      file_size: filesz,
      virtual_address: readWide(file, base + layout.vaddr, header.wide, little, `program header ${index} p_vaddr`),
      virtual_size: readWide(file, base + layout.memsz, header.wide, little, `program header ${index} p_memsz`),
      permissions: { read: (flags & 4) !== 0, write: (flags & 2) !== 0, execute: (flags & 1) !== 0 },
      header_offset: base,
      flags,
    });
  }
  return segments;
}

function elfSections(file, little, bits, header, { shoff, shentsize, shnum, shstrndx }, segments) {
  const layout = ELF_SHDR[bits];
  if (shnum === 0) return [];
  if (shentsize < layout.size) throw malformed(header.shentsize, `e_shentsize ${shentsize} is smaller than the ${layout.size}-byte section header`);
  if (!Number.isInteger(shoff) || shoff > file.end) throw truncated(header.shoff, `e_shoff ${shoff} is past the end of a ${file.end}-byte file`);
  const capacity = Math.floor((file.end - shoff) / shentsize);
  if (shnum > capacity) throw truncated(header.shnum, `e_shnum ${shnum} section headers of ${shentsize} bytes at ${shoff} run past ${file.end}`);
  const raw = [];
  for (let index = 0; index < shnum; index += 1) {
    const base = shoff + index * shentsize;
    raw.push({
      header_offset: base,
      name_offset: file.u32(base + layout.name, little, `section ${index} sh_name`),
      type: file.u32(base + 4, little, `section ${index} sh_type`),
      flags: readWide(file, base + layout.flags, header.wide, little, `section ${index} sh_flags`),
      virtual_address: readWide(file, base + layout.addr, header.wide, little, `section ${index} sh_addr`),
      file_offset: readWide(file, base + layout.offset, header.wide, little, `section ${index} sh_offset`),
      size: readWide(file, base + layout.sizeField, header.wide, little, `section ${index} sh_size`),
      link: file.u32(base + layout.link, little, `section ${index} sh_link`),
      entsize: readWide(file, base + layout.entsize, header.wide, little, `section ${index} sh_entsize`),
    });
  }
  const strtab = raw[shstrndx] && raw[shstrndx].type === SHT.STRTAB && file.has(raw[shstrndx].file_offset, raw[shstrndx].size) ? raw[shstrndx] : null;
  return raw.map((section) => ({
    ...section,
    name: strtab ? file.cstring(strtab.file_offset + section.name_offset, strtab.size - section.name_offset) : '',
    segment: segments.find((candidate) => candidate.name === 'PT_LOAD' && section.virtual_address >= candidate.virtual_address && section.virtual_address < candidate.virtual_address + candidate.virtual_size)?.name ?? '',
    kind: elfSectionKind(section.type, section.flags),
  }));
}

function elfSectionKind(type, flags) {
  if (type === SHT.NOBITS) return 'bss';
  if (type === SHT.PROGBITS) return (flags & 0x4) !== 0 ? 'code' : 'data';
  if (type === SHT.SYMTAB || type === SHT.DYNSYM || type === 18) return 'symbols';
  if (type === SHT.STRTAB) return 'strings';
  if (type === 4 || type === 9) return 'relocations';
  if (type === 5 || type === 0x6ffffff6) return 'hash';
  if (type === SHT.DYNAMIC) return 'dynamic';
  if (type === 7) return 'note';
  if (type === 14 || type === 15 || type === 16) return 'function-pointers';
  if (type === 17) return 'group';
  if (type === 0x6ffffffd || type === 0x6ffffffe || type === 0x6fffffff) return 'versions';
  return 'data';
}

function elfDynamic(file, little, bits, sections, segments) {
  const wide = bits === 64 ? 8 : 4;
  const section = sections.find((candidate) => candidate.type === SHT.DYNAMIC || candidate.name === '.dynamic');
  const segment = segments.find((candidate) => candidate.name === 'PT_DYNAMIC');
  const region = section ? { offset: section.file_offset, size: section.size } : segment ? { offset: segment.file_offset, size: segment.file_size } : null;
  if (!region || region.size === 0) return { needed: [], bindNow: false, flags1: 0, strings: null, notes: [] };
  if (!file.has(region.offset, region.size)) throw truncated(region.offset, `.dynamic spans [${region.offset}, ${region.offset + region.size}), past ${file.end}`);
  const entrySize = bits === 64 ? 16 : 8;
  const count = Math.min(Math.floor(region.size / entrySize), Math.floor((file.end - region.offset) / entrySize));
  const tags = {};
  const needed = [];
  for (let index = 0; index < count; index += 1) {
    const base = region.offset + index * entrySize;
    const tag = readWide(file, base, wide, little, 'dynamic d_tag');
    const value = readWide(file, base + wide, wide, little, 'dynamic d_val');
    if (tag === 0) break;
    if (tag === DT.NEEDED) needed.push(value);
    tags[tag] ??= value;
  }
  const strings = elfStringTable(file, sections, segments, tags[DT.STRTAB], tags[DT.STRSZ]);
  const resolved = needed.map((offset) => (strings && offset < strings.size ? file.cstring(strings.offset + offset, strings.size - offset) : ''));
  return {
    needed: resolved.filter((name) => name !== ''),
    bindNow: DT.BIND_NOW in tags || ((tags[DT.FLAGS] ?? 0) & DF.BIND_NOW) !== 0 || ((tags[DT.FLAGS_1] ?? 0) & DF.NOW) !== 0,
    flags1: tags[DT.FLAGS_1] ?? 0,
    strings,
    notes: resolved.some((name) => name === '') ? ['Some DT_NEEDED entries could not be resolved because the dynamic string table was not readable.'] : [],
  };
}

function elfStringTable(file, sections, segments, strtabVaddr, strsz) {
  if (strtabVaddr !== undefined && strsz !== undefined) {
    const offset = vaddrToFileOffset(segments, strtabVaddr);
    if (offset !== null && file.has(offset, strsz)) return { offset, size: strsz };
  }
  const section = sections.find((candidate) => candidate.name === '.dynstr' && file.has(candidate.file_offset, candidate.size));
  return section ? { offset: section.file_offset, size: section.size } : null;
}

function vaddrToFileOffset(segments, vaddr) {
  const found = segments.find((segment) => segment.file_size > 0 && vaddr >= segment.virtual_address && vaddr < segment.virtual_address + segment.file_size);
  return found ? found.file_offset + (vaddr - found.virtual_address) : null;
}

function elfSymbols(file, little, bits, sections, dynamic) {
  const dynsym = sections.find((section) => section.type === SHT.DYNSYM || section.name === '.dynsym');
  const symtab = sections.find((section) => section.type === SHT.SYMTAB || section.name === '.symtab');
  const primary = dynsym ?? symtab;
  if (!primary) {
    const message = 'No .dynsym or .symtab section header is present, so imports and exports were not established; this is not evidence that the file imports or exports nothing.';
    return { value: { imports: [], exports: [], table: 'none', coverage: coverage({ status: 'unavailable', limits: [message] }) }, dynamicImports: null };
  }
  const table = primary.type === SHT.DYNSYM ? 'dynsym' : 'symtab';
  const linked = sections[primary.link];
  const fallback = linked && file.has(linked.file_offset, linked.size) ? { offset: linked.file_offset, size: linked.size } : dynamic.strings;
  const scan = scanElfSymbols(file, little, bits, primary, primary.type === SHT.DYNSYM && dynamic.strings ? dynamic.strings : fallback);
  const notes = scan.omitted > 0 ? [`The ${table} section declares ${scan.declared} entries; the first ${MAX_SYMBOLS} were read.`] : [];
  const block = scan.omitted > 0 ? coverage({ status: 'partial', truncated: true, omittedCount: scan.omitted, limits: notes }) : coverage({ status: 'complete', omittedCount: 0, limits: notes });
  return { value: { imports: scan.imports, exports: scan.exports, table, coverage: block }, dynamicImports: dynsym ? scan.imports.map((symbol) => symbol.name) : null };
}

function scanElfSymbols(file, little, bits, section, strings) {
  const wide = bits === 64 ? 8 : 4;
  const layout = ELF_SYMBOL[bits];
  const entrySize = section.entsize === 0 ? layout.size : section.entsize;
  if (entrySize < layout.size) throw malformed(section.header_offset + ELF_SHDR[bits].entsize, `symbol table entry size ${entrySize} is smaller than the ${layout.size}-byte symbol`);
  const declared = Math.floor(section.size / entrySize);
  const capacity = Math.floor((file.end - section.file_offset) / entrySize);
  if (declared > capacity) throw truncated(section.header_offset + ELF_SHDR[bits].sizeField, `symbol table declares ${declared} entries at ${section.file_offset}, but only ${capacity} fit before ${file.end}`);
  const count = Math.min(declared, MAX_SYMBOLS);
  const imports = [];
  const exports = [];
  for (let index = 0; index < count; index += 1) {
    const base = section.file_offset + index * entrySize;
    const nameOffset = file.u32(base, little, 'st_name');
    const info = file.u8(base + 4, 'st_info');
    const other = file.u8(base + 5, 'st_other');
    const shndx = file.u16(base + 6, little, 'st_shndx');
    const value = readWide(file, base + layout.value, wide, little, 'st_value');
    const name = strings && nameOffset < strings.size ? file.cstring(strings.offset + nameOffset, strings.size - nameOffset) : '';
    if (name === '') continue;
    const kind = (info & 0xf) === 2 || (info & 0xf) === 10 ? 'function' : (info & 0xf) === 1 ? 'data' : 'unknown';
    if (shndx === 0) imports.push({ name, library: null, kind });
    else if ((info >> 4 === 1 || info >> 4 === 2) && (other & 0x3) === 0) exports.push({ name, kind, virtual_address: value });
  }
  return { imports, exports, declared, omitted: declared - count };
}

function elfMitigations({ etype, segments, dynamic, dynamicImports }) {
  const stack = segments.find((segment) => segment.name === 'PT_GNU_STACK');
  const relro = segments.find((segment) => segment.name === 'PT_GNU_RELRO');
  const interp = segments.find((segment) => segment.name === 'PT_INTERP');
  const permissionsOf = (segment) => `p_flags=0x${segment.flags.toString(16)} at file offset ${segment.header_offset} (${['read', 'write', 'execute'].filter((name) => segment.permissions[name]).join('|') || 'none'})`;
  const nx = stack
    ? { name: 'nx', value: stack.permissions.execute === false, marker: `PT_GNU_STACK program header ${permissionsOf(stack)}: PF_X is ${stack.permissions.execute ? 'set' : 'clear'}` }
    : { name: 'nx', value: 'unknown', marker: `searched ${segments.length} program headers: no PT_GNU_STACK, so the stack execute bit was not observed` };
  const pieMarkers = [];
  if ((dynamic.flags1 & DF.PIE) !== 0) pieMarkers.push(`DT_FLAGS_1=0x${dynamic.flags1.toString(16)} (DF_1_PIE)`);
  if (interp) pieMarkers.push(`PT_INTERP program header at file offset ${interp.header_offset}`);
  const pie =
    etype === 3 && pieMarkers.length > 0
      ? { name: 'pie', value: true, marker: `e_type=ET_DYN (0x3) at file offset 16 with ${pieMarkers.join(' and ')}` }
      : {
          name: 'pie',
          value: false,
          marker: etype === 3 ? 'e_type=ET_DYN (0x3) at file offset 16 without DF_1_PIE or PT_INTERP' : `e_type=${ELF_TYPE_NAMES[etype] ?? `ET_0x${etype.toString(16)}`} (0x${etype.toString(16)}) at file offset 16`,
        };
  const relroEntry = relro
    ? {
        name: 'relro',
        value: dynamic.bindNow ? 'full' : 'partial',
        marker: `PT_GNU_RELRO program header ${permissionsOf(relro)} with ${dynamic.bindNow ? 'DT_BIND_NOW or DF_BIND_NOW set in .dynamic' : 'no DT_BIND_NOW and no DF_BIND_NOW in .dynamic'}`,
      }
    : { name: 'relro', value: false, marker: `searched ${segments.length} program headers: no PT_GNU_RELRO` };
  return [nx, pie, relroEntry, ...symbolMitigations(dynamicImports ?? [], dynamicImports !== null, '.dynsym')];
}

function readPe(data, sha256) {
  const file = byteView(data, 0, data.length);
  need(file, 0, 2, 'DOS header');
  const peOffset = file.u32(0x3c, true, 'e_lfanew');
  need(file, peOffset, 24, 'PE signature and COFF header');
  if (file.u32(peOffset, true, 'PE signature') !== 0x00004550) throw malformed(peOffset, `no PE signature (PE\\0\\0) at e_lfanew=${peOffset}`);
  const coff = peOffset + 4;
  const machine = file.u16(coff, true, 'COFF machine');
  const optionalSize = file.u16(coff + 16, true, 'COFF optional header size');
  const optionalStart = coff + 20;
  need(file, optionalStart, optionalSize, 'PE optional header');
  const magic = file.u16(optionalStart, true, 'optional header magic');
  if (magic !== 0x10b && magic !== 0x20b) throw malformed(optionalStart, `optional header magic 0x${magic.toString(16)} is neither PE32 (0x10b) nor PE32+ (0x20b)`);
  const bits = magic === 0x20b ? 64 : 32;
  const minimum = bits === 64 ? 112 : 96;
  if (optionalSize < minimum) throw truncated(optionalStart, `a PE32${bits === 64 ? '+' : ''} optional header needs at least ${minimum} bytes, the file declares ${optionalSize}`);
  const directories = peDirectories(file, optionalStart, optionalSize, bits);
  const sections = peSections(file, optionalStart + optionalSize, file.u16(coff + 2, true, 'COFF section count'));
  const imports = readPeImports(file, sections, bits, directories[1]);
  const exports = readPeExports(file, sections, directories[0]);
  const notes = [...imports.notes, ...exports.notes];
  const partial = imports.partial || exports.partial;
  return {
    format: 'pe',
    bits,
    endianness: 'little',
    architecture: PE_MACHINES[machine] ?? 'unknown',
    file_type: (file.u16(coff + 18, true, 'COFF characteristics') & 0x2000) !== 0 ? 'shared-library' : 'executable',
    slices: [],
    segments: sections.map((section) => ({ name: section.name, file_offset: section.file_offset, file_size: section.size, virtual_address: section.virtual_address, virtual_size: section.virtual_size, permissions: section.permissions })),
    sections: sections.map((section) => ({ name: section.name, segment: '', file_offset: section.file_offset, size: section.size, virtual_address: section.virtual_address, kind: section.kind })),
    entrypoint: file.u32(optionalStart + 16, true, 'AddressOfEntryPoint'),
    symbols: {
      imports: imports.imports,
      exports: exports.exports,
      table: [directories[1] ? 'import-directory' : null, directories[0] ? 'export-directory' : null].filter(Boolean).join('+') || 'none',
      coverage: partial ? coverage({ status: 'partial', limits: notes }) : coverage({ status: 'complete', omittedCount: 0, limits: notes }),
    },
    libraries: imports.libraries,
    uuid: null,
    mitigations: [],
    digests: { sha256 },
    limitations: [PLATFORM_LIMITATION, 'PE has no program header table; segments mirror the section table with permissions from the IMAGE_SCN_MEM_* characteristics.', ...notes],
  };
}

function peDirectories(file, optionalStart, optionalSize, bits) {
  const layout = PE_OPTIONAL[bits];
  const declared = file.u32(optionalStart + layout.count, true, 'NumberOfRvaAndSizes');
  const count = Math.min(declared, 16);
  if (count > 0 && optionalStart + layout.table + count * 8 > optionalStart + optionalSize)
    throw truncated(optionalStart + layout.count, `NumberOfRvaAndSizes ${declared} needs ${count * 8} data-directory bytes, past the ${optionalSize}-byte optional header`);
  const directories = {};
  for (let index = 0; index < count; index += 1) {
    const base = optionalStart + layout.table + index * 8;
    const rva = file.u32(base, true, `data directory ${index} RVA`);
    if (rva !== 0) directories[index] = { rva, size: file.u32(base + 4, true, `data directory ${index} size`), entryOffset: base };
  }
  return directories;
}

function peSections(file, tableStart, sectionCount) {
  const capacity = Number.isInteger(tableStart) && tableStart <= file.end ? Math.floor((file.end - tableStart) / 40) : 0;
  if (sectionCount > capacity) throw truncated(tableStart, `section table declares ${sectionCount} sections of 40 bytes at ${tableStart}, past ${file.end}`);
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const base = tableStart + index * 40;
    const characteristics = file.u32(base + 36, true, `section ${index} characteristics`);
    sections.push({
      name: readFixedString(file, base, 8),
      file_offset: file.u32(base + 20, true, `section ${index} PointerToRawData`),
      size: file.u32(base + 16, true, `section ${index} SizeOfRawData`),
      virtual_address: file.u32(base + 12, true, `section ${index} VirtualAddress`),
      virtual_size: file.u32(base + 8, true, `section ${index} VirtualSize`),
      kind: (characteristics & 0x20000000) !== 0 ? 'code' : (characteristics & 0x00000080) !== 0 ? 'bss' : 'data',
      permissions: { read: (characteristics & 0x40000000) !== 0, write: (characteristics & 0x80000000) !== 0, execute: (characteristics & 0x20000000) !== 0 },
    });
  }
  return sections;
}

function peRvaToOffset(sections, rva) {
  const found = sections.find((section) => section.size > 0 && rva >= section.virtual_address && rva < section.virtual_address + section.size);
  return found ? found.file_offset + (rva - found.virtual_address) : null;
}

function peString(file, sections, rva, fieldOffset, skip = 0) {
  const offset = peRvaToOffset(sections, rva);
  if (offset === null || !file.has(offset + skip, 1)) throw truncated(fieldOffset, `string RVA 0x${rva.toString(16)} (+${skip}) is not backed by any section's raw data`);
  return file.cstring(offset + skip, file.end - offset - skip);
}

function readPeImports(file, sections, bits, directory) {
  if (!directory) return { imports: [], libraries: [], notes: ['No import directory is declared in the PE data directory, so the import list is empty by declaration rather than by omission.'], partial: false };
  const base = peRvaToOffset(sections, directory.rva);
  if (base === null) throw truncated(directory.entryOffset, `import directory RVA 0x${directory.rva.toString(16)} is not backed by any section's raw data`);
  const declared = directory.size >= 20 ? Math.floor(directory.size / 20) : MAX_IMPORT_DESCRIPTORS;
  const limit = Math.min(declared, MAX_IMPORT_DESCRIPTORS);
  let partial = declared > limit;
  const imports = [];
  const libraries = [];
  const notes = [];
  for (let index = 0; index < limit; index += 1) {
    const descriptor = base + index * 20;
    need(file, descriptor, 20, `import descriptor ${index}`);
    const originalThunk = file.u32(descriptor, true, 'OriginalFirstThunk');
    const nameRva = file.u32(descriptor + 12, true, 'import descriptor Name');
    const firstThunk = file.u32(descriptor + 16, true, 'import descriptor FirstThunk');
    if (originalThunk === 0 && nameRva === 0 && firstThunk === 0) return { imports, libraries, notes, partial };
    const library = peString(file, sections, nameRva, descriptor + 12);
    libraries.push(library);
    const thunks = peThunks(file, sections, bits, originalThunk !== 0 ? originalThunk : firstThunk, library, descriptor + 8);
    imports.push(...thunks.imports);
    notes.push(...thunks.notes);
    partial = partial || thunks.partial;
    if (imports.length >= MAX_SYMBOLS) return { imports: imports.slice(0, MAX_SYMBOLS), libraries, notes: [...notes, `The import walk stopped at ${MAX_SYMBOLS} symbols.`], partial: true };
  }
  if (partial) notes.push(`The import directory declares ${declared} descriptors; the first ${limit} were read.`);
  return { imports, libraries, notes, partial };
}

function peThunks(file, sections, bits, thunkRva, library, fieldOffset) {
  const base = peRvaToOffset(sections, thunkRva);
  if (base === null) throw truncated(fieldOffset, `import thunk RVA 0x${thunkRva.toString(16)} for ${library} is not backed by section raw data`);
  const entrySize = bits === 64 ? 8 : 4;
  const highBit = bits === 64 ? 0x8000000000000000n : 0x80000000n;
  const imports = [];
  for (let index = 0; index < MAX_THUNKS_PER_LIBRARY; index += 1) {
    const field = base + index * entrySize;
    const raw = bits === 64 ? file.u64raw(field, true, `import thunk ${index} for ${library}`) : BigInt(file.u32(field, true, `import thunk ${index} for ${library}`));
    if (raw === 0n) return { imports, partial: false, notes: [] };
    imports.push({ name: (raw & highBit) !== 0n ? `#${raw & 0xffffn}` : peString(file, sections, Number(raw), field, 2), library, kind: 'function' });
  }
  return { imports, partial: true, notes: [`The import table for ${library} hit the ${MAX_THUNKS_PER_LIBRARY} thunk bound; imports beyond it were not read.`] };
}

function readPeExports(file, sections, directory) {
  if (!directory) return { exports: [], notes: ['No export directory is declared in the PE data directory, so the export list is empty by declaration rather than by omission.'], partial: false };
  const base = peRvaToOffset(sections, directory.rva);
  if (base === null) throw truncated(directory.entryOffset, `export directory RVA 0x${directory.rva.toString(16)} is not backed by any section's raw data`);
  need(file, base, 40, 'IMAGE_EXPORT_DIRECTORY');
  const functionCount = file.u32(base + 20, true, 'NumberOfFunctions');
  const nameCount = file.u32(base + 24, true, 'NumberOfNames');
  const functions = peRvaToOffset(sections, file.u32(base + 28, true, 'AddressOfFunctions'));
  const names = peRvaToOffset(sections, file.u32(base + 32, true, 'AddressOfNames'));
  const ordinals = peRvaToOffset(sections, file.u32(base + 36, true, 'AddressOfNameOrdinals'));
  if (functions === null || names === null || ordinals === null) throw truncated(base + 28, 'export tables (functions, names, ordinals) are not all backed by section raw data');
  const count = Math.min(nameCount, MAX_SYMBOLS);
  const exports = [];
  for (let index = 0; index < count; index += 1) {
    const nameRva = file.u32(names + index * 4, true, `export name ${index} RVA`);
    const ordinal = file.u16(ordinals + index * 2, true, `export name ${index} ordinal`);
    if (ordinal >= functionCount) continue;
    const functionRva = file.u32(functions + ordinal * 4, true, `export function ${ordinal} RVA`);
    exports.push({ name: peString(file, sections, nameRva, names + index * 4), kind: functionRva >= directory.rva && functionRva < directory.rva + directory.size ? 'forwarder' : 'function', virtual_address: functionRva });
  }
  const partial = nameCount > count;
  return { exports, notes: partial ? [`The export directory declares ${nameCount} names; the first ${count} were read.`] : [], partial };
}
