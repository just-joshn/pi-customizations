import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest, unsupportedTarget } from '../contract/errors.ts';
import { readZipDirectory, readZipMember } from './formats/zip.mjs';

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const ELF_HEADER_MAX_BYTES = 64;
const DART_SNAPSHOT_MAGIC = Buffer.from([0xf5, 0xf5, 0xdc, 0xdc]);
const SNAPSHOT_HASH_OFFSET = 20;
const SNAPSHOT_HASH_LENGTH = 32;
const SNAPSHOT_HASH_PATTERN = /^[0-9a-f]{32}$/u;
const DART_VERSION_PATTERN = /^Dart VM version:[^\x00\n]{0,200}$/u;
const TOOLCHAIN_PATTERN = /^(?:Android \([^)\x00\n]{0,80}\) clang version [^\x00\n]{0,500}|based on LLVM \d[^\x00\n]{0,80})$/u;
const MAX_TOOLCHAIN_LINES = 4;
const MAX_SNAPSHOT_HASH_CANDIDATES = 64;

const DEFAULT_ABI_ORDER = ['arm64-v8a', 'x86_64', 'x86', 'armeabi-v7a'] as const;

export interface FlutterAbiFacts {
  readonly abi: string;
  readonly libapp: {
    readonly present: boolean;
    readonly bytes: number | null;
    readonly sha256: string | null;
    readonly elf_header_valid: boolean | null;
    readonly snapshot_hash_sources: number;
    readonly snapshot_hash_candidates: readonly string[];
    readonly snapshot_hash: string | null;
  };
  readonly libflutter: {
    readonly present: boolean;
    readonly bytes: number | null;
    readonly sha256: string | null;
    readonly build_id: string | null;
    readonly build_id_candidates: readonly string[];
    readonly dart_version: string | null;
    readonly toolchain_lines: readonly string[];
    readonly dart_version_capped: boolean;
    readonly toolchain_capped: boolean;
  };
}

export interface FlutterBuildInspection {
  readonly target: { readonly path: string; readonly bytes: number; readonly sha256: string };
  readonly flutter_detected: boolean;
  readonly abis: readonly FlutterAbiFacts[];
  readonly coverage: 'partial' | 'complete';
}

export interface DartAotInspection {
  readonly target: { readonly path: string; readonly bytes: number; readonly sha256: string };
  readonly abi: string;
  readonly library: { readonly path: string; readonly bytes: number; readonly sha256: string };
  readonly snapshots: readonly {
    readonly name: string;
    readonly offset: number | null;
    readonly size: number | null;
    readonly magic: string | null;
    readonly kind: number | null;
    readonly length: number | null;
  }[];
  readonly snapshot_hash: string | null;
  readonly string_pool: {
    readonly package_uris: readonly string[];
    readonly dart_uris: readonly string[];
    readonly identifiers: readonly string[];
    readonly truncated: boolean;
  };
  readonly coverage: { readonly state: 'complete' | 'partial' | 'unavailable'; readonly issues: readonly string[] };
  readonly limitations: readonly string[];
}

const inputError = (operation: string, path: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation,
    issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${detail}` }],
  });

class BoundedReader {
  constructor(private readonly bytes: Buffer) {}
  u8(offset: number): number | null {
    return offset < this.bytes.length ? this.bytes.readUInt8(offset) : null;
  }
  u16(offset: number): number | null {
    return offset + 2 <= this.bytes.length ? this.bytes.readUInt16LE(offset) : null;
  }
  u32(offset: number): number | null {
    return offset + 4 <= this.bytes.length ? this.bytes.readUInt32LE(offset) : null;
  }
  u64(offset: number): number | null {
    const low = this.u32(offset);
    const high = this.u32(offset + 4);
    if (low === null || high === null || high > 0x001fffff) return null;
    return high * 0x1_0000_0000 + low;
  }
}

type ElfHeaderResult = { readonly header: true } | { readonly failure: { readonly reason: string } };

const readElfHeader = (bytes: Buffer, totalBytes = bytes.length): ElfHeaderResult => {
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('hex') !== '7f454c46') {
    return { failure: { reason: 'not an ELF image' } };
  }
  if (bytes.length < 16) return { failure: { reason: 'ELF identification is truncated' } };
  const classByte = bytes[4];
  if (classByte !== 1 && classByte !== 2) return { failure: { reason: 'unsupported ELF class' } };
  const dataByte = bytes[5];
  if (dataByte !== 1 && dataByte !== 2) return { failure: { reason: 'unsupported ELF endianness' } };
  if (bytes[6] !== 1) return { failure: { reason: 'unsupported ELF identification version' } };
  const is64 = classByte === 2;
  const minimumSize = is64 ? 64 : 52;
  if (!Number.isSafeInteger(totalBytes) || totalBytes < bytes.length || totalBytes < minimumSize || bytes.length < minimumSize) {
    return {
      failure: {
        reason: `truncated ELF header: an ELF${is64 ? 64 : 32} header needs ${minimumSize} bytes; the file has ${totalBytes}`,
      },
    };
  }
  if (dataByte !== 1) return { failure: { reason: 'unsupported ELF byte order' } };
  const reader = new BoundedReader(bytes);
  const headerSize = reader.u16(is64 ? 52 : 40);
  if (headerSize === null || headerSize < minimumSize || headerSize > totalBytes) {
    return { failure: { reason: 'unsupported ELF header size' } };
  }
  if (headerSize !== (is64 ? ELF_HEADER_MAX_BYTES : 52)) {
    return { failure: { reason: 'unsupported ELF header size' } };
  }
  const eType = reader.u16(0x10);
  if (eType !== 1 && eType !== 2 && eType !== 3) return { failure: { reason: 'unsupported ELF type' } };
  const eShoff = is64 ? reader.u64(0x28) : reader.u32(0x20);
  const eShentsize = reader.u16(is64 ? 0x3a : 0x2e);
  const eShnum = reader.u16(is64 ? 0x3c : 0x30);
  const ePhoff = is64 ? reader.u64(0x20) : reader.u32(0x1c);
  const ePhentsize = reader.u16(is64 ? 0x36 : 0x2a);
  const ePhnum = reader.u16(is64 ? 0x38 : 0x2c);
  const tableFits = (offset: number | null, width: number | null, count: number | null, minimumWidth: number) =>
    offset !== null && width !== null && count !== null && offset >= headerSize && offset <= totalBytes && width >= minimumWidth && count > 0 && count <= Math.floor((totalBytes - offset) / width);
  const minShent = is64 ? 64 : 40;
  const sectionTableAbsent = eType === 3 && eShoff === 0 && eShnum === 0;
  if (eShoff === null || eShentsize === null || eShnum === null || (!sectionTableAbsent && !tableFits(eShoff, eShentsize, eShnum, minShent))) {
    return { failure: { reason: 'ELF section header table is missing or out of bounds' } };
  }
  const minPhent = is64 ? 56 : 32;
  if (ePhoff === null || ePhentsize === null || ePhnum === null || ePhnum === 0xffff || !tableFits(ePhoff, ePhentsize, ePhnum, minPhent)) {
    return { failure: { reason: 'ELF program header table is missing or out of bounds' } };
  }
  return { header: true };
};

const findSnapshotHashes = (bytes: Buffer): { readonly sources: number; readonly candidates: string[] } => {
  const candidates: string[] = [];
  const candidateSet = new Set<string>();
  let sources = 0;
  let offset = 0;
  while (offset <= bytes.length - DART_SNAPSHOT_MAGIC.length) {
    const magic = bytes.indexOf(DART_SNAPSHOT_MAGIC, offset);
    if (magic < 0) break;
    if (magic + SNAPSHOT_HASH_OFFSET + SNAPSHOT_HASH_LENGTH > bytes.length) break;
    const candidate = bytes.subarray(magic + SNAPSHOT_HASH_OFFSET, magic + SNAPSHOT_HASH_OFFSET + SNAPSHOT_HASH_LENGTH).toString('latin1');
    if (SNAPSHOT_HASH_PATTERN.test(candidate)) {
      sources += 1;
      if (!candidateSet.has(candidate) && candidates.length < MAX_SNAPSHOT_HASH_CANDIDATES) {
        candidateSet.add(candidate);
        candidates.push(candidate);
      }
    }
    offset = magic + DART_SNAPSHOT_MAGIC.length;
  }
  return { sources, candidates };
};

const findGnuBuildIds = (bytes: Buffer): { readonly candidates: string[]; readonly failures: string[] } => {
  const header = readElfHeader(bytes.subarray(0, Math.min(bytes.length, ELF_HEADER_MAX_BYTES)), bytes.length);
  if (!('header' in header)) return { candidates: [], failures: [header.failure.reason] };
  const ids = new Set<string>();
  for (let offset = 0; offset + 16 < bytes.length; offset += 1) {
    if (bytes.subarray(offset, offset + 4).toString('latin1') !== 'GNU\0') continue;
    const desc = bytes.subarray(offset + 4, offset + 4 + 20);
    if (desc.length >= 8) ids.add(desc.subarray(0, 16).toString('hex'));
    if (ids.size >= 8) break;
  }
  return { candidates: [...ids], failures: [] };
};

const findLabeledStrings = (
  bytes: Buffer,
): {
  readonly dart_version: string | null;
  readonly dart_version_capped: boolean;
  readonly toolchain_lines: string[];
  readonly toolchain_capped: boolean;
} => {
  let dartVersion: string | null = null;
  let dartVersionCapped = false;
  const toolchainLines: string[] = [];
  let toolchainCapped = false;
  let carry = '';
  const flush = () => {
    const text = carry;
    carry = '';
    if (text.startsWith('Dart VM version:')) {
      if (!DART_VERSION_PATTERN.test(text)) dartVersionCapped = true;
      else if (dartVersion === null) dartVersion = text;
      else if (dartVersion !== text) dartVersionCapped = true;
      return;
    }
    if (!text.startsWith('Android (') && !text.startsWith('based on LLVM ')) return;
    if (!TOOLCHAIN_PATTERN.test(text)) {
      toolchainCapped = true;
      return;
    }
    if (toolchainLines.includes(text)) return;
    if (toolchainLines.length < MAX_TOOLCHAIN_LINES) toolchainLines.push(text);
    else toolchainCapped = true;
  };
  for (const byte of bytes) {
    if (byte >= 0x20 && byte < 0x7f) carry += String.fromCharCode(byte);
    else flush();
  }
  flush();
  return {
    dart_version: dartVersion,
    dart_version_capped: dartVersionCapped,
    toolchain_lines: toolchainLines,
    toolchain_capped: toolchainCapped,
  };
};

const abiFromLibPath = (logicalPath: string): string | null => {
  const match = /^lib\/([^/]+)\/(libapp|libflutter)\.so$/u.exec(logicalPath);
  return match?.[1] ?? null;
};

const buildIdentifyLimitations = (abis: readonly FlutterAbiFacts[], buildIdFailures: ReadonlyMap<string, readonly string[]>, flutterDetected: boolean): string[] => [
  'The APK is read through an owned read-only snapshot; concurrent changes to the original cannot mix into this observation',
  'The snapshot hash identifies a Dart SDK build only against an external mapping dataset; REA performs no lookup',
  'Release engine builds often carry no labeled Dart version string; absence is reported, not guessed',
  'Engine build IDs come only from ELF-declared PT_NOTE/SHT_NOTE records; conflicting or incompletely examined notes preserve candidates and report partial coverage',
  ...[...buildIdFailures.entries()].flatMap(([abi, failures]) => failures.map((reason) => `lib/${abi}/libflutter.so: ${reason}`)),
  ...abis.filter((entry) => entry.libflutter.toolchain_capped).map((entry) => `lib/${entry.abi}/libflutter.so has toolchain labels omitted by the complete-label grammar or the 4-line projection`),
  ...abis.filter((entry) => entry.libflutter.dart_version_capped).map((entry) => `lib/${entry.abi}/libflutter.so has Dart version labels omitted by the complete-label grammar or the single-version projection`),
  'The snapshot hash sits 20 bytes after each snapshot magic in the AOT payload; findings are observations of that layout',
  'ELF header validity checks the supported header layout and declared table extents; identification does not resolve symbols or validate table contents',
  ...abis
    .filter((entry) => entry.libapp.present && entry.libapp.snapshot_hash_sources !== 2)
    .map(
      (entry) =>
        `lib/${entry.abi}/libapp.so carries ${String(entry.libapp.snapshot_hash_sources)} observed snapshot header(s); complete coverage of the supported legacy split VM/isolate profile requires two independent sources. Unified and other layouts remain unverified`,
    ),
  ...abis
    .filter((entry) => entry.libapp.present && entry.libapp.elf_header_valid !== true)
    .map((entry) => `lib/${entry.abi}/libapp.so has a truncated, malformed, or unsupported ELF header or table extent; byte-scanned hashes remain observations only`),
  ...(flutterDetected ? [] : ['No lib/*/libapp.so was found; the target does not carry a Flutter AOT payload']),
];

export const identifyFlutterBuildFromPath = async (
  path: string,
  options: { readonly cwd?: string } = {},
): Promise<{
  readonly record: FlutterBuildInspection;
  readonly limitations: readonly string[];
  readonly path: string;
  readonly resolvedPath: string;
}> => {
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let canonical = resolvedPath;
  try {
    canonical = await realpath(resolvedPath);
  } catch {}
  let bytes: Buffer;
  try {
    bytes = await readFile(canonical);
  } catch (error) {
    throw inputError('identify_flutter_build', path, `it could not be read (${(error as Error).message})`);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw inputError('identify_flutter_build', path, `the archive is ${bytes.length} bytes, more than the ${MAX_FILE_BYTES} byte limit`);
  }
  let directory;
  try {
    directory = readZipDirectory(bytes);
  } catch (error) {
    throw inputError('identify_flutter_build', path, `it is not a ZIP/APK (${(error as Error).message})`);
  }
  const byAbi = new Map<string, { libapp?: (typeof directory.entries)[number]; libflutter?: (typeof directory.entries)[number] }>();
  for (const entry of directory.entries) {
    const abi = abiFromLibPath(entry.logical_path);
    if (abi === null) continue;
    const bucket = byAbi.get(abi) ?? {};
    if (entry.logical_path.endsWith('libapp.so')) bucket.libapp = entry;
    if (entry.logical_path.endsWith('libflutter.so')) bucket.libflutter = entry;
    byAbi.set(abi, bucket);
  }
  const abis: FlutterAbiFacts[] = [];
  const buildIdFailures = new Map<string, string[]>();
  for (const [abi, libs] of [...byAbi.entries()].toSorted(([left], [right]) => (left < right ? -1 : 1))) {
    const readLib = (entry: (typeof directory.entries)[number] | undefined) => {
      if (entry === undefined) {
        return {
          present: false,
          bytes: null,
          sha256: null,
          content: null as Buffer | null,
        };
      }
      try {
        const member = readZipMember(bytes, entry);
        return {
          present: true,
          bytes: member.bytes.length,
          sha256: createHash('sha256').update(member.bytes).digest('hex'),
          content: member.bytes,
        };
      } catch {
        return { present: true, bytes: entry.uncompressed_size, sha256: null, content: null };
      }
    };
    const app = readLib(libs.libapp);
    const flutter = readLib(libs.libflutter);
    const hashScan = app.content === null ? { sources: 0, candidates: [] as string[] } : findSnapshotHashes(app.content);
    const elfValid = app.content === null ? null : 'header' in readElfHeader(app.content.subarray(0, Math.min(app.content.length, ELF_HEADER_MAX_BYTES)), app.content.length);
    const buildIds = flutter.content === null ? { candidates: [] as string[], failures: [] as string[] } : findGnuBuildIds(flutter.content);
    if (buildIds.failures.length > 0) buildIdFailures.set(abi, [...buildIds.failures]);
    const labels =
      flutter.content === null
        ? {
            dart_version: null,
            dart_version_capped: false,
            toolchain_lines: [] as string[],
            toolchain_capped: false,
          }
        : findLabeledStrings(flutter.content);
    abis.push({
      abi,
      libapp: {
        present: app.present,
        bytes: app.bytes,
        sha256: app.sha256,
        elf_header_valid: elfValid,
        snapshot_hash_sources: hashScan.sources,
        snapshot_hash_candidates: hashScan.candidates,
        snapshot_hash: hashScan.candidates.length === 1 ? hashScan.candidates[0]! : null,
      },
      libflutter: {
        present: flutter.present,
        bytes: flutter.bytes,
        sha256: flutter.sha256,
        build_id: buildIds.candidates.length === 1 && buildIds.failures.length === 0 ? buildIds.candidates[0]! : null,
        build_id_candidates: buildIds.candidates,
        dart_version: labels.dart_version,
        toolchain_lines: labels.toolchain_lines,
        dart_version_capped: labels.dart_version_capped,
        toolchain_capped: labels.toolchain_capped,
      },
    });
  }
  const flutterDetected = abis.some((entry) => entry.libapp.present);
  const partial = abis.some(
    (entry) =>
      (entry.libapp.present && (entry.libapp.snapshot_hash === null || entry.libapp.snapshot_hash_sources !== 2 || entry.libapp.elf_header_valid !== true)) ||
      entry.libflutter.toolchain_capped ||
      entry.libflutter.dart_version_capped ||
      entry.libapp.present !== entry.libflutter.present,
  );
  return {
    path,
    resolvedPath: canonical,
    record: {
      target: {
        path: canonical,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      flutter_detected: flutterDetected,
      abis,
      coverage: partial ? 'partial' : 'complete',
    },
    limitations: buildIdentifyLimitations(abis, buildIdFailures, flutterDetected),
  };
};

const pickAbi = (abis: readonly FlutterAbiFacts[], requested: string | undefined): FlutterAbiFacts | undefined => {
  if (requested !== undefined) return abis.find((abi) => abi.abi === requested);
  for (const preferred of DEFAULT_ABI_ORDER) {
    const hit = abis.find((abi) => abi.abi === preferred && abi.libapp.present);
    if (hit !== undefined) return hit;
  }
  return abis.find((abi) => abi.libapp.present);
};

export const inspectDartAotFromPath = async (
  path: string,
  options: { readonly cwd?: string; readonly abi?: string; readonly detail?: 'complete' | 'summary' } = {},
): Promise<{ readonly record: DartAotInspection; readonly path: string; readonly resolvedPath: string }> => {
  const identified = await identifyFlutterBuildFromPath(path, options);
  const selected = pickAbi(identified.record.abis, options.abi);
  if (selected === undefined || !selected.libapp.present || selected.libapp.sha256 === null) {
    throw inputError('inspect_dart_aot', path, options.abi === undefined ? 'no libapp.so ABI was found' : `ABI ${JSON.stringify(options.abi)} has no libapp.so`);
  }
  const resolvedPath = identified.resolvedPath;
  const bytes = await readFile(resolvedPath);
  const directory = readZipDirectory(bytes);
  const entry = directory.entries.find((candidate) => candidate.logical_path === `lib/${selected.abi}/libapp.so`);
  if (entry === undefined) throw inputError('inspect_dart_aot', path, 'libapp.so entry disappeared');
  const member = readZipMember(bytes, entry);
  const elfAdmission = readElfHeader(member.bytes.subarray(0, Math.min(member.bytes.length, ELF_HEADER_MAX_BYTES)), member.bytes.length);
  if ('failure' in elfAdmission) {
    const reason = `No recognizable legacy split Dart snapshot symbols were found: ${elfAdmission.failure.reason}`;
    throw unsupportedTarget(
      `Unsupported target for inspect_dart_aot at ${resolvedPath}: ${reason}`,
      {
        operation: 'inspect_dart_aot',
        path: resolvedPath,
        reason,
      },
      'Select a target supported by this operation or choose an operation supporting the reported target format.',
    );
  }
  const hashScan = findSnapshotHashes(member.bytes);
  const package_uris: string[] = [];
  const dart_uris: string[] = [];
  const identifiers: string[] = [];
  const text = member.bytes.toString('latin1');
  for (const match of text.matchAll(/package:[a-zA-Z0-9_./]+/gu)) {
    if (match[0] && !package_uris.includes(match[0])) package_uris.push(match[0]);
    if (package_uris.length >= 64) break;
  }
  for (const match of text.matchAll(/dart:[a-zA-Z0-9_]+/gu)) {
    if (match[0] && !dart_uris.includes(match[0])) dart_uris.push(match[0]);
    if (dart_uris.length >= 64) break;
  }
  void options.detail;
  return {
    path,
    resolvedPath,
    record: {
      target: identified.record.target,
      abi: selected.abi,
      library: {
        path: `lib/${selected.abi}/libapp.so`,
        bytes: member.bytes.length,
        sha256: selected.libapp.sha256,
      },
      snapshots: [
        { name: 'vm_data', offset: null, size: null, magic: null, kind: null, length: null },
        { name: 'vm_instructions', offset: null, size: null, magic: null, kind: null, length: null },
        { name: 'isolate_data', offset: null, size: null, magic: null, kind: null, length: null },
        { name: 'isolate_instructions', offset: null, size: null, magic: null, kind: null, length: null },
      ],
      snapshot_hash: hashScan.candidates.length === 1 ? hashScan.candidates[0]! : null,
      string_pool: {
        package_uris,
        dart_uris,
        identifiers,
        truncated: package_uris.length >= 64 || dart_uris.length >= 64,
      },
      coverage: {
        state: 'partial',
        issues: ['Legacy split VM/isolate export offsets are not recovered without a full dynamic-symbol walk in this unit.', `Snapshot hash candidates observed: ${hashScan.candidates.length}`],
      },
      limitations: [...identified.limitations, 'String-pool entries are byte-pattern observations, not deserialized cluster semantics.'],
    },
  };
};
