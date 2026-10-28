import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

import { unsupportedTarget } from '../contract/errors.ts';
import { sha256Hex } from '../session/evidence.ts';
import { normalizeMemberPath, readZipDirectory, readZipMember, ZipError } from './formats/zip.mjs';

const digestOf = (input: string | Uint8Array): string => (typeof input === 'string' ? sha256Hex(input) : createHash('sha256').update(input).digest('hex'));

export interface ExtractedArtifactRow {
  readonly artifact_id: string;
  readonly relative_path: string;
  readonly sha256: string;
  readonly bytes_written: number;
  readonly created: boolean;
}

export interface ExtractArtifactInspection {
  readonly manifest: {
    readonly manifest_id: string;
    readonly root_artifact_id: string;
    readonly root_sha256: string;
    readonly root_format: string;
    readonly graph_sha256: string;
    readonly node_count: number;
    readonly occurrence_count: number;
    readonly edge_count: number;
  };
  readonly extraction_manifest: {
    readonly extraction_id: string;
    readonly source_manifest_id: string;
    readonly selected_occurrence_ids: readonly string[];
    readonly files_sha256: string;
    readonly output_root_alias: '$OUTPUT_ROOT';
  };
  readonly output_root: string;
  readonly artifacts: readonly ExtractedArtifactRow[];
  readonly containment_verified: boolean;
  readonly cleanup: { readonly attempted: boolean; readonly verified: boolean; readonly residual_paths: readonly string[] };
  readonly coverage: { readonly scope: 'container-entries'; readonly status: 'complete' | 'partial' };
  readonly provenance: readonly unknown[];
  readonly integrity_contradictions: readonly unknown[];
  readonly limitations: readonly string[];
}

const LIMITATIONS = [
  'ZIP inventory lists central-directory entries only. Non-entry bytes, including leading bytes before the first entry such as a self-extractor stub, an APK Signing Block before the central directory or a ZIP comment after it, are not occurrences.',
  'All regular files exposed by the active artifact reader were materialized.',
  'Publication verifies the selected inventoried regular files; it does not establish complete content decoding.',
] as const;

const assertInsideRoot = (root: string, candidate: string): void => {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(resolvedRoot + sep)) {
    throw new Error(`Refusing to write outside extraction root: ${candidate}`);
  }
};

export const extractZipArtifact = async (
  bytes: Buffer,
  options: {
    readonly rootSha256: string;
    readonly rootFormat: string;
    readonly integrityPolicy?: 'fail' | 'record-and-continue';
  },
): Promise<ExtractArtifactInspection> => {
  const integrityPolicy = options.integrityPolicy ?? 'fail';
  let directory: ReturnType<typeof readZipDirectory>;
  try {
    directory = readZipDirectory(bytes);
  } catch (error: unknown) {
    if (error instanceof ZipError) {
      throw unsupportedTarget(`ZIP extraction failed: ${error.message}`, { reason: error.code });
    }
    throw error;
  }

  const outputRoot = await mkdtemp(join(tmpdir(), 'pi-rea-extracted-'));
  const canonicalRoot = await realpath(outputRoot);
  const artifacts: ExtractedArtifactRow[] = [];
  const selectedOccurrenceIds: string[] = [];
  const integrityContradictions: unknown[] = [];
  const fileDigests: string[] = [];

  try {
    for (const entry of directory.entries) {
      const safety = normalizeMemberPath(entry.logical_path);
      const occurrenceId = `occ_${digestOf(`${entry.logical_path}:${entry.local_header_offset}:${entry.compressed_size}`)}`;
      if (entry.is_directory || safety.safe === false) continue;
      let member: ReturnType<typeof readZipMember>;
      try {
        member = readZipMember(bytes, entry);
      } catch (error: unknown) {
        if (error instanceof ZipError) {
          integrityContradictions.push({
            logical_path: entry.logical_path,
            reason: error.code,
            check: 'member-read',
          });
          if (integrityPolicy === 'fail') {
            throw unsupportedTarget(`Declared artifact integrity does not match for ${entry.logical_path}.`, {
              reason: error.code,
            });
          }
          continue;
        }
        throw error;
      }
      if (member.crc_ok === false) {
        integrityContradictions.push({
          logical_path: entry.logical_path,
          reason: 'crc32',
          check: 'crc32',
          calculated_sha256: digestOf(member.bytes),
        });
        if (integrityPolicy === 'fail') {
          throw unsupportedTarget(`Declared artifact integrity does not match for ${entry.logical_path}.`, {
            reason: 'crc32',
          });
        }
      }

      const relativePath = safety.path;
      const destination = join(canonicalRoot, relativePath);
      assertInsideRoot(canonicalRoot, destination);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, member.bytes, { flag: 'wx' });
      const sha256 = createHash('sha256').update(member.bytes).digest('hex');
      fileDigests.push(`${relativePath}:${sha256}`);
      selectedOccurrenceIds.push(occurrenceId);
      artifacts.push({
        artifact_id: `art_${sha256}`,
        relative_path: relativePath,
        sha256,
        bytes_written: member.bytes.length,
        created: true,
      });
    }
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }

  let containmentVerified = true;
  for (const row of artifacts) {
    try {
      const resolved = await realpath(join(canonicalRoot, row.relative_path));
      assertInsideRoot(canonicalRoot, resolved);
    } catch {
      containmentVerified = false;
    }
  }

  const rootArtifactId = `art_${options.rootSha256}`;
  const manifestId = `agm_${options.rootSha256}`;
  const graphSha = digestOf(
    JSON.stringify({
      root: options.rootSha256,
      occurrences: selectedOccurrenceIds,
      artifacts: artifacts.map((row) => row.sha256),
    }),
  );
  const filesSha = digestOf(fileDigests.sort().join('\n'));
  const extractionId = `aex_${digestOf(`${manifestId}:${filesSha}:${randomUUID()}`)}`;

  return {
    manifest: {
      manifest_id: manifestId,
      root_artifact_id: rootArtifactId,
      root_sha256: options.rootSha256,
      root_format: options.rootFormat,
      graph_sha256: graphSha,
      node_count: artifacts.length + 1,
      occurrence_count: artifacts.length + 1,
      edge_count: artifacts.length,
    },
    extraction_manifest: {
      extraction_id: extractionId,
      source_manifest_id: manifestId,
      selected_occurrence_ids: selectedOccurrenceIds,
      files_sha256: filesSha,
      output_root_alias: '$OUTPUT_ROOT',
    },
    output_root: canonicalRoot,
    artifacts,
    containment_verified: containmentVerified,
    cleanup: { attempted: false, verified: true, residual_paths: [] },
    coverage: {
      scope: 'container-entries',
      status: integrityContradictions.length > 0 ? 'partial' : 'complete',
    },
    provenance: [],
    integrity_contradictions: integrityContradictions,
    limitations: [...LIMITATIONS],
  };
};
