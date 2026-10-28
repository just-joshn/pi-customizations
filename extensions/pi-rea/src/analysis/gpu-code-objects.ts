
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const GPU_LIMITATIONS = [
  'Static declarations only; no GPU execution, SASS disassembly, host launch correlation or runtime compatibility was verified.',
  'Object IDs are positional identities scoped to artifact.sha256. Locations inside decoded objects name their containing object; they are not file offsets.',
  'Full-file SHA-256 streams every file byte; section and selected payload reads add to artifact.bytes_read. Retained Evidence is historical and never reopens the target.',
] as const;

export interface GpuObjectLocation {
  readonly container_id: string | null;
  readonly offset: number;
  readonly size: number;
  readonly section_index: number | null;
  readonly section_name: string | null;
}

export interface GpuCodeObject {
  readonly id: string;
  readonly parent_id: string | null;
  readonly kind: string;
  readonly target: string | null;
  readonly payload_target: string | null;
  readonly cuda_target_header: string | null;
  readonly target_consistency: 'unexamined' | 'matched' | 'mismatched';
  readonly bundle_id: string | null;
  readonly compression: string;
  readonly compression_id: string | null;
  readonly encoded_size: number;
  readonly decoded_size: number | null;
  readonly sha256: string | null;
  readonly raw_flags: number | null;
  readonly location: GpuObjectLocation;
  readonly metadata_location: GpuObjectLocation;
  readonly inspection: 'inventory' | 'kernels';
  readonly limitations: readonly string[];
}

export interface GpuCodeObjectsInspection {
  readonly artifact: { readonly path: string; readonly file_size: number; readonly sha256: string; readonly bytes_read: number };
  readonly format: 'elf' | 'pe' | 'cuda-fatbin' | 'hip-bundle' | 'ptx';
  readonly analysis: 'inventory' | 'kernels';
  readonly objects: readonly GpuCodeObject[];
  readonly kernels: readonly Record<string, unknown>[];
  readonly ptx_artifacts: readonly Record<string, unknown>[];
  readonly coverage: {
    readonly discovery_scope: 'supported-section-names-and-standalone-formats';
    readonly discovery: 'complete';
    readonly payloads: 'not-requested' | 'selected';
    readonly examined_sections: number;
    readonly unknown_section_names: number;
  };
  readonly limitations: readonly string[];
}

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_gpu_code_objects',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const emptyLocation = (offset = 0, size = 0): GpuObjectLocation => ({
  container_id: null,
  offset,
  size,
  section_index: null,
  section_name: null,
});

const GPU_SECTION_HINTS = ['.nv_fatbin', '.nvFatBinSegment', '.hip_fat', '.hipFatBin', '__nv_relfatbin', '.note.nv'];

const bytesReadFor = (fileSize: number, extraPayloadReads: number): number => fileSize + extraPayloadReads + 32;

const parsePtx = (bytes: Buffer, path: string, analysis: 'inventory' | 'kernels'): GpuCodeObjectsInspection => {
  const text = bytes.toString('utf8');
  if (!text.includes('.version') || !/\.target\s+/.test(text)) {
    throw inputError(path, 'invalid_format', 'PTX text markers (.version/.target) were not observed.');
  }
  const target = text.match(/\.target\s+([A-Za-z0-9_]+)/)?.[1] ?? null;
  const entryPoints = [...text.matchAll(/\.entry\s+([A-Za-z0-9_$]+)/g)].map((match) => match[1]!);
  const digest = sha256(bytes);
  const objectId = 'file@0';
  const object: GpuCodeObject = {
    id: objectId,
    parent_id: null,
    kind: 'ptx',
    target,
    payload_target: null,
    cuda_target_header: null,
    target_consistency: 'unexamined',
    bundle_id: null,
    compression: 'none',
    compression_id: null,
    encoded_size: bytes.length,
    decoded_size: bytes.length,
    sha256: null,
    raw_flags: null,
    location: emptyLocation(0, bytes.length),
    metadata_location: emptyLocation(0, 0),
    inspection: analysis,
    limitations: [],
  };
  return {
    artifact: {
      path,
      file_size: bytes.length,
      sha256: digest,
      bytes_read: bytesReadFor(bytes.length, bytes.length),
    },
    format: 'ptx',
    analysis,
    objects: [object],
    kernels:
      analysis === 'kernels'
        ? entryPoints.map((name) => ({
            object_id: objectId,
            name,
            kind: 'ptx_entry',
            target,
            registers: null,
            shared_memory_bytes: null,
          }))
        : [],
    ptx_artifacts: [],
    coverage: {
      discovery_scope: 'supported-section-names-and-standalone-formats',
      discovery: 'complete',
      payloads: analysis === 'kernels' ? 'selected' : 'not-requested',
      examined_sections: 0,
      unknown_section_names: 0,
    },
    limitations: [...GPU_LIMITATIONS],
  };
};

const parseElfInventory = (bytes: Buffer, path: string, analysis: 'inventory' | 'kernels'): GpuCodeObjectsInspection => {
  if (bytes.length < 64 || bytes.subarray(0, 4).toString('ascii') !== '\u007fELF') {
    throw inputError(path, 'invalid_format', 'not an ELF host for GPU objects.');
  }
  const little = bytes[5] === 1;
  const bits = bytes[4] === 2 ? 64 : 32;
  const readU16 = (offset: number) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const readU32 = (offset: number) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const readU64 = (offset: number) => Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset));
  const shoff = bits === 64 ? readU64(40) : readU32(32);
  const shentsize = readU16(bits === 64 ? 58 : 46);
  const shnum = readU16(bits === 64 ? 60 : 48);
  const shstrndx = readU16(bits === 64 ? 62 : 50);
  const headers: { nameOffset: number; offset: number; size: number }[] = [];
  for (let index = 0; index < shnum; index += 1) {
    const base = shoff + index * shentsize;
    headers.push({
      nameOffset: readU32(base),
      offset: bits === 64 ? readU64(base + 24) : readU32(base + 16),
      size: bits === 64 ? readU64(base + 32) : readU32(base + 20),
    });
  }
  const str = headers[shstrndx];
  if (str === undefined) throw inputError(path, 'invalid_format', 'ELF shstrtab missing');
  const strtab = bytes.subarray(str.offset, str.offset + str.size);
  const nameAt = (offset: number) => {
    const end = strtab.indexOf(0, offset);
    return strtab.subarray(offset, end === -1 ? strtab.length : end).toString('utf8');
  };
  let unknown = 0;
  const objects: GpuCodeObject[] = [];
  let examined = 0;
  let payloadBytes = 0;
  for (let sectionIndex = 0; sectionIndex < headers.length; sectionIndex += 1) {
    const header = headers[sectionIndex]!;
    const name = nameAt(header.nameOffset);
    if (name.length === 0) continue;
    examined += 1;
    if (!GPU_SECTION_HINTS.some((hint) => name === hint || name.includes('fatbin') || name.includes('nv') || name.includes('hip'))) {
      continue;
    }
    if (header.offset + header.size > bytes.length) {
      unknown += 1;
      continue;
    }
    payloadBytes += header.size;
    const payload = bytes.subarray(header.offset, header.offset + header.size);
    const digest = sha256(payload);
    objects.push({
      id: `section@${sectionIndex}`,
      parent_id: null,
      kind: name.includes('hip') ? 'hip-fatbin-section' : 'cuda-fatbin-section',
      target: null,
      payload_target: null,
      cuda_target_header: null,
      target_consistency: 'unexamined',
      bundle_id: null,
      compression: 'none',
      compression_id: null,
      encoded_size: header.size,
      decoded_size: header.size,
      sha256: digest,
      raw_flags: null,
      location: {
        container_id: null,
        offset: header.offset,
        size: header.size,
        section_index: sectionIndex,
        section_name: name,
      },
      metadata_location: emptyLocation(0, 0),
      inspection: analysis,
      limitations: [],
    });
  }
  return {
    artifact: {
      path,
      file_size: bytes.length,
      sha256: sha256(bytes),
      bytes_read: bytesReadFor(bytes.length, payloadBytes),
    },
    format: 'elf',
    analysis,
    objects,
    kernels: [],
    ptx_artifacts: [],
    coverage: {
      discovery_scope: 'supported-section-names-and-standalone-formats',
      discovery: 'complete',
      payloads: analysis === 'kernels' ? 'selected' : 'not-requested',
      examined_sections: examined,
      unknown_section_names: unknown,
    },
    limitations: [
      ...GPU_LIMITATIONS,
      ...(analysis === 'kernels' ? ['Selected kernel decode for ELF fatbin payloads is not implemented in this port; inventory rows remain.'] : []),
    ],
  };
};

export interface GpuOptions {
  readonly analysis?: 'inventory' | 'kernels';
  readonly expectedSha256?: string;
  readonly objectIds?: readonly string[];
  readonly targets?: readonly string[];
  readonly cwd?: string;
}

export const inspectGpuCodeObjectsFromPath = async (
  path: string,
  options: GpuOptions = {},
): Promise<{ record: GpuCodeObjectsInspection; path: string; resolvedPath: string }> => {
  const analysis = options.analysis ?? 'inventory';
  if (analysis !== 'inventory' && analysis !== 'kernels') throw inputError(path, 'invalid_value', 'analysis must be inventory or kernels.');
  if (options.objectIds !== undefined && options.expectedSha256 === undefined) {
    throw inputError(path, 'invalid_value', 'object_ids require expected_sha256 from inventory.');
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }
  const digest = sha256(bytes);
  if (options.expectedSha256 !== undefined && options.expectedSha256 !== digest) {
    throw inputError(path, 'invalid_value', 'expected_sha256 does not match the current full-file digest.');
  }

  const textStart = bytes.subarray(0, Math.min(bytes.length, 256)).toString('utf8');
  if (textStart.includes('.version') && textStart.includes('.target')) {
    const record = parsePtx(bytes, resolvedPath, analysis);
    if (options.objectIds !== undefined) {
      const selected = new Set(options.objectIds);
      return {
        record: {
          ...record,
          objects: record.objects.map((object) =>
            selected.has(object.id) ? { ...object, inspection: 'kernels' as const } : object,
          ),
          kernels: record.kernels.filter((kernel) => selected.has(String((kernel as { object_id?: string }).object_id))),
          coverage: { ...record.coverage, payloads: 'selected' },
        },
        path,
        resolvedPath,
      };
    }
    return { record, path, resolvedPath };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === '\u007fELF') {
    return { record: parseElfInventory(bytes, resolvedPath, analysis), path, resolvedPath };
  }
  throw inputError(path, 'invalid_format', 'unsupported GPU code object container (expected PTX text or ELF host).');
};
