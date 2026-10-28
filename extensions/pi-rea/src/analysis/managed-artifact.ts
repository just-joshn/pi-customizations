import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';
import { DIR, mapRva, type PeImage, parsePeImage } from './pe-core.ts';

const MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface ManagedArtifactInspection {
  readonly artifact: {
    readonly path: string;
    readonly sha256: string;
    readonly byte_length: number;
    readonly format: 'pe';
  };
  readonly pe: {
    readonly machine: number;
    readonly machine_hex: string;
    readonly architecture: string;
    readonly optional_header: 'pe32' | 'pe32-plus';
    readonly section_count: number;
    readonly characteristics: number;
    readonly cli: null | {
      readonly header_offset: number;
      readonly header_size: number;
      readonly runtime_version: string;
      readonly flags: number;
      readonly flag_names: readonly string[];
      readonly entry_point: { readonly kind: 'metadata-token' | 'native-rva' | 'none'; readonly value: string | null };
      readonly metadata_rva: number;
      readonly metadata_size: number;
      readonly resources_rva: number;
      readonly resources_size: number;
      readonly strong_name_rva: number;
      readonly strong_name_size: number;
      readonly managed_native_header_rva: number;
      readonly managed_native_header_size: number;
      readonly ready_to_run_signature: boolean;
    };
  };
  readonly classification: {
    readonly status: 'managed' | 'not-managed' | 'malformed';
    readonly container: 'pe';
    readonly runtime_family: 'dotnet-framework' | 'modern-dotnet' | 'unity-mono' | 'mixed-clr-native' | 'unknown';
    readonly implementation: 'cil' | 'cil-and-ready-to-run' | 'cpp-cli-mixed' | 'metadata-only' | 'not-managed' | 'unknown';
    readonly managed_architecture: string;
    readonly evidence: readonly { readonly code: string; readonly detail: string; readonly file_offset: number | null }[];
  };
  readonly metadata: {
    readonly status: 'absent' | 'complete' | 'partial' | 'malformed';
    readonly version: string | null;
    readonly stream_names: readonly string[];
    readonly table_row_counts: Readonly<Record<string, number>>;
  };
  readonly module: { readonly name: string; readonly mvid: string | null } | null;
  readonly assembly: { readonly name: string; readonly version: string | null } | null;
  readonly target_frameworks: readonly string[];
  readonly references: readonly { readonly name: string; readonly version: string | null }[];
  readonly resources: readonly { readonly name: string }[];
  readonly attributes: readonly { readonly parent_token: string; readonly constructor_token: string }[];
  readonly coverage: { readonly state: 'complete' | 'partial' | 'unavailable'; readonly issues: readonly string[] };
  readonly limitations: readonly string[];
}

const LIMITATIONS = ['Managed metadata is inventoried without loading assemblies or executing CIL.', 'Custom attribute blobs and strong-name signatures are not verified.'] as const;

const NOT_MANAGED_LIMITATION = 'The PE has no CLI data directory; managed metadata and CIL are unavailable.';

const artifactIdentity = (path: string, bytes: Buffer) => ({
  path,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  byte_length: bytes.length,
  format: 'pe' as const,
});

const TABLE_NAMES = [
  'Module',
  'TypeRef',
  'TypeDef',
  'FieldPtr',
  'Field',
  'MethodPtr',
  'MethodDef',
  'ParamPtr',
  'Param',
  'InterfaceImpl',
  'MemberRef',
  'Constant',
  'CustomAttribute',
  'FieldMarshal',
  'DeclSecurity',
  'ClassLayout',
  'FieldLayout',
  'StandAloneSig',
  'EventMap',
  'EventPtr',
  'Event',
  'PropertyMap',
  'PropertyPtr',
  'Property',
  'MethodSemantics',
  'MethodImpl',
  'ModuleRef',
  'TypeSpec',
  'ImplMap',
  'FieldRVA',
  'ENCLog',
  'ENCMap',
  'Assembly',
  'AssemblyProcessor',
  'AssemblyOS',
  'AssemblyRef',
  'AssemblyRefProcessor',
  'AssemblyRefOS',
  'File',
  'ExportedType',
  'ManifestResource',
  'NestedClass',
  'GenericParam',
  'MethodSpec',
  'GenericParamConstraint',
] as const;

const FLAG_NAMES: Record<number, string> = {
  1: 'ILOnly',
  2: 'Requires32Bit',
  4: 'ILLibrary',
  8: 'StrongNameSigned',
  16: 'NativeEntryPoint',
  65536: 'TrackDebugEnabled',
  131072: 'Prefer32Bit',
};

const inputError = (path: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_managed_artifact',
    issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${detail}` }],
  });

const readAscii = (bytes: Buffer, offset: number, end: number): string => {
  const zero = bytes.indexOf(0, offset);
  const stop = zero === -1 || zero > end ? end : zero;
  return bytes.subarray(offset, stop).toString('utf8');
};

const parseMetadata = (
  bytes: Buffer,
  metadataOffset: number,
  metadataSize: number,
): {
  readonly status: ManagedArtifactInspection['metadata']['status'];
  readonly version: string | null;
  readonly stream_names: string[];
  readonly table_row_counts: Record<string, number>;
  readonly module: ManagedArtifactInspection['module'];
  readonly assembly: ManagedArtifactInspection['assembly'];
  readonly references: ManagedArtifactInspection['references'];
  readonly issues: string[];
  readonly stringsHeap: Buffer | null;
  readonly tablesHeap: Buffer | null;
  readonly tableRowCounts: number[];
  readonly heapSizes: number;
} => {
  const end = metadataOffset + metadataSize;
  if (metadataOffset + 16 > bytes.length || end > bytes.length) {
    return {
      status: 'malformed',
      version: null,
      stream_names: [],
      table_row_counts: {},
      module: null,
      assembly: null,
      references: [],
      issues: ['CLI metadata root extends past the file'],
      stringsHeap: null,
      tablesHeap: null,
      tableRowCounts: [],
      heapSizes: 0,
    };
  }
  if (bytes.readUInt32LE(metadataOffset) !== 0x424a5342) {
    return {
      status: 'malformed',
      version: null,
      stream_names: [],
      table_row_counts: {},
      module: null,
      assembly: null,
      references: [],
      issues: ['CLI metadata signature is not BSJB'],
      stringsHeap: null,
      tablesHeap: null,
      tableRowCounts: [],
      heapSizes: 0,
    };
  }
  const versionLength = bytes.readUInt32LE(metadataOffset + 12);
  const versionStart = metadataOffset + 16;
  const version = readAscii(bytes, versionStart, versionStart + versionLength);
  const streamsOffset = versionStart + ((versionLength + 3) & ~3) + 2;
  if (streamsOffset + 2 > end) {
    return {
      status: 'partial',
      version,
      stream_names: [],
      table_row_counts: {},
      module: null,
      assembly: null,
      references: [],
      issues: ['stream header truncated'],
      stringsHeap: null,
      tablesHeap: null,
      tableRowCounts: [],
      heapSizes: 0,
    };
  }
  const streamCount = bytes.readUInt16LE(streamsOffset);
  let cursor = streamsOffset + 2;
  const stream_names: string[] = [];
  const streams = new Map<string, { offset: number; size: number }>();
  for (let index = 0; index < streamCount; index += 1) {
    if (cursor + 8 > end) break;
    const offset = bytes.readUInt32LE(cursor);
    const size = bytes.readUInt32LE(cursor + 4);
    cursor += 8;
    const nameStart = cursor;
    while (cursor < end && bytes[cursor] !== 0) cursor += 1;
    const name = bytes.subarray(nameStart, cursor).toString('utf8');
    cursor = (cursor + 1 + 3) & ~3;
    stream_names.push(name);
    streams.set(name, { offset: metadataOffset + offset, size });
  }
  const strings = streams.get('#Strings');
  const tables = streams.get('#~') ?? streams.get('#-');
  const stringsHeap = strings === undefined ? null : bytes.subarray(strings.offset, strings.offset + strings.size);
  const tablesHeap = tables === undefined ? null : bytes.subarray(tables.offset, tables.offset + tables.size);
  const table_row_counts: Record<string, number> = {};
  const tableRowCounts: number[] = [];
  let heapSizes = 0;
  let module: ManagedArtifactInspection['module'] = null;
  const assembly: ManagedArtifactInspection['assembly'] = null;
  const references: { name: string; version: string | null }[] = [];
  const issues: string[] = [];

  if (tablesHeap !== null && tablesHeap.length >= 24) {
    heapSizes = tablesHeap[6] ?? 0;
    const valid = tablesHeap.readBigUInt64LE(8);
    let rowCursor = 24;
    for (let bit = 0; bit < 64; bit += 1) {
      if (((valid >> BigInt(bit)) & 1n) === 0n) {
        tableRowCounts.push(0);
        continue;
      }
      if (rowCursor + 4 > tablesHeap.length) {
        issues.push('table row-count region truncated');
        break;
      }
      const rows = tablesHeap.readUInt32LE(rowCursor);
      rowCursor += 4;
      tableRowCounts.push(rows);
      const name = TABLE_NAMES[bit];
      if (name !== undefined) table_row_counts[name] = rows;
    }
    const stringIndexSize = (heapSizes & 0x01) !== 0 ? 4 : 2;
    const guidIndexSize = (heapSizes & 0x02) !== 0 ? 4 : 2;
    const readStr = (index: number): string => {
      if (stringsHeap === null || index <= 0 || index >= stringsHeap.length) return '';
      return readAscii(stringsHeap, index, stringsHeap.length);
    };
    // Module table: Generation(2) Name(str) Mvid(guid) EncId(guid) EncBaseId(guid)
    const moduleRows = tableRowCounts[0] ?? 0;
    if (moduleRows > 0) {
      const rowSize = 2 + stringIndexSize + guidIndexSize * 3;
      if (rowCursor + rowSize <= tablesHeap.length) {
        const nameIndex = stringIndexSize === 4 ? tablesHeap.readUInt32LE(rowCursor + 2) : tablesHeap.readUInt16LE(rowCursor + 2);
        module = { name: readStr(nameIndex), mvid: null };
      }
      rowCursor += rowSize * moduleRows;
    }
  }

  return {
    status: tablesHeap === null ? 'partial' : issues.length > 0 ? 'partial' : 'complete',
    version,
    stream_names,
    table_row_counts,
    module,
    assembly,
    references,
    issues,
    stringsHeap,
    tablesHeap,
    tableRowCounts,
    heapSizes,
  };
};

void parseMetadata;

const inspectImage = (bytes: Buffer, path: string): ManagedArtifactInspection => {
  let image: PeImage;
  try {
    image = parsePeImage(bytes);
  } catch (error) {
    throw inputError(path, `it is not a PE image (${(error as Error).message})`);
  }
  const characteristics = bytes.readUInt16LE(image.peOffset + 22);
  const cliDir = image.directories[DIR.CLR];
  const evidence: ManagedArtifactInspection['classification']['evidence'][number][] = [];
  if (cliDir === undefined || cliDir.rva === 0 || cliDir.size === 0) {
    return {
      artifact: artifactIdentity(path, bytes),
      pe: {
        machine: image.machine,
        machine_hex: `0x${image.machine.toString(16).padStart(4, '0')}`,
        architecture: image.architecture === 'x86_64' ? 'x86_64' : image.architecture === 'x86' ? 'x86' : image.architecture === 'arm64' ? 'arm64' : image.architecture === 'arm' ? 'arm' : 'x86',
        optional_header: image.format,
        section_count: image.sections.length,
        characteristics,
        cli: null,
      },
      classification: {
        status: 'not-managed',
        container: 'pe',
        runtime_family: 'unknown',
        implementation: 'not-managed',
        managed_architecture: 'unknown',
        evidence: [{ code: 'cli-directory-absent', detail: NOT_MANAGED_LIMITATION, file_offset: null }],
      },
      metadata: { status: 'absent', version: null, stream_names: [], table_row_counts: {} },
      module: null,
      assembly: null,
      target_frameworks: [],
      references: [],
      resources: [],
      attributes: [],
      coverage: { state: 'unavailable', issues: [] },
      limitations: [NOT_MANAGED_LIMITATION],
    };
  }
  const headerOffset = mapRva(image.sections, cliDir.rva);
  if (headerOffset === undefined || headerOffset + 72 > bytes.length) {
    return {
      artifact: artifactIdentity(path, bytes),
      pe: {
        machine: image.machine,
        machine_hex: `0x${image.machine.toString(16).padStart(4, '0')}`,
        architecture: image.architecture === 'unknown' ? 'x86' : image.architecture,
        optional_header: image.format,
        section_count: image.sections.length,
        characteristics,
        cli: null,
      },
      classification: {
        status: 'malformed',
        container: 'pe',
        runtime_family: 'unknown',
        implementation: 'unknown',
        managed_architecture: 'unknown',
        evidence: [{ code: 'clr-header-unmapped', detail: 'CLR header RVA could not be mapped', file_offset: null }],
      },
      metadata: { status: 'malformed', version: null, stream_names: [], table_row_counts: {} },
      module: null,
      assembly: null,
      target_frameworks: [],
      references: [],
      resources: [],
      attributes: [],
      coverage: { state: 'partial', issues: ['CLR header unmapped'] },
      limitations: [...LIMITATIONS],
    };
  }
  const headerSize = bytes.readUInt32LE(headerOffset);
  const major = bytes.readUInt16LE(headerOffset + 4);
  const minor = bytes.readUInt16LE(headerOffset + 6);
  const metaRva = bytes.readUInt32LE(headerOffset + 8);
  const metaSize = bytes.readUInt32LE(headerOffset + 12);
  const flags = bytes.readUInt32LE(headerOffset + 16);
  const entryToken = bytes.readUInt32LE(headerOffset + 20);
  const resources_rva = bytes.readUInt32LE(headerOffset + 24);
  const resources_size = bytes.readUInt32LE(headerOffset + 28);
  const strong_name_rva = bytes.readUInt32LE(headerOffset + 32);
  const strong_name_size = bytes.readUInt32LE(headerOffset + 36);
  const managed_native_header_rva = bytes.readUInt32LE(headerOffset + 64);
  const managed_native_header_size = bytes.readUInt32LE(headerOffset + 68);
  const flag_names = Object.entries(FLAG_NAMES)
    .filter(([bit]) => (flags & Number(bit)) !== 0)
    .map(([, name]) => name);
  const ready_to_run_signature = managed_native_header_rva !== 0 && managed_native_header_size >= 4;
  evidence.push({ code: 'clr-directory', detail: `CLR header at file offset ${headerOffset}`, file_offset: headerOffset });
  const metaOffset = mapRva(image.sections, metaRva);
  let metadata: ManagedArtifactInspection['metadata'] = {
    status: 'absent',
    version: null,
    stream_names: [],
    table_row_counts: {},
  };
  let module: ManagedArtifactInspection['module'] = null;
  let assembly: ManagedArtifactInspection['assembly'] = null;
  let references: ManagedArtifactInspection['references'] = [];
  const issues: string[] = [];
  if (metaOffset !== undefined) {
    const parsed = parseMetadata(bytes, metaOffset, metaSize);
    metadata = {
      status: parsed.status,
      version: parsed.version,
      stream_names: parsed.stream_names,
      table_row_counts: parsed.table_row_counts,
    };
    module = parsed.module;
    assembly = parsed.assembly;
    references = parsed.references;
    issues.push(...parsed.issues);
  } else {
    issues.push('metadata RVA unmapped');
    metadata = { status: 'malformed', version: null, stream_names: [], table_row_counts: {} };
  }
  const ilOnly = (flags & 0x1) !== 0;
  const requires32 = (flags & 0x2) !== 0;
  const prefer32 = (flags & 0x20000) !== 0;
  const nativeEntry = (flags & 0x10) !== 0;
  return {
    artifact: artifactIdentity(path, bytes),
    pe: {
      machine: image.machine,
      machine_hex: `0x${image.machine.toString(16).padStart(4, '0')}`,
      architecture: image.architecture === 'unknown' ? 'x86' : image.architecture,
      optional_header: image.format,
      section_count: image.sections.length,
      characteristics,
      cli: {
        header_offset: headerOffset,
        header_size: headerSize,
        runtime_version: `${major}.${minor}`,
        flags,
        flag_names,
        entry_point: entryToken === 0 ? { kind: 'none', value: null } : nativeEntry ? { kind: 'native-rva', value: `0x${entryToken.toString(16)}` } : { kind: 'metadata-token', value: `0x${entryToken.toString(16)}` },
        metadata_rva: metaRva,
        metadata_size: metaSize,
        resources_rva,
        resources_size,
        strong_name_rva,
        strong_name_size,
        managed_native_header_rva,
        managed_native_header_size,
        ready_to_run_signature,
      },
    },
    classification: {
      status: 'managed',
      container: 'pe',
      runtime_family: 'unknown',
      implementation: ready_to_run_signature ? 'cil-and-ready-to-run' : nativeEntry ? 'cpp-cli-mixed' : ilOnly ? 'cil' : 'unknown',
      managed_architecture: requires32 || prefer32 ? 'anycpu-prefer-32' : ilOnly ? 'anycpu' : image.architecture,
      evidence,
    },
    metadata,
    module,
    assembly,
    target_frameworks: [],
    references,
    resources: [],
    attributes: [],
    coverage: { state: issues.length === 0 ? 'complete' : 'partial', issues },
    limitations: [...LIMITATIONS],
  };
};

export const inspectManagedArtifactFromPath = async (path: string, options: { readonly cwd?: string } = {}): Promise<{ readonly record: ManagedArtifactInspection; readonly path: string; readonly resolvedPath: string }> => {
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let canonical = resolvedPath;
  try {
    canonical = await realpath(resolvedPath);
  } catch {}
  let bytes: Buffer;
  try {
    bytes = await readFile(canonical);
  } catch (error) {
    throw inputError(path, `it could not be read (${(error as Error).message})`);
  }
  if (bytes.length > MAX_FILE_BYTES) throw inputError(path, `the image is ${bytes.length} bytes, more than the ${MAX_FILE_BYTES} byte limit`);
  const record = inspectImage(bytes, canonical);
  return { record, path, resolvedPath: canonical };
};

export const buildMinimalCliPeFixture = (): Buffer => {
  const dos = Buffer.alloc(0x80);
  dos.write('MZ', 0);
  dos.writeUInt32LE(0x80, 0x3c);
  const pe = Buffer.alloc(0x200);
  pe.write('PE\0\0', 0);
  pe.writeUInt16LE(0x8664, 4);
  pe.writeUInt16LE(1, 6);
  pe.writeUInt16LE(0xf0, 20);
  pe.writeUInt16LE(0x20b, 24);
  pe.writeUInt32LE(0x200, 24 + 56);
  pe.writeUInt32LE(16, 24 + 108);
  const directoriesOffset = 24 + 112;
  const sectionStart = 24 + 0xf0;
  const rawOffset = 0x200;
  pe.write('.text\0\0\0', sectionStart);
  pe.writeUInt32LE(0x200, sectionStart + 8);
  pe.writeUInt32LE(0x2000, sectionStart + 12);
  pe.writeUInt32LE(0x200, sectionStart + 16);
  pe.writeUInt32LE(rawOffset, sectionStart + 20);
  const clrRva = 0x2000;
  pe.writeUInt32LE(clrRva, directoriesOffset + 14 * 8);
  pe.writeUInt32LE(72, directoriesOffset + 14 * 8 + 4);
  const text = Buffer.alloc(0x200);
  text.writeUInt32LE(72, 0);
  text.writeUInt16LE(2, 4);
  text.writeUInt16LE(5, 6);
  text.writeUInt32LE(0x2050, 8);
  text.writeUInt32LE(0x80, 12);
  text.writeUInt32LE(0x1, 16);
  const meta = 0x50;
  text.write('BSJB', meta);
  text.writeUInt16LE(1, meta + 4);
  text.writeUInt16LE(1, meta + 6);
  text.writeUInt32LE(0, meta + 8);
  const version = 'v4.0.30319\0\0\0\0';
  text.writeUInt32LE(12, meta + 12);
  text.write(version, meta + 16);
  const streamsHeader = meta + 16 + 12 + 2;
  text.writeUInt16LE(0, streamsHeader - 2);
  text.writeUInt16LE(1, streamsHeader);
  text.writeUInt32LE(0x40, streamsHeader + 2);
  text.writeUInt32LE(8, streamsHeader + 6);
  text.write('#~\0\0', streamsHeader + 10);
  text.writeUInt32LE(0, meta + 0x40);
  text.writeUInt8(0, meta + 0x46);
  return Buffer.concat([dos, pe.subarray(0, 0x180), text]);
};
