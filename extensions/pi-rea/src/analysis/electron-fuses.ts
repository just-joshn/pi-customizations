import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const ELECTRON_FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';

export const ELECTRON_FUSE_STATE_BYTES = {
  disabled: 0x30,
  enabled: 0x31,
  removed: 0x72,
} as const;

export const ELECTRON_FUSE_V1_NAMES = [
  'RunAsNode',
  'EnableCookieEncryption',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar',
  'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges',
  'WasmTrapHandlers',
] as const;

const SENTINEL = Buffer.from(ELECTRON_FUSE_SENTINEL, 'ascii');
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const SENTINEL_SEARCH_WINDOW = 262_144;
const MAX_SENTINELS_PER_SLICE = 32;

const OTHER_MEANS_LIMITATION = 'Fuse state does not prove the application enables Inspector through other means, such as app.commandLine or a remote-debugging switch in application code.';
const MISSING_SENTINEL_LIMITATION = 'A missing sentinel means fuse state is unknown, not that every fuse is disabled.';
const ADMISSION_LIMITATION = 'The selected file is admitted as one regular file of at most 1 GiB. Sentinel search uses 262144-byte windows, and each slice keeps at most 32 sentinels.';

export type ElectronFuseState = 'enabled' | 'disabled' | 'removed' | 'unknown';
export type ElectronFuseFormat = 'mach-o' | 'mach-o-universal' | 'pe' | 'elf';

export interface ElectronFuse {
  readonly index: number;
  readonly name: string | null;
  readonly state: ElectronFuseState;
  readonly raw_byte: number;
}

export interface ElectronFuseSentinel {
  readonly sentinel_offset: number;
  readonly wire_version: number | null;
  readonly declared_length: number | null;
  readonly fuses: readonly ElectronFuse[];
  readonly complete: boolean;
}

export interface ElectronFuseSlice {
  readonly index: number;
  readonly file_offset: number;
  readonly size: number;
  readonly architecture: string | null;
  readonly sentinel_count: number;
  readonly sentinels: readonly ElectronFuseSentinel[];
}

export interface ElectronFuseImplication {
  readonly relationship: 'derivation';
  readonly slice_index: number;
  readonly sentinel_offset: number;
  readonly subject: 'node_cli_inspect_arguments' | 'electron_run_as_node' | 'embedded_asar_integrity_validation' | 'only_load_app_from_asar';
  readonly fuse_index: 0 | 3 | 4 | 5;
  readonly outcome: string;
}

export interface ElectronFuseInspection {
  readonly artifact: {
    readonly selected_path: string;
    readonly resolved_path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly format: ElectronFuseFormat;
  };
  readonly slices: readonly ElectronFuseSlice[];
  readonly runtime_implications: readonly ElectronFuseImplication[];
  readonly limitations: readonly string[];
}

const MACH_ARCH: Record<number, string> = {
  7: 'x86',
  12: 'arm',
  16777223: 'x86_64',
  16777228: 'arm64',
};

const inputError = (path: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_electron_fuses',
    issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${detail}` }],
  });

export const electronFuseState = (byte: number): ElectronFuseState => {
  if (byte === ELECTRON_FUSE_STATE_BYTES.disabled) return 'disabled';
  if (byte === ELECTRON_FUSE_STATE_BYTES.enabled) return 'enabled';
  if (byte === ELECTRON_FUSE_STATE_BYTES.removed) return 'removed';
  return 'unknown';
};

export const electronFuseName = (wireVersion: number, index: number): string | null => (wireVersion === 1 ? (ELECTRON_FUSE_V1_NAMES[index] ?? null) : null);

const findSentinelOffsets = (bytes: Buffer, start: number, end: number): number[] => {
  const offsets: number[] = [];
  for (let windowStart = start; windowStart < end && offsets.length < MAX_SENTINELS_PER_SLICE; windowStart += SENTINEL_SEARCH_WINDOW) {
    const windowEnd = Math.min(end, windowStart + SENTINEL_SEARCH_WINDOW);
    let cursor = windowStart;
    while (cursor + SENTINEL.length <= windowEnd && offsets.length < MAX_SENTINELS_PER_SLICE) {
      const at = bytes.indexOf(SENTINEL, cursor);
      if (at === -1 || at + SENTINEL.length > windowEnd) break;
      offsets.push(at);
      cursor = at + 1;
    }
  }
  return offsets;
};

const decodeSentinel = (bytes: Buffer, sentinelOffset: number, sliceEnd: number): ElectronFuseSentinel => {
  const wireStart = sentinelOffset + SENTINEL.length;
  if (wireStart + 2 > sliceEnd) {
    return { sentinel_offset: sentinelOffset, wire_version: null, declared_length: null, fuses: [], complete: false };
  }
  const wireVersion = bytes[wireStart]!;
  const declaredLength = bytes[wireStart + 1]!;
  const fuseStart = wireStart + 2;
  const available = Math.max(0, sliceEnd - fuseStart);
  const take = Math.min(declaredLength, available);
  const fuses: ElectronFuse[] = [];
  for (let index = 0; index < take; index += 1) {
    const raw = bytes[fuseStart + index]!;
    fuses.push({
      index,
      name: electronFuseName(wireVersion, index),
      state: electronFuseState(raw),
      raw_byte: raw,
    });
  }
  return {
    sentinel_offset: sentinelOffset,
    wire_version: wireVersion,
    declared_length: declaredLength,
    fuses,
    complete: take === declaredLength,
  };
};

interface SliceRange {
  readonly index: number;
  readonly fileOffset: number;
  readonly size: number;
  readonly architecture: string | null;
}

const machoSlices = (bytes: Buffer): { readonly format: ElectronFuseFormat; readonly slices: SliceRange[] } | null => {
  if (bytes.length < 8) return null;
  const be = bytes.readUInt32BE(0);
  const le = bytes.readUInt32LE(0);
  if (be === 0xcafebabe || le === 0xcafebabe) {
    const big = be === 0xcafebabe;
    const count = big ? bytes.readUInt32BE(4) : bytes.readUInt32LE(4);
    if (count < 1 || count > 32 || 8 + count * 20 > bytes.length) return null;
    const slices: SliceRange[] = [];
    for (let index = 0; index < count; index += 1) {
      const base = 8 + index * 20;
      const cpu = big ? bytes.readUInt32BE(base) : bytes.readUInt32LE(base);
      const fileOffset = big ? bytes.readUInt32BE(base + 8) : bytes.readUInt32LE(base + 8);
      const size = big ? bytes.readUInt32BE(base + 12) : bytes.readUInt32LE(base + 12);
      slices.push({ index, fileOffset, size, architecture: MACH_ARCH[cpu] ?? null });
    }
    return { format: 'mach-o-universal', slices };
  }
  if (le === 0xfeedfacf || be === 0xfeedfacf || le === 0xfeedface || be === 0xfeedface) {
    const little = le === 0xfeedfacf || le === 0xfeedface;
    const cpu = little ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4);
    return { format: 'mach-o', slices: [{ index: 0, fileOffset: 0, size: bytes.length, architecture: MACH_ARCH[cpu] ?? null }] };
  }
  return null;
};

const detectContainer = (bytes: Buffer): { readonly format: ElectronFuseFormat; readonly slices: SliceRange[] } => {
  const macho = machoSlices(bytes);
  if (macho !== null) return macho;
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString('latin1') === 'MZ') {
    return { format: 'pe', slices: [{ index: 0, fileOffset: 0, size: bytes.length, architecture: null }] };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === '\u007fELF') {
    return { format: 'elf', slices: [{ index: 0, fileOffset: 0, size: bytes.length, architecture: null }] };
  }
  throw new Error('unsupported container');
};

const implicationsFor = (slices: readonly ElectronFuseSlice[], format: ElectronFuseFormat): { readonly runtime_implications: ElectronFuseImplication[]; readonly limitations: string[] } => {
  const runtime_implications: ElectronFuseImplication[] = [];
  const limitations = [OTHER_MEANS_LIMITATION, MISSING_SENTINEL_LIMITATION, ADMISSION_LIMITATION];
  const rules = [
    { subject: 'node_cli_inspect_arguments' as const, fuse_index: 3 as const, enabled: 'honored', inactive: 'not_honored' },
    { subject: 'electron_run_as_node' as const, fuse_index: 0 as const, enabled: 'honored', inactive: 'not_honored' },
    {
      subject: 'embedded_asar_integrity_validation' as const,
      fuse_index: 4 as const,
      enabled: 'enforced',
      inactive: 'not_enforced',
      skipElf: true,
    },
    {
      subject: 'only_load_app_from_asar' as const,
      fuse_index: 5 as const,
      enabled: 'restricted_to_app_asar',
      inactive: 'not_restricted_to_app_asar',
    },
  ];
  for (const slice of slices) {
    if (slice.sentinel_count === 0) {
      limitations.push(`Slice ${slice.index} at file offset ${slice.file_offset} contains no Electron fuse sentinel; fuse state for that slice is unknown, not disabled.`);
      continue;
    }
    if (slice.sentinel_count > 1) {
      limitations.push(`Slice ${slice.index} at file offset ${slice.file_offset} contains ${slice.sentinel_count} Electron fuse sentinels; every sentinel is reported and none is selected.`);
    }
    for (const sentinel of slice.sentinels) {
      for (const rule of rules) {
        const fuse = sentinel.fuses.find((entry) => entry.index === rule.fuse_index);
        let outcome = 'unknown';
        if (fuse !== undefined && !(rule.skipElf === true && format === 'elf')) {
          if (fuse.state === 'enabled') outcome = rule.enabled;
          else if (fuse.state === 'disabled' || fuse.state === 'removed') outcome = rule.inactive;
        }
        runtime_implications.push({
          relationship: 'derivation',
          slice_index: slice.index,
          sentinel_offset: sentinel.sentinel_offset,
          subject: rule.subject,
          fuse_index: rule.fuse_index,
          outcome,
        });
      }
    }
  }
  return { runtime_implications, limitations };
};

const resolveSelectedFile = async (path: string, cwd?: string): Promise<string> => {
  const resolved = isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path);
  let canonical: string;
  try {
    canonical = await realpath(resolved);
  } catch (error) {
    throw inputError(path, `it could not be resolved (${(error as Error).message})`);
  }
  const stats = await stat(canonical);
  if (stats.isDirectory()) {
    const candidates = [
      resolve(canonical, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'),
      resolve(canonical, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'),
      resolve(canonical, 'Electron Framework'),
    ];
    for (const candidate of candidates) {
      try {
        const fileStats = await stat(candidate);
        if (fileStats.isFile()) return await realpath(candidate);
      } catch {}
    }
    throw inputError(path, 'no Electron Framework binary was found inside the app bundle');
  }
  if (!stats.isFile()) throw inputError(path, 'it is not a regular file');
  return canonical;
};

export const inspectElectronFusesFromPath = async (path: string, options: { readonly cwd?: string } = {}): Promise<{ readonly record: ElectronFuseInspection; readonly path: string; readonly resolvedPath: string }> => {
  const resolvedPath = await resolveSelectedFile(path, options.cwd);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    throw inputError(path, `it could not be read (${(error as Error).message})`);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw inputError(path, `the image is ${bytes.length} bytes, more than the ${MAX_FILE_BYTES} byte limit`);
  }
  let container: { readonly format: ElectronFuseFormat; readonly slices: SliceRange[] };
  try {
    container = detectContainer(bytes);
  } catch {
    throw inputError(path, 'it is not a Mach-O, PE, or ELF Electron container');
  }
  const slices: ElectronFuseSlice[] = container.slices.map((slice) => {
    const end = Math.min(bytes.length, slice.fileOffset + slice.size);
    const start = Math.min(bytes.length, slice.fileOffset);
    const offsets = findSentinelOffsets(bytes, start, end);
    const sentinels = offsets.map((offset) => decodeSentinel(bytes, offset, end));
    return {
      index: slice.index,
      file_offset: slice.fileOffset,
      size: slice.size,
      architecture: slice.architecture,
      sentinel_count: sentinels.length,
      sentinels,
    };
  });
  const findings = implicationsFor(slices, container.format);
  return {
    path,
    resolvedPath,
    record: {
      artifact: {
        selected_path: path,
        resolved_path: resolvedPath,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        format: container.format,
      },
      slices,
      runtime_implications: findings.runtime_implications,
      limitations: findings.limitations,
    },
  };
};

export const fuseWireFixture = (version: number, fuses: readonly number[]): Buffer => Buffer.from([version, fuses.length, ...fuses]);

export const thinMachoFuseFixture = (fuses: readonly number[], version = 1): Buffer => {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(2, 12);
  return Buffer.concat([header, SENTINEL, fuseWireFixture(version, fuses)]);
};
