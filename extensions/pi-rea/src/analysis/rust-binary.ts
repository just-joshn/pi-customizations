import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { analysisInputInvalid, invalidRequest } from '../contract/errors.ts';
import { parsePeImage } from './pe-core.ts';

export interface RustBinaryInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'elf' | 'pe' | 'macho';
  readonly architecture: string;
  readonly bits: 32 | 64;
  readonly byte_order: 'little' | 'big';
  readonly selected_slice: {
    readonly kind: string;
    readonly container: 'thin' | 'fat';
    readonly offset: number;
    readonly byte_length: number;
    readonly cpu_type: number;
    readonly cpu_subtype: number;
    readonly container_table_sha256: string | null;
  } | null;
  readonly auditable_metadata: {
    readonly section_name: '.dep-v0' | '__DATA,.dep-v0';
    readonly file_offset: number;
    readonly section_bytes: number;
    readonly compressed_bytes: number;
    readonly uncompressed_bytes: number;
    readonly format_version: number | null;
    readonly packages: readonly RustPackage[];
    readonly root_package_index: number | null;
    readonly dependency_edges: readonly { readonly from_index: number; readonly to_index: number }[];
    readonly cyclic_dependency_indices: readonly number[];
  } | null;
  readonly rustc_commit: { readonly evidence_kind: string; readonly hashes: readonly { readonly hash: string; readonly file_offset: number }[] } | null;
  readonly limitations: readonly string[];
}

interface RustPackage {
  readonly name: string;
  readonly version: string;
  readonly source: string;
  readonly kind: 'runtime' | 'build' | null;
  readonly dependencies: readonly number[];
  readonly features: readonly string[] | null;
  readonly root: boolean;
}

export const RUST_LIMITATIONS = ['Reports cargo-auditable `.dep-v0` metadata when present; absence is not proof the binary was not built with Rust.', 'Universal Mach-O requires an explicit architecture; other formats reject architecture.'];

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_rust_binary',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const findCycles = (packages: readonly RustPackage[]): number[] => {
  const cyclic = new Set<number>();
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number, stack: number[]): void => {
    if (visited.has(index)) return;
    if (visiting.has(index)) {
      const start = stack.indexOf(index);
      for (const node of stack.slice(start === -1 ? 0 : start)) cyclic.add(node);
      return;
    }
    visiting.add(index);
    for (const next of packages[index]?.dependencies ?? []) visit(next, [...stack, index]);
    visiting.delete(index);
    visited.add(index);
  };
  for (let index = 0; index < packages.length; index += 1) visit(index, []);
  return [...cyclic].toSorted((a, b) => a - b);
};

const PACKAGE_KEYS = new Set(['name', 'version', 'source', 'kind', 'dependencies', 'features', 'root']);
const DOCUMENT_KEYS = new Set(['packages', 'format']);
const MAX_FORMAT_VERSION = 0xffff_ffff;

const FORMAT_SCHEMA = 'Dependency JSON does not match the format schema';
const DOCUMENT_SCHEMA = 'Dependency JSON does not match the package schema';
const MULTIPLE_ROOTS = 'Dependency JSON declares more than one root package';
const packageSchema = (index: number): string => `Dependency package ${index} does not match the package schema`;
const indexOutOfRange = (index: number, packageIndex: number): string => `Dependency index ${index} from package ${packageIndex} is outside the package list`;

const auditableError = (absolutePath: string, detail: string) =>
  analysisInputInvalid('inspect_rust_binary', [
    {
      path: ['path'],
      reason: 'invalid_format',
      message: `Selected artifact ${absolutePath}: ${detail}`,
    },
  ]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const readDependencies = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) return null;
  const indices: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0) return null;
    indices.push(entry);
  }
  return indices;
};

const readFeatures = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const features: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '') return null;
    features.push(entry);
  }
  return features;
};

const readPackage = (entry: unknown): RustPackage | null => {
  if (!isRecord(entry)) return null;
  if (Object.keys(entry).some((key) => !PACKAGE_KEYS.has(key))) return null;
  const name = entry['name'];
  const version = entry['version'];
  const source = entry['source'];
  if (typeof name !== 'string' || name === '' || typeof version !== 'string' || version === '' || typeof source !== 'string' || source === '') return null;
  const kind = entry['kind'];
  if (kind !== undefined && kind !== 'runtime' && kind !== 'build') return null;
  const rawDependencies = entry['dependencies'];
  const dependencies = rawDependencies === undefined ? [] : readDependencies(rawDependencies);
  if (dependencies === null) return null;
  const rawFeatures = entry['features'];
  const features = rawFeatures === undefined ? null : readFeatures(rawFeatures);
  if (rawFeatures !== undefined && features === null) return null;
  const root = entry['root'];
  if (root !== undefined && typeof root !== 'boolean') return null;
  return { name, version, source, kind: kind ?? null, dependencies, features, root: root === true };
};

const readAuditableDocument = (value: unknown, absolutePath: string): { readonly format_version: number | null; readonly packages: readonly RustPackage[]; readonly root_package_index: number | null } => {
  if (!isRecord(value)) throw auditableError(absolutePath, FORMAT_SCHEMA);
  const document = value as Record<string, unknown>;
  const format = document['format'];
  if (format !== undefined && (typeof format !== 'number' || !Number.isInteger(format) || format < 0 || format > MAX_FORMAT_VERSION)) throw auditableError(absolutePath, FORMAT_SCHEMA);
  const entries = document['packages'];
  if (!Array.isArray(entries)) throw auditableError(absolutePath, DOCUMENT_SCHEMA);
  const packages = entries.map((entry, index) => {
    const pkg = readPackage(entry);
    if (pkg === null) throw auditableError(absolutePath, packageSchema(index));
    return pkg;
  });
  if (Object.keys(document).some((key) => !DOCUMENT_KEYS.has(key))) throw auditableError(absolutePath, DOCUMENT_SCHEMA);
  if (packages.some((pkg) => pkg.dependencies.some((index) => !Number.isSafeInteger(index)))) throw auditableError(absolutePath, DOCUMENT_SCHEMA);
  if (packages.filter((pkg) => pkg.root).length > 1) throw auditableError(absolutePath, MULTIPLE_ROOTS);
  for (const [from, pkg] of packages.entries()) {
    for (const to of pkg.dependencies) {
      if (to >= packages.length) throw auditableError(absolutePath, indexOutOfRange(to, from));
    }
  }
  const rootIndex = packages.findIndex((pkg) => pkg.root);
  return { format_version: typeof format === 'number' ? format : null, packages, root_package_index: rootIndex === -1 ? null : rootIndex };
};

const decodeAuditable = (payload: Buffer, sectionName: '.dep-v0' | '__DATA,.dep-v0', fileOffset: number, absolutePath: string): NonNullable<RustBinaryInspection['auditable_metadata']> => {
  let uncompressed: Buffer;
  try {
    uncompressed = inflateSync(payload);
  } catch {
    throw new Error('`.dep-v0` payload is not zlib-compressed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(uncompressed.toString('utf8'));
  } catch {
    throw new Error('`.dep-v0` uncompressed payload is not JSON');
  }
  const document = readAuditableDocument(parsed, absolutePath);
  const edges = document.packages.flatMap((pkg, from) => pkg.dependencies.map((to) => ({ from_index: from, to_index: to })));
  return {
    section_name: sectionName,
    file_offset: fileOffset,
    section_bytes: payload.length,
    compressed_bytes: payload.length,
    uncompressed_bytes: uncompressed.length,
    format_version: document.format_version,
    packages: document.packages,
    root_package_index: document.root_package_index,
    dependency_edges: edges,
    cyclic_dependency_indices: findCycles(document.packages),
  };
};

const ELF_MACHINES: Record<number, string> = { 3: 'x86', 62: 'x86_64', 40: 'arm', 183: 'aarch64' };

const readElfDep = (bytes: Buffer, absolutePath: string): { metadata: RustBinaryInspection['auditable_metadata']; architecture: string; bits: 32 | 64; byte_order: 'little' | 'big' } => {
  if (bytes.length < 16 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) throw new Error('not elf');
  const bits: 32 | 64 = bytes[4] === 2 ? 64 : 32;
  const little = bytes[5] === 1;
  const readU16 = (offset: number) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const readU32 = (offset: number) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const readU64 = (offset: number) => Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset));
  const machine = readU16(18);
  const shoff = bits === 64 ? readU64(40) : readU32(32);
  const shentsize = readU16(bits === 64 ? 58 : 46);
  const shnum = readU16(bits === 64 ? 60 : 48);
  const shstrndx = readU16(bits === 64 ? 62 : 50);
  const strAt = shoff + shstrndx * shentsize;
  const strOff = bits === 64 ? readU64(strAt + 24) : readU32(strAt + 16);
  const strSize = bits === 64 ? readU64(strAt + 32) : readU32(strAt + 20);
  const shstr = bytes.subarray(strOff, strOff + strSize);
  for (let index = 0; index < shnum; index += 1) {
    const at = shoff + index * shentsize;
    const nameOff = readU32(at);
    const end = shstr.indexOf(0, nameOff);
    const name = shstr.subarray(nameOff, end === -1 ? shstr.length : end).toString('utf8');
    if (name !== '.dep-v0') continue;
    const offset = bits === 64 ? readU64(at + 24) : readU32(at + 16);
    const size = bits === 64 ? readU64(at + 32) : readU32(at + 20);
    return {
      metadata: decodeAuditable(bytes.subarray(offset, offset + size), '.dep-v0', offset, absolutePath),
      architecture: ELF_MACHINES[machine] ?? 'unknown',
      bits,
      byte_order: little ? 'little' : 'big',
    };
  }
  return { metadata: null, architecture: ELF_MACHINES[machine] ?? 'unknown', bits, byte_order: little ? 'little' : 'big' };
};

const readPeDep = (bytes: Buffer, absolutePath: string): { metadata: RustBinaryInspection['auditable_metadata']; architecture: string; bits: 32 | 64; byte_order: 'little' | 'big' } => {
  const image = parsePeImage(bytes);
  for (const section of image.sections) {
    if (section.name !== '.dep-v0') continue;
    const size = Math.min(section.rawSize, Math.max(section.virtualSize, 0));
    const payload = bytes.subarray(section.rawOffset, section.rawOffset + size);
    return {
      metadata: decodeAuditable(payload, '.dep-v0', section.rawOffset, absolutePath),
      architecture: image.architecture,
      bits: image.bits,
      byte_order: 'little',
    };
  }
  return { metadata: null, architecture: image.architecture, bits: image.bits, byte_order: 'little' };
};

const MACH_O_THIN: Record<number, { bits: 32 | 64; little: boolean }> = {
  4277009102: { bits: 32, little: false },
  3472551422: { bits: 32, little: true },
  4277009103: { bits: 64, little: false },
  3489328638: { bits: 64, little: true },
};

const MACH_O_CPUS: Record<number, string> = { 7: 'x86', 16777223: 'x86_64', 12: 'arm', 16777228: 'arm64' };

const readMachODep = (
  bytes: Buffer,
  architecture: string | undefined,
  absolutePath: string,
): {
  metadata: RustBinaryInspection['auditable_metadata'];
  architecture: string;
  bits: 32 | 64;
  byte_order: 'little' | 'big';
  selected: NonNullable<RustBinaryInspection['selected_slice']>;
} => {
  const fatMagic = bytes.readUInt32BE(0);
  if (fatMagic === 0xcafebabe || fatMagic === 0xcafebabf) {
    throw new Error(architecture === undefined ? 'universal Mach-O requires architecture' : 'universal Mach-O slice selection is not implemented in this unit');
  }
  const magic = bytes.readUInt32BE(0);
  const magicLe = bytes.readUInt32LE(0);
  const thin = MACH_O_THIN[magic] ?? MACH_O_THIN[magicLe];
  if (!thin) throw new Error('unrecognised binary format');
  if (architecture !== undefined) throw new Error('architecture is only valid for universal Mach-O');
  const little = thin.little;
  const readU32 = (offset: number) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const cpuType = readU32(4);
  const cpuSubtype = readU32(8);
  const ncmds = readU32(16);
  let offset = thin.bits === 64 ? 32 : 28;
  let metadata: RustBinaryInspection['auditable_metadata'] = null;
  for (let index = 0; index < ncmds; index += 1) {
    const cmd = readU32(offset);
    const cmdsize = readU32(offset + 4);
    if (cmd === 0x1 || cmd === 0x19) {
      const segname = bytes
        .subarray(offset + 8, offset + 24)
        .toString('utf8')
        .replace(/\0+$/, '');
      const nsectsField = thin.bits === 64 ? offset + 64 : offset + 48;
      const nsects = readU32(nsectsField);
      let sect = thin.bits === 64 ? offset + 72 : offset + 56;
      for (let s = 0; s < nsects; s += 1) {
        const sectname = bytes
          .subarray(sect, sect + 16)
          .toString('utf8')
          .replace(/\0+$/, '');
        const size = thin.bits === 64 ? Number(little ? bytes.readBigUInt64LE(sect + 40) : bytes.readBigUInt64BE(sect + 40)) : readU32(sect + 36);
        const fileOffset = thin.bits === 64 ? readU32(sect + 48) : readU32(sect + 40);
        if (sectname === '.dep-v0' || (segname === '__DATA' && sectname === '.dep-v0')) {
          metadata = decodeAuditable(bytes.subarray(fileOffset, fileOffset + size), '__DATA,.dep-v0', fileOffset, absolutePath);
        }
        sect += thin.bits === 64 ? 80 : 68;
      }
    }
    offset += cmdsize;
  }
  return {
    metadata,
    architecture: MACH_O_CPUS[cpuType] ?? 'unknown',
    bits: thin.bits,
    byte_order: little ? 'little' : 'big',
    selected: {
      kind: 'mach-o-slice',
      container: 'thin',
      offset: 0,
      byte_length: bytes.length,
      cpu_type: cpuType,
      cpu_subtype: cpuSubtype,
      container_table_sha256: null,
    },
  };
};

export interface RustBinaryOptions {
  readonly architecture?: string;
  readonly cwd?: string;
}

export const inspectRustBinaryFromPath = async (path: string, options: RustBinaryOptions = {}): Promise<{ record: RustBinaryInspection; path: string; resolvedPath: string }> => {
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }

  try {
    let format: 'elf' | 'pe' | 'macho';
    let architecture: string;
    let bits: 32 | 64;
    let byte_order: 'little' | 'big';
    let selected_slice: RustBinaryInspection['selected_slice'] = null;
    let auditable_metadata: RustBinaryInspection['auditable_metadata'] = null;

    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
      if (options.architecture !== undefined) throw inputError(path, 'invalid_value', 'architecture is only valid for universal Mach-O.');
      format = 'elf';
      const parsed = readElfDep(bytes, resolvedPath);
      architecture = parsed.architecture;
      bits = parsed.bits;
      byte_order = parsed.byte_order;
      auditable_metadata = parsed.metadata;
    } else if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
      if (options.architecture !== undefined) throw inputError(path, 'invalid_value', 'architecture is only valid for universal Mach-O.');
      format = 'pe';
      const parsed = readPeDep(bytes, resolvedPath);
      architecture = parsed.architecture;
      bits = parsed.bits;
      byte_order = parsed.byte_order;
      auditable_metadata = parsed.metadata;
    } else {
      format = 'macho';
      const parsed = readMachODep(bytes, options.architecture, resolvedPath);
      architecture = parsed.architecture;
      bits = parsed.bits;
      byte_order = parsed.byte_order;
      selected_slice = parsed.selected;
      auditable_metadata = parsed.metadata;
    }

    return {
      path,
      resolvedPath,
      record: {
        artifact: { path, sha256: sha256(bytes), bytes: bytes.length },
        format,
        architecture,
        bits,
        byte_order,
        selected_slice,
        auditable_metadata,
        rustc_commit: null,
        limitations: [...RUST_LIMITATIONS],
      },
    };
  } catch (error) {
    if (error instanceof Error && 'payload' in error) throw error;
    throw inputError(path, 'invalid_format', (error as Error).message);
  }
};
