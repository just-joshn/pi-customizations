
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_ENTRIES = 32;

export interface ElfNotesInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'elf32' | 'elf64';
  readonly byte_order: 'little' | 'big';
  readonly machine: number;
  readonly type: number;
  readonly type_name: 'relocatable' | 'executable' | 'shared' | 'core' | 'unknown';
  readonly tables: readonly {
    readonly kind: 'program' | 'section';
    readonly index: number;
    readonly name: string | null;
    readonly location: { readonly offset: number; readonly bytes: number };
    readonly alignment: number;
  }[];
  readonly entries: readonly ElfNoteEntry[];
  readonly coverage: { readonly status: string; readonly examined_tables: number; readonly examined_entries: number };
  readonly limitations: readonly string[];
}

export interface ElfNoteEntry {
  readonly index: number;
  readonly table_kind: 'program' | 'section';
  readonly table_index: number;
  readonly location: { readonly offset: number; readonly bytes: number };
  readonly namesz: number;
  readonly descsz: number;
  readonly type: number;
  readonly type_name: 'gnu_abi_tag' | 'gnu_hwcap' | 'gnu_build_id' | 'gnu_gold_version' | 'gnu_property' | 'unknown';
  readonly owner: string;
  readonly owner_bytes_hex: string;
  readonly descriptor: {
    readonly location: { readonly offset: number; readonly bytes: number };
    readonly bytes: number;
    readonly sha256: string;
    readonly hex: string | null;
  };
  readonly gnu: {
    readonly build_id_hex: string | null;
    readonly abi_tag: { readonly os: number; readonly os_name: string | null; readonly major: number; readonly minor: number; readonly subminor: number } | null;
    readonly gold_version: string | null;
  } | null;
}

export const ELF_NOTE_LIMITATIONS = [
  'This workflow does not execute the image, resolve runtime notes, or verify GNU build-id uniqueness against package catalogs.',
  'PT_NOTE and SHT_NOTE are examined independently; the same file range may appear twice when both tables declare it.',
];

const PT_NOTE = 4;
const SHT_NOTE = 7;
const HEX_PREVIEW = 64;

const typeName = (type: number): ElfNotesInspection['type_name'] => {
  if (type === 1) return 'relocatable';
  if (type === 2) return 'executable';
  if (type === 3) return 'shared';
  if (type === 4) return 'core';
  return 'unknown';
};

const gnuTypeName = (owner: string, type: number): ElfNoteEntry['type_name'] => {
  if (owner !== 'GNU') return 'unknown';
  if (type === 1) return 'gnu_abi_tag';
  if (type === 2) return 'gnu_hwcap';
  if (type === 3) return 'gnu_build_id';
  if (type === 4) return 'gnu_gold_version';
  if (type === 5) return 'gnu_property';
  return 'unknown';
};

const abiOsName = (os: number): string | null => {
  if (os === 0) return 'Linux';
  if (os === 1) return 'GNU';
  if (os === 2) return 'Solaris';
  if (os === 3) return 'FreeBSD';
  return null;
};

const alignUp = (value: number, alignment: number): number => (alignment <= 1 ? value : (value + alignment - 1) & ~(alignment - 1));

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_elf_notes',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const readU16 = (bytes: Buffer, offset: number, little: boolean): number => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
const readU32 = (bytes: Buffer, offset: number, little: boolean): number => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
const readU64 = (bytes: Buffer, offset: number, little: boolean): number => {
  const value = little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('u64 exceeds safe integer');
  return Number(value);
};

const parseNotes = (
  bytes: Buffer,
  start: number,
  size: number,
  alignment: number,
  little: boolean,
  tableKind: 'program' | 'section',
  tableIndex: number,
  maxEntries: number,
  entries: ElfNoteEntry[],
): void => {
  let offset = start;
  const end = start + size;
  while (offset + 12 <= end) {
    if (entries.length >= maxEntries) throw new Error('note entry budget exceeded');
    const namesz = readU32(bytes, offset, little);
    const descsz = readU32(bytes, offset + 4, little);
    const type = readU32(bytes, offset + 8, little);
    const nameStart = offset + 12;
    const nameEnd = nameStart + namesz;
    const descStart = alignUp(nameEnd, alignment);
    const descEnd = descStart + descsz;
    const noteEnd = alignUp(descEnd, alignment);
    if (namesz < 0 || descsz < 0 || noteEnd > end || descEnd > end) throw new Error('truncated note entry');
    const ownerBytes = bytes.subarray(nameStart, nameEnd);
    const ownerRaw = ownerBytes.length > 0 && ownerBytes[ownerBytes.length - 1] === 0 ? ownerBytes.subarray(0, ownerBytes.length - 1) : ownerBytes;
    const owner = ownerRaw.toString('utf8');
    const descriptor = bytes.subarray(descStart, descEnd);
    const typeLabel = gnuTypeName(owner, type);
    let gnu: ElfNoteEntry['gnu'] = null;
    if (owner === 'GNU') {
      let buildId: string | null = null;
      let abi: { os: number; os_name: string | null; major: number; minor: number; subminor: number } | null = null;
      let gold: string | null = null;
      if (typeLabel === 'gnu_build_id') buildId = descriptor.toString('hex');
      if (typeLabel === 'gnu_abi_tag' && descriptor.length >= 16) {
        const os = readU32(descriptor, 0, little);
        abi = {
          os,
          os_name: abiOsName(os),
          major: readU32(descriptor, 4, little),
          minor: readU32(descriptor, 8, little),
          subminor: readU32(descriptor, 12, little),
        };
      }
      if (typeLabel === 'gnu_gold_version') gold = descriptor.toString('utf8').replace(/\0+$/, '');
      gnu = { build_id_hex: buildId, abi_tag: abi, gold_version: gold };
    }
    entries.push({
      index: entries.length,
      table_kind: tableKind,
      table_index: tableIndex,
      location: { offset, bytes: noteEnd - offset },
      namesz,
      descsz,
      type,
      type_name: typeLabel,
      owner,
      owner_bytes_hex: ownerBytes.toString('hex'),
      descriptor: {
        location: { offset: descStart, bytes: descsz },
        bytes: descsz,
        sha256: createHash('sha256').update(descriptor).digest('hex'),
        hex: descsz === 0 ? null : descriptor.subarray(0, Math.min(HEX_PREVIEW, descsz)).toString('hex'),
      },
      gnu,
    });
    offset = noteEnd;
  }
};

export interface ElfNotesOptions {
  readonly maxFileBytes?: number;
  readonly maxEntries?: number;
  readonly cwd?: string;
}

export const inspectElfNotesFromPath = async (
  path: string,
  options: ElfNotesOptions = {},
): Promise<{ record: ElfNotesInspection; path: string; resolvedPath: string }> => {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 64 || maxFileBytes > 536_870_912) {
    throw inputError(path, 'invalid_value', 'max_file_bytes must be an integer between 64 and 536870912.');
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) {
    throw inputError(path, 'invalid_value', 'max_entries must be an integer between 1 and 256.');
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }
  if (bytes.length > maxFileBytes) throw inputError(path, 'invalid_value', `the image is ${bytes.length} bytes, more than the ${maxFileBytes} byte limit`);
  if (bytes.length < 16 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    throw inputError(path, 'invalid_format', 'the file is not an ELF image.');
  }

  const bits = bytes[4] === 2 ? 64 : bytes[4] === 1 ? 32 : null;
  const little = bytes[5] === 1;
  if (bits === null || (bytes[5] !== 1 && bytes[5] !== 2)) throw inputError(path, 'invalid_format', 'unsupported ELF class or endianness.');

  try {
    const ehsize = bits === 64 ? 64 : 52;
    if (bytes.length < ehsize) throw new Error('truncated ELF header');
    const type = readU16(bytes, 16, little);
    const machine = readU16(bytes, 18, little);
    const phoff = bits === 64 ? readU64(bytes, 32, little) : readU32(bytes, 28, little);
    const shoff = bits === 64 ? readU64(bytes, 40, little) : readU32(bytes, 32, little);
    const phentsize = readU16(bytes, bits === 64 ? 54 : 42, little);
    const phnum = readU16(bytes, bits === 64 ? 56 : 44, little);
    const shentsize = readU16(bytes, bits === 64 ? 58 : 46, little);
    const shnum = readU16(bytes, bits === 64 ? 60 : 48, little);
    const shstrndx = readU16(bytes, bits === 64 ? 62 : 50, little);

    const tables: {
      kind: 'program' | 'section';
      index: number;
      name: string | null;
      location: { offset: number; bytes: number };
      alignment: number;
    }[] = [];
    const entries: ElfNoteEntry[] = [];

    for (let index = 0; index < phnum; index += 1) {
      const at = phoff + index * phentsize;
      if (at + phentsize > bytes.length) throw new Error('truncated program header');
      const pType = readU32(bytes, at, little);
      if (pType !== PT_NOTE) continue;
      const pOffset = bits === 64 ? readU64(bytes, at + 8, little) : readU32(bytes, at + 4, little);
      const pFilesz = bits === 64 ? readU64(bytes, at + 32, little) : readU32(bytes, at + 16, little);
      const pAlign = bits === 64 ? readU64(bytes, at + 48, little) : readU32(bytes, at + 28, little);
      const alignment = pAlign === 0 ? 4 : Number(pAlign);
      tables.push({ kind: 'program', index, name: null, location: { offset: pOffset, bytes: pFilesz }, alignment });
      parseNotes(bytes, pOffset, pFilesz, alignment <= 8 ? alignment : 4, little, 'program', index, maxEntries, entries);
    }

    let shstr: Buffer | null = null;
    if (shnum > 0 && shstrndx < shnum) {
      const at = shoff + shstrndx * shentsize;
      const offset = bits === 64 ? readU64(bytes, at + 24, little) : readU32(bytes, at + 16, little);
      const size = bits === 64 ? readU64(bytes, at + 32, little) : readU32(bytes, at + 20, little);
      if (offset + size <= bytes.length) shstr = bytes.subarray(offset, offset + size);
    }

    for (let index = 0; index < shnum; index += 1) {
      const at = shoff + index * shentsize;
      if (at + shentsize > bytes.length) throw new Error('truncated section header');
      const nameOffset = readU32(bytes, at, little);
      const shType = readU32(bytes, at + 4, little);
      if (shType !== SHT_NOTE) continue;
      const offset = bits === 64 ? readU64(bytes, at + 24, little) : readU32(bytes, at + 16, little);
      const size = bits === 64 ? readU64(bytes, at + 32, little) : readU32(bytes, at + 20, little);
      const addralign = bits === 64 ? readU64(bytes, at + 48, little) : readU32(bytes, at + 32, little);
      let name: string | null = null;
      if (shstr !== null && nameOffset < shstr.length) {
        const end = shstr.indexOf(0, nameOffset);
        name = shstr.subarray(nameOffset, end === -1 ? shstr.length : end).toString('utf8');
      }
      const alignment = addralign === 0 ? 4 : Number(addralign);
      tables.push({ kind: 'section', index, name, location: { offset, bytes: size }, alignment });
      parseNotes(bytes, offset, size, alignment <= 8 ? alignment : 4, little, 'section', index, maxEntries, entries);
    }

    return {
      path,
      resolvedPath,
      record: {
        artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
        format: bits === 64 ? 'elf64' : 'elf32',
        byte_order: little ? 'little' : 'big',
        machine,
        type,
        type_name: typeName(type),
        tables,
        entries,
        coverage: { status: 'complete', examined_tables: tables.length, examined_entries: entries.length },
        limitations: [...ELF_NOTE_LIMITATIONS],
      },
    };
  } catch (error) {
    if (error instanceof Error && 'payload' in error) throw error;
    if (String((error as Error).message).includes('budget')) {
      throw inputError(path, 'invalid_value', `the note tables exceed the ${maxEntries} entry limit`);
    }
    throw inputError(path, 'invalid_format', (error as Error).message);
  }
};
