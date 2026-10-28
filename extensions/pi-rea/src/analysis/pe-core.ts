
import { invalidRequest } from '../contract/errors.ts';

export const DOS_MAGIC = 0x5a4d;
export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;

export const PE_MACHINES: Record<number, string> = {
  0x014c: 'x86',
  0x8664: 'x86_64',
  0xaa64: 'arm64',
  0x01c0: 'arm',
  0x01c4: 'arm',
  0x5032: 'riscv',
  0x5064: 'riscv64',
};

export const DIR = {
  EXPORT: 0,
  IMPORT: 1,
  RESOURCE: 2,
  EXCEPTION: 3,
  SECURITY: 4,
  BASERELOC: 5,
  DEBUG: 6,
  ARCHITECTURE: 7,
  GLOBALPTR: 8,
  TLS: 9,
  LOAD_CONFIG: 10,
  BOUND_IMPORT: 11,
  IAT: 12,
  DELAY_IMPORT: 13,
  CLR: 14,
} as const;

export interface PeFileLocation {
  readonly offset: number;
  readonly bytes: number;
}

export interface PeSection {
  readonly name: string;
  readonly virtualAddress: number;
  readonly virtualSize: number;
  readonly rawOffset: number;
  readonly rawSize: number;
}

export interface PeDataDirectory {
  readonly rva: number;
  readonly size: number;
  readonly entryOffset: number;
}

export interface PeImage {
  readonly format: 'pe32' | 'pe32-plus';
  readonly machine: number;
  readonly bits: 32 | 64;
  readonly architecture: string;
  readonly imageBase: bigint;
  readonly sections: readonly PeSection[];
  readonly directories: Readonly<Record<number, PeDataDirectory>>;
  readonly peOffset: number;
  readonly optionalStart: number;
}

export const peInputError = (operation: string, path: string, reason: string, detail: string): ReturnType<typeof invalidRequest> =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation,
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const readName = (bytes: Buffer, offset: number, length: number): string => {
  const raw = bytes.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
};

export const parsePeImage = (bytes: Buffer): PeImage => {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== DOS_MAGIC) throw new Error('not an MZ image');
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 24 > bytes.length || bytes.subarray(peOffset, peOffset + 4).toString('latin1') !== 'PE\0\0') {
    throw new Error('no PE signature');
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  const sectionCount = bytes.readUInt16LE(peOffset + 6);
  const optionalSize = bytes.readUInt16LE(peOffset + 20);
  const optionalStart = peOffset + 24;
  if (optionalStart + optionalSize > bytes.length) throw new Error('truncated optional header');
  const magic = bytes.readUInt16LE(optionalStart);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('unsupported optional header magic');
  const bits: 32 | 64 = magic === 0x20b ? 64 : 32;
  const format = bits === 64 ? 'pe32-plus' : 'pe32';
  const imageBase = bits === 64 ? bytes.readBigUInt64LE(optionalStart + 24) : BigInt(bytes.readUInt32LE(optionalStart + 28));
  const directoryCountOffset = bits === 64 ? 108 : 92;
  const directoriesOffset = bits === 64 ? 112 : 96;
  if (optionalStart + directoryCountOffset + 4 > optionalStart + optionalSize) throw new Error('truncated data directories');
  const directoryCount = bytes.readUInt32LE(optionalStart + directoryCountOffset);
  const count = Math.min(directoryCount, 16);
  const directories: Record<number, PeDataDirectory> = {};
  for (let index = 0; index < count; index += 1) {
    const entryOffset = optionalStart + directoriesOffset + index * 8;
    if (entryOffset + 8 > optionalStart + optionalSize) break;
    const rva = bytes.readUInt32LE(entryOffset);
    const size = bytes.readUInt32LE(entryOffset + 4);
    if (rva !== 0 || size !== 0) directories[index] = { rva, size, entryOffset };
  }

  const sections: PeSection[] = [];
  const sectionTable = optionalStart + optionalSize;
  for (let index = 0; index < sectionCount; index += 1) {
    const at = sectionTable + index * 40;
    if (at + 40 > bytes.length) break;
    sections.push({
      name: readName(bytes, at, 8),
      virtualSize: bytes.readUInt32LE(at + 8),
      virtualAddress: bytes.readUInt32LE(at + 12),
      rawSize: bytes.readUInt32LE(at + 16),
      rawOffset: bytes.readUInt32LE(at + 20),
    });
  }

  return {
    format,
    machine,
    bits,
    architecture: PE_MACHINES[machine] ?? 'unknown',
    imageBase,
    sections,
    directories,
    peOffset,
    optionalStart,
  };
};

export const mapRva = (sections: readonly PeSection[], rva: number): number | undefined => {
  const matches = sections.filter((section) => rva >= section.virtualAddress && rva < section.virtualAddress + Math.max(section.virtualSize, section.rawSize));
  if (matches.length !== 1) return undefined;
  const [section] = matches as [PeSection];
  const offset = section.rawOffset + (rva - section.virtualAddress);
  return offset < section.rawOffset + section.rawSize ? offset : undefined;
};

export const sectionForRva = (sections: readonly PeSection[], rva: number): PeSection | undefined => {
  const matches = sections.filter((section) => rva >= section.virtualAddress && rva < section.virtualAddress + Math.max(section.virtualSize, section.rawSize));
  return matches.length === 1 ? matches[0] : undefined;
};

export const readCString = (bytes: Buffer, offset: number, maxLength = 4096): string | null => {
  if (offset < 0 || offset >= bytes.length) return null;
  const limit = Math.min(bytes.length, offset + maxLength);
  const end = bytes.indexOf(0, offset);
  if (end === -1 || end > limit) return bytes.subarray(offset, limit).toString('utf8');
  return bytes.subarray(offset, end).toString('utf8');
};

export const vaToRva = (imageBase: bigint, va: bigint): number | null => {
  if (va < imageBase) return null;
  const rva = va - imageBase;
  if (rva > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(rva);
};

export const formatVa = (va: bigint): string => `0x${va.toString(16)}`;

export const resolvePathBytes = async (
  path: string,
  options: { readonly maxFileBytes?: number; readonly cwd?: string; readonly operation: string },
): Promise<{ readonly bytes: Buffer; readonly path: string; readonly resolvedPath: string }> => {
  const { readFile } = await import('node:fs/promises');
  const { isAbsolute, resolve } = await import('node:path');
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 64 || maxFileBytes > 536_870_912) {
    throw peInputError(options.operation, path, 'invalid_value', 'max_file_bytes must be an integer between 64 and 536870912.');
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw peInputError(options.operation, path, 'invalid_value', reason);
  }
  if (bytes.length > maxFileBytes) {
    throw peInputError(options.operation, path, 'invalid_value', `the image is ${bytes.length} bytes, more than the ${maxFileBytes} byte limit`);
  }
  return { bytes, path, resolvedPath };
};
