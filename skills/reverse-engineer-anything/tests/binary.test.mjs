import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { digestOf } from '../scripts/lib/canonical.mjs';
import { detectFormat, FormatError, readBinaryLayout } from '../scripts/lib/formats/binary.mjs';

/* ------------------------------------------------------------- builders -- */

const MACHO_ENTRY_OFFSET = 0x168;
const MACHO_TEXT_OFFSET = 0x168;
const MACHO_FILE_SIZE = 0x1a0;

function writeSegment64(buffer, offset, { fileoff, filesize, initprot }) {
  buffer.writeUInt32LE(0x19, offset);
  buffer.writeUInt32LE(152, offset + 4);
  buffer.write('__TEXT', offset + 8, 16, 'latin1');
  buffer.writeBigUInt64LE(0x100000000n, offset + 24);
  buffer.writeBigUInt64LE(0x1000n, offset + 32);
  buffer.writeBigUInt64LE(BigInt(fileoff), offset + 40);
  buffer.writeBigUInt64LE(BigInt(filesize), offset + 48);
  buffer.writeUInt32LE(7, offset + 56);
  buffer.writeUInt32LE(initprot, offset + 60);
  buffer.writeUInt32LE(1, offset + 64);
}

function writeSection64(buffer, offset, { addr, size, fileOffset, flags }) {
  buffer.write('__text', offset, 16, 'latin1');
  buffer.write('__TEXT', offset + 16, 16, 'latin1');
  buffer.writeBigUInt64LE(BigInt(addr), offset + 32);
  buffer.writeBigUInt64LE(BigInt(size), offset + 40);
  buffer.writeUInt32LE(fileOffset, offset + 48);
  buffer.writeUInt32LE(4, offset + 52);
  buffer.writeUInt32LE(flags, offset + 64);
}

/** The smallest valid 64-bit arm64 Mach-O with a segment, section, main, UUID, dylib, symtab and linkedit data. */
function buildMachO64() {
  const buffer = Buffer.alloc(MACHO_FILE_SIZE);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(0x0100000c, 4);
  buffer.writeUInt32LE(2, 12);
  buffer.writeUInt32LE(6, 16);
  buffer.writeUInt32LE(328, 20);
  buffer.writeUInt32LE(0x00200085, 24);
  writeSegment64(buffer, 32, { fileoff: 0, filesize: MACHO_FILE_SIZE, initprot: 5 });
  writeSection64(buffer, 104, { addr: 0x100000000 + MACHO_TEXT_OFFSET, size: 8, fileOffset: MACHO_TEXT_OFFSET, flags: 0x80000400 });
  Buffer.from([0x90, 0x90, 0x90, 0xc3, 0x90, 0x90, 0x90, 0x90]).copy(buffer, MACHO_TEXT_OFFSET);
  buffer.writeUInt32LE(0x80000028, 184);
  buffer.writeUInt32LE(24, 188);
  buffer.writeBigUInt64LE(BigInt(MACHO_ENTRY_OFFSET), 192);
  buffer.writeUInt32LE(0x1b, 208);
  buffer.writeUInt32LE(24, 212);
  Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).copy(buffer, 216);
  buffer.writeUInt32LE(0xc, 232);
  buffer.writeUInt32LE(56, 236);
  buffer.writeUInt32LE(24, 240);
  buffer.write('/usr/lib/libSystem.B.dylib', 256, 27, 'latin1');
  buffer.writeUInt32LE(0x2, 288);
  buffer.writeUInt32LE(24, 292);
  buffer.writeUInt32LE(0x170, 296);
  buffer.writeUInt32LE(1, 300);
  buffer.writeUInt32LE(0x180, 304);
  buffer.writeUInt32LE(9, 308);
  buffer.writeUInt32LE(0x80000022, 312);
  buffer.writeUInt32LE(48, 316);
  buffer.writeUInt32LE(0x190, 352);
  buffer.writeUInt32LE(14, 356);
  buffer.writeUInt32LE(1, 0x170);
  buffer.writeUInt8(0x01, 0x174);
  buffer.write('\0_printf\0', 0x180, 9, 'latin1');
  Buffer.from([0x00, 0x01, 0x5f, 0x6d, 0x61, 0x69, 0x6e, 0x00, 0x09, 0x03, 0x00, 0x80, 0x20, 0x00]).copy(buffer, 0x190);
  return buffer;
}

function writePhdr64(buffer, offset, type, flags, fileOffset, vaddr, filesz, memsz) {
  buffer.writeUInt32LE(type, offset);
  buffer.writeUInt32LE(flags, offset + 4);
  buffer.writeBigUInt64LE(BigInt(fileOffset), offset + 8);
  buffer.writeBigUInt64LE(BigInt(vaddr), offset + 16);
  buffer.writeBigUInt64LE(BigInt(vaddr), offset + 24);
  buffer.writeBigUInt64LE(BigInt(filesz), offset + 32);
  buffer.writeBigUInt64LE(BigInt(memsz), offset + 40);
  buffer.writeBigUInt64LE(0x1000n, offset + 48);
}

function writeShdr64(buffer, offset, section, nameOffset) {
  buffer.writeUInt32LE(nameOffset, offset);
  buffer.writeUInt32LE(section.type, offset + 4);
  buffer.writeBigUInt64LE(BigInt(section.flags), offset + 8);
  buffer.writeBigUInt64LE(BigInt(section.addr), offset + 16);
  buffer.writeBigUInt64LE(BigInt(section.offset), offset + 24);
  buffer.writeBigUInt64LE(BigInt(section.size), offset + 32);
  buffer.writeUInt32LE(section.link, offset + 40);
  buffer.writeUInt32LE(0, offset + 44);
  buffer.writeBigUInt64LE(1n, offset + 48);
  buffer.writeBigUInt64LE(BigInt(section.entsize), offset + 56);
}

/** .dynsym with two undefined globals, __stack_chk_fail and __printf_chk. */
function writeElfDynsym(buffer, dynstr) {
  const dynsym = Buffer.alloc(72);
  dynsym.writeUInt32LE(dynstr.indexOf('__stack_chk_fail'), 24);
  dynsym.writeUInt8(0x12, 28);
  dynsym.writeUInt32LE(dynstr.indexOf('__printf_chk'), 48);
  dynsym.writeUInt8(0x12, 52);
  dynsym.copy(buffer, 0x1100);
}

/** .dynamic tag/value pairs, written as 64-bit entries at 0x1300. */
function writeElfDynamic(buffer, entries) {
  for (const [index, [tag, value]] of entries.entries()) {
    buffer.writeBigUInt64LE(BigInt(tag), 0x1300 + index * 16);
    buffer.writeBigUInt64LE(BigInt(value), 0x1308 + index * 16);
  }
}

/** The smallest valid ELF64 little-endian x86-64 executable with headers, .dynamic and option .dynsym. */
function buildElf({ symbols = true } = {}) {
  const buffer = Buffer.alloc(0x1700);
  const dynstr = Buffer.from('\0__stack_chk_fail\0__printf_chk\0libc.so.6\0', 'latin1');
  const shstrtab = Buffer.from('\0.text\0.dynsym\0.dynstr\0.dynamic\0.shstrtab\0', 'latin1');
  const names = ['', '.text', '.dynsym', '.dynstr', '.dynamic', '.shstrtab'];
  const defs = [
    { name: '', type: 0, flags: 0, addr: 0, offset: 0, size: 0, link: 0, entsize: 0 },
    { name: '.text', type: 1, flags: 6, addr: 0x401000, offset: 0x100, size: 8, link: 0, entsize: 0 },
    ...(symbols ? [{ name: '.dynsym', type: 11, flags: 2, addr: 0x411000, offset: 0x1100, size: 72, link: names.indexOf('.dynstr'), entsize: 24 }] : []),
    { name: '.dynstr', type: 3, flags: 2, addr: 0x401200, offset: 0x1200, size: dynstr.length, link: 0, entsize: 0 },
    { name: '.dynamic', type: 6, flags: 3, addr: 0x401300, offset: 0x1300, size: 80, link: names.indexOf('.dynstr'), entsize: 16 },
    { name: '.shstrtab', type: 3, flags: 0, addr: 0, offset: 0x1400, size: shstrtab.length, link: 0, entsize: 0 },
  ];
  buffer.writeUInt8(0x7f, 0);
  buffer.write('ELF', 1, 'latin1');
  buffer.writeUInt8(2, 4);
  buffer.writeUInt8(1, 5);
  buffer.writeUInt8(1, 6);
  buffer.writeUInt16LE(2, 16);
  buffer.writeUInt16LE(0x3e, 18);
  buffer.writeUInt32LE(1, 20);
  buffer.writeBigUInt64LE(0x401000n, 24);
  buffer.writeBigUInt64LE(64n, 32);
  buffer.writeBigUInt64LE(0x1500n, 40);
  buffer.writeUInt16LE(64, 52);
  buffer.writeUInt16LE(56, 54);
  buffer.writeUInt16LE(3, 56);
  buffer.writeUInt16LE(64, 58);
  buffer.writeUInt16LE(defs.length, 60);
  buffer.writeUInt16LE(defs.length - 1, 62);
  writePhdr64(buffer, 64, 1, 5, 0, 0x400000, buffer.length, buffer.length);
  writePhdr64(buffer, 120, 0x6474e551, 6, 0, 0, 0, 0);
  writePhdr64(buffer, 176, 0x6474e552, 4, 0xf00, 0x400f00, 0x100, 0x100);
  Buffer.from([0x90, 0x90, 0x90, 0xc3, 0x90, 0x90, 0x90, 0x90]).copy(buffer, 0x100);
  dynstr.copy(buffer, 0x1200);
  if (symbols) writeElfDynsym(buffer, dynstr);
  writeElfDynamic(buffer, [
    [1, dynstr.indexOf('libc.so.6')],
    [5, 0x401200],
    [10, dynstr.length],
    [24, 0],
    [0, 0],
  ]);
  shstrtab.copy(buffer, 0x1400);
  for (const [index, def] of defs.entries()) writeShdr64(buffer, 0x1500 + index * 64, def, def.name === '' ? 0 : shstrtab.indexOf(def.name));
  return buffer;
}

/** A minimal big-endian ELF32 with one PT_LOAD and two named sections, to exercise the other class and byte order. */
function buildElf32Be() {
  const buffer = Buffer.alloc(224);
  const shstrtab = Buffer.from('\0.text\0.shstrtab\0', 'latin1');
  buffer.writeUInt8(0x7f, 0);
  buffer.write('ELF', 1, 'latin1');
  buffer.writeUInt8(1, 4);
  buffer.writeUInt8(2, 5);
  buffer.writeUInt8(1, 6);
  buffer.writeUInt16BE(2, 16);
  buffer.writeUInt16BE(0x03, 18);
  buffer.writeUInt32BE(1, 20);
  buffer.writeUInt32BE(0x08048054, 24);
  buffer.writeUInt32BE(52, 28);
  buffer.writeUInt32BE(104, 32);
  buffer.writeUInt16BE(52, 40);
  buffer.writeUInt16BE(32, 42);
  buffer.writeUInt16BE(1, 44);
  buffer.writeUInt16BE(40, 46);
  buffer.writeUInt16BE(3, 48);
  buffer.writeUInt16BE(2, 50);
  buffer.writeUInt32BE(1, 52);
  buffer.writeUInt32BE(0, 56);
  buffer.writeUInt32BE(0x08048000, 60);
  buffer.writeUInt32BE(0x08048000, 64);
  buffer.writeUInt32BE(buffer.length, 68);
  buffer.writeUInt32BE(buffer.length, 72);
  buffer.writeUInt32BE(5, 76);
  buffer.writeUInt32BE(0x1000, 80);
  Buffer.from([0x90, 0x90, 0x90, 0xc3]).copy(buffer, 84);
  shstrtab.copy(buffer, 88);
  const sections = [
    { name: 0, type: 0, flags: 0, addr: 0, offset: 0, size: 0, link: 0, entsize: 0 },
    { name: 1, type: 1, flags: 6, addr: 0x08048054, offset: 84, size: 4, link: 0, entsize: 0 },
    { name: 7, type: 3, flags: 0, addr: 0, offset: 88, size: shstrtab.length, link: 0, entsize: 0 },
  ];
  for (const [index, section] of sections.entries()) {
    const base = 104 + index * 40;
    buffer.writeUInt32BE(section.name, base);
    buffer.writeUInt32BE(section.type, base + 4);
    buffer.writeUInt32BE(section.flags, base + 8);
    buffer.writeUInt32BE(section.addr, base + 12);
    buffer.writeUInt32BE(section.offset, base + 16);
    buffer.writeUInt32BE(section.size, base + 20);
    buffer.writeUInt32BE(section.link, base + 24);
    buffer.writeUInt32BE(section.entsize, base + 36);
  }
  return buffer;
}

/** The import directory: one KERNEL32!ExitProcess descriptor followed by the null terminator. */
function writePeImportData(buffer) {
  buffer.writeUInt32LE(0x1030, 0x200);
  buffer.writeUInt32LE(0x1060, 0x20c);
  buffer.writeUInt32LE(0x1040, 0x210);
  buffer.writeBigUInt64LE(0x1070n, 0x230);
  buffer.writeBigUInt64LE(0x1070n, 0x240);
  buffer.write('KERNEL32.dll\0', 0x260, 'latin1');
  buffer.writeUInt16LE(0, 0x270);
  buffer.write('ExitProcess\0', 0x272, 'latin1');
}

/** The export directory: one named export, ExportedThing, at RVA 0x1000. */
function writePeExportData(buffer) {
  buffer.writeUInt32LE(0, 0x280);
  buffer.writeUInt32LE(1, 0x290);
  buffer.writeUInt32LE(0x10a8, 0x28c);
  buffer.writeUInt32LE(1, 0x294);
  buffer.writeUInt32LE(1, 0x298);
  buffer.writeUInt32LE(0x10b4, 0x29c);
  buffer.writeUInt32LE(0x10b8, 0x2a0);
  buffer.writeUInt32LE(0x10bc, 0x2a4);
  buffer.write('test.dll\0', 0x2a8, 'latin1');
  buffer.writeUInt32LE(0x1000, 0x2b4);
  buffer.writeUInt32LE(0x10c0, 0x2b8);
  buffer.writeUInt16LE(0, 0x2bc);
  buffer.write('ExportedThing\0', 0x2c0, 'latin1');
}

/** A minimal PE32+ x86-64 executable with one import (KERNEL32!ExitProcess) and one export. */
function buildPe() {
  const buffer = Buffer.alloc(0x400);
  buffer.write('MZ', 0, 'latin1');
  buffer.writeUInt32LE(0x40, 0x3c);
  buffer.write('PE\0\0', 0x40, 'latin1');
  buffer.writeUInt16LE(0x8664, 0x44);
  buffer.writeUInt16LE(1, 0x46);
  buffer.writeUInt16LE(0xf0, 0x54);
  buffer.writeUInt16LE(0x0022, 0x56);
  const optional = 0x58;
  buffer.writeUInt16LE(0x20b, optional);
  buffer.writeUInt32LE(0x200, optional + 4);
  buffer.writeUInt32LE(0x1000, optional + 16);
  buffer.writeUInt32LE(0x1000, optional + 20);
  buffer.writeBigUInt64LE(0x140000000n, optional + 24);
  buffer.writeUInt32LE(0x1000, optional + 32);
  buffer.writeUInt32LE(0x200, optional + 36);
  buffer.writeUInt32LE(0x2000, optional + 56);
  buffer.writeUInt32LE(0x200, optional + 60);
  buffer.writeUInt16LE(3, optional + 68);
  buffer.writeUInt16LE(0x0160, optional + 70);
  buffer.writeBigUInt64LE(0x100000n, optional + 72);
  buffer.writeBigUInt64LE(0x1000n, optional + 80);
  buffer.writeBigUInt64LE(0x100000n, optional + 88);
  buffer.writeBigUInt64LE(0x1000n, optional + 96);
  buffer.writeUInt32LE(16, optional + 108);
  buffer.writeUInt32LE(0x1080, optional + 112);
  buffer.writeUInt32LE(40, optional + 116);
  buffer.writeUInt32LE(0x1000, optional + 120);
  buffer.writeUInt32LE(40, optional + 124);
  const section = optional + 0xf0;
  buffer.write('.text', section, 'latin1');
  buffer.writeUInt32LE(0x200, section + 8);
  buffer.writeUInt32LE(0x1000, section + 12);
  buffer.writeUInt32LE(0x200, section + 16);
  buffer.writeUInt32LE(0x200, section + 20);
  buffer.writeUInt32LE(0x60000020, section + 36);
  writePeImportData(buffer);
  writePeExportData(buffer);
  return buffer;
}

function capture(bytes) {
  try {
    return { result: readBinaryLayout(bytes), error: null };
  } catch (error) {
    return { result: null, error };
  }
}

/* ---------------------------------------------------------------- tests -- */

test('BIN-001: mach-o, elf and pe facts are read from bytes', () => {
  const macho = buildMachO64();
  const result = readBinaryLayout(macho);
  assert.equal(result.format, 'mach-o');
  assert.equal(result.bits, 64);
  assert.equal(result.endianness, 'little');
  assert.equal(result.architecture, 'arm64');
  assert.equal(result.file_type, 'executable');
  assert.equal(result.entrypoint, MACHO_ENTRY_OFFSET);
  assert.deepEqual(result.segments.find((segment) => segment.name === '__TEXT').permissions, { read: true, write: false, execute: true });
  assert.equal(result.sections.find((section) => section.name === '__text').segment, '__TEXT');
  assert.equal(result.sections.find((section) => section.name === '__text').kind, 'code');
  assert.equal(result.uuid, '01020304-0506-0708-090a-0b0c0d0e0f10');
  assert.deepEqual(result.libraries, ['/usr/lib/libSystem.B.dylib']);
  assert.deepEqual(result.symbols.imports, [{ name: '_printf', library: null, kind: 'unknown' }]);
  assert.deepEqual(result.symbols.exports, []);
  assert.equal(result.symbols.table, 'symtab');
  assert.equal(result.symbols.coverage.status, 'partial');
  assert.ok(result.symbols.coverage.limits.some((text) => /export trie/i.test(text)));
  assert.deepEqual(result.slices, []);
  assert.equal(result.digests.sha256, digestOf(macho));

  const elf = buildElf();
  const elfResult = readBinaryLayout(elf);
  assert.equal(elfResult.format, 'elf');
  assert.equal(elfResult.bits, 64);
  assert.equal(elfResult.endianness, 'little');
  assert.equal(elfResult.architecture, 'x86_64');
  assert.equal(elfResult.file_type, 'executable');
  assert.equal(elfResult.entrypoint, 0x401000);
  assert.equal(elfResult.segments.find((segment) => segment.name === 'PT_LOAD').permissions.execute, true);
  assert.equal(elfResult.sections.find((section) => section.name === '.text').kind, 'code');
  assert.equal(elfResult.sections.find((section) => section.name === '.text').segment, 'PT_LOAD');
  assert.deepEqual(elfResult.libraries, ['libc.so.6']);
  assert.equal(elfResult.digests.sha256, digestOf(elf));

  const pe = buildPe();
  const peResult = readBinaryLayout(pe);
  assert.equal(peResult.format, 'pe');
  assert.equal(peResult.bits, 64);
  assert.equal(peResult.endianness, 'little');
  assert.equal(peResult.architecture, 'x86_64');
  assert.equal(peResult.file_type, 'executable');
  assert.equal(peResult.entrypoint, 0x1000);
  assert.equal(peResult.segments.find((segment) => segment.name === '.text').permissions.execute, true);
  assert.equal(peResult.sections.find((section) => section.name === '.text').kind, 'code');
  assert.deepEqual(peResult.libraries, ['KERNEL32.dll']);
  assert.deepEqual(peResult.symbols.imports, [{ name: 'ExitProcess', library: 'KERNEL32.dll', kind: 'function' }]);
  assert.deepEqual(peResult.symbols.exports, [{ name: 'ExportedThing', kind: 'function', virtual_address: 0x1000 }]);
  assert.equal(peResult.symbols.table, 'import-directory+export-directory');
  assert.equal(peResult.digests.sha256, digestOf(pe));

  const elf32 = buildElf32Be();
  const beResult = readBinaryLayout(elf32);
  assert.equal(beResult.format, 'elf');
  assert.equal(beResult.bits, 32);
  assert.equal(beResult.endianness, 'big');
  assert.equal(beResult.architecture, 'x86');
  assert.equal(beResult.entrypoint, 0x08048054);
  assert.equal(beResult.sections.find((section) => section.name === '.text').kind, 'code');
});

test('BIN-002: a stripped binary reports unavailable symbol coverage', () => {
  const elf = readBinaryLayout(buildElf({ symbols: false }));
  assert.equal(elf.symbols.coverage.status, 'unavailable');
  assert.equal(elf.symbols.table, 'none');
  assert.deepEqual(elf.symbols.imports, []);
  assert.deepEqual(elf.symbols.exports, []);
  assert.ok(elf.limitations.some((text) => /not evidence that the file imports or exports nothing/i.test(text)));
  assert.deepEqual(elf.libraries, ['libc.so.6']);
});

test('BIN-003: mitigations cite their marker', () => {
  const elf = readBinaryLayout(buildElf());
  for (const mitigation of elf.mitigations) {
    assert.equal(typeof mitigation.marker, 'string');
    assert.ok(mitigation.marker.length > 0, `${mitigation.name} has an empty marker`);
  }
  const relro = elf.mitigations.find((mitigation) => mitigation.name === 'relro');
  assert.equal(relro.value, 'full');
  assert.match(relro.marker, /PT_GNU_RELRO/);
  assert.match(relro.marker, /DT_BIND_NOW|DF_BIND_NOW/);
  const canary = elf.mitigations.find((mitigation) => mitigation.name === 'stack-canary');
  assert.equal(canary.value, true);
  assert.match(canary.marker, /__stack_chk_fail/);
  assert.match(canary.marker, /\.dynsym/);
  const fortify = elf.mitigations.find((mitigation) => mitigation.name === 'fortify');
  assert.equal(fortify.value, true);
  assert.match(fortify.marker, /__printf_chk/);
  const nx = elf.mitigations.find((mitigation) => mitigation.name === 'nx');
  assert.equal(nx.value, true);
  assert.match(nx.marker, /PT_GNU_STACK/);
  const pie = elf.mitigations.find((mitigation) => mitigation.name === 'pie');
  assert.equal(pie.value, false);
  assert.match(pie.marker, /e_type=ET_EXEC/);
});

test('BIN-004: elf on darwin is read with an explicit deviation limitation', () => {
  const elf = readBinaryLayout(buildElf());
  assert.ok(Array.isArray(elf.limitations));
  assert.ok(elf.limitations.length > 0);
  assert.ok(elf.limitations.some((text) => /pwntools/i.test(text) && /linux x64/i.test(text) && /platform departure/i.test(text)));
});

test('BIN-005: truncated and out-of-range structures fail closed', () => {
  const fourBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
  const machoWithHugeCommandCount = buildMachO64();
  machoWithHugeCommandCount.writeUInt32LE(0xffff, 16);
  const elfWithSectionOffsetPastEnd = buildElf();
  elfWithSectionOffsetPastEnd.writeBigUInt64LE(0xffffn, 40);
  const peWithOversizedOptionalHeader = buildPe();
  peWithOversizedOptionalHeader.writeUInt16LE(0x700, 0x54);

  for (const bytes of [fourBytes, machoWithHugeCommandCount, elfWithSectionOffsetPastEnd, peWithOversizedOptionalHeader]) {
    const { error } = capture(bytes);
    assert.ok(error instanceof FormatError, `expected FormatError, got ${error}`);
    assert.equal(typeof error.offset, 'number');
  }

  const adversarial = [
    Buffer.alloc(0),
    Buffer.alloc(64),
    Buffer.from(`MZ${'A'.repeat(62)}`, 'latin1'),
    Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(600)]),
    Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(600)]),
  ];
  for (const bytes of adversarial) {
    const { error } = capture(bytes);
    assert.ok(error === null || error instanceof FormatError, `expected a result or FormatError, got ${error}`);
  }
});

test('BIN-006: a real host binary is read when present', (t) => {
  const path = ['/opt/homebrew/bin/gh', '/bin/ls'].find((candidate) => existsSync(candidate));
  if (!path) {
    t.skip('no host Mach-O binary at /opt/homebrew/bin/gh or /bin/ls');
    return;
  }
  const bytes = readFileSync(path);
  assert.equal(detectFormat(bytes), 'mach-o');
  const result = readBinaryLayout(bytes);
  assert.equal(result.format, 'mach-o');
  assert.ok(result.bits === 32 || result.bits === 64);
  assert.ok(result.segments.length > 0);
  assert.match(result.digests.sha256, /^[0-9a-f]{64}$/);
});
