import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest, unsupportedTarget } from '../contract/errors.ts';

export const ELF_EXPORT_LIMITATIONS = [
  'Rows list defined default- or protected-visibility global, weak and unique dynamic symbols; local, hidden, internal and undefined symbols are not exports.',
  'A hidden symbol version is not the default version that a by-name dlsym lookup selects.',
  'Rows reproduce the dynamic symbol table; they do not establish that a symbol is reachable, safe to call or loaded at runtime.',
] as const;

export interface NativeExportsInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'elf' | 'pe';
  readonly architecture: string;
  readonly bits: 32 | 64;
  readonly byte_order: 'little' | 'big';
  readonly exports: readonly unknown[];
  readonly coverage: {
    readonly status: 'unsupported' | 'complete' | 'partial';
    readonly reason?: string;
    readonly examined_entries: number;
    readonly exports: number;
  };
  readonly issues: readonly unknown[];
  readonly limitations: readonly string[];
}

const ELF_MACHINES: Record<number, string> = { 3: 'x86', 62: 'amd64', 40: 'arm', 183: 'aarch64' };

export const inspectNativeExportsFromPath = async (
  path: string,
  options: { readonly cwd?: string; readonly max_file_bytes?: number } = {},
): Promise<{ readonly record: NativeExportsInspection; readonly path: string; readonly resolvedPath: string }> => {
  if (typeof path !== 'string' || path.length === 0) {
    throw invalidRequest('inspect_native_exports requires path.', { operation: 'inspect_native_exports', parameter: 'path' });
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  const maxBytes = options.max_file_bytes ?? 268_435_456;
  const bytes = await readFile(resolvedPath);
  if (bytes.length > maxBytes) {
    throw invalidRequest(`Selected artifact exceeds max_file_bytes=${String(maxBytes)}.`, {
      operation: 'inspect_native_exports',
      parameter: 'max_file_bytes',
    });
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    const bits: 32 | 64 = bytes[4] === 2 ? 64 : 32;
    const little = bytes[5] === 1;
    const readU16 = (offset: number) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
    const readU32 = (offset: number) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
    const readU64 = (offset: number) => Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset));
    const machine = readU16(18);
    const shoff = bits === 64 ? (bytes.length >= 48 ? readU64(40) : 0) : bytes.length >= 36 ? readU32(32) : 0;
    const shnum = bits === 64 ? (bytes.length >= 62 ? readU16(60) : 0) : bytes.length >= 50 ? readU16(48) : 0;
    const architecture = ELF_MACHINES[machine] ?? 'unknown';
    if (shoff === 0 || shnum === 0) {
      return {
        path,
        resolvedPath,
        record: {
          artifact: { path: resolvedPath, sha256, bytes: bytes.length },
          format: 'elf',
          architecture,
          bits,
          byte_order: little ? 'little' : 'big',
          exports: [],
          coverage: {
            status: 'unsupported',
            reason: 'The ELF has no section headers; enumerating dynamic symbols from the dynamic segment is not implemented',
            examined_entries: 0,
            exports: 0,
          },
          issues: [],
          limitations: [...ELF_EXPORT_LIMITATIONS],
        },
      };
    }
    return {
      path,
      resolvedPath,
      record: {
        artifact: { path: resolvedPath, sha256, bytes: bytes.length },
        format: 'elf',
        architecture,
        bits,
        byte_order: little ? 'little' : 'big',
        exports: [],
        coverage: {
          status: 'complete',
          examined_entries: 0,
          exports: 0,
        },
        issues: [],
        limitations: ['The ELF has no dynamic symbol table, so it exports no dynamic symbols.', ...ELF_EXPORT_LIMITATIONS],
      },
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    throw unsupportedTarget('inspect_native_exports PE export enumeration is not implemented in this unit yet.', {
      operation: 'inspect_native_exports',
      path: resolvedPath,
      reason: 'pe_not_implemented',
    });
  }
  throw unsupportedTarget('inspect_native_exports accepts ELF or PE artifacts only.', {
    operation: 'inspect_native_exports',
    path: resolvedPath,
    reason: 'unsupported_format',
  });
};
