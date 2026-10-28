import { digestOf } from '../canonical.mjs';
import { readZipDirectory, readZipMember, ZipError } from './zip.mjs';

const MEMBER_PAGE_LIMIT = 2000;

const ZIP_LIMITATION =
  'ZIP inventory lists central-directory entries only. Non-entry bytes, including leading bytes before the first entry such as a self-extractor stub, an APK Signing Block before the central directory or a ZIP comment after it, are not occurrences.';

export function inspectArtifact({ bytes, subject, integrityPolicy = 'fail' }) {
  const directory = readZipDirectoryOrThrow(bytes);
  const capped = directory.entries.slice(0, MEMBER_PAGE_LIMIT);
  const members = capped.map((entry) => memberOf(bytes, entry));
  const integrityContradictions = contradictionsIn(members);
  const unreadable = members.filter((member) => member.read_status === 'unreadable');
  if ((integrityContradictions.length > 0 || unreadable.length > 0) && integrityPolicy === 'fail') {
    throw integrityFailure(integrityContradictions.length > 0 ? integrityContradictions : unreadable.map(unreadableContradiction));
  }

  const rootSha = subject.digest.sha256;
  const rootArtifactId = `art_${digestOf(`root:${rootSha}`)}`;
  const rootOccurrenceId = `occ_${digestOf(`root-occurrence:${rootSha}`)}`;
  const rootNode = {
    artifact_id: rootArtifactId,
    format: subject.format,
    sha256: rootSha,
    size: bytes.length,
    media_type: null,
    architecture: null,
    content_state: 'materialized',
    limitations: [],
  };

  const memberNodes = [...members]
    .filter((member) => member.calculated_sha256 !== null)
    .map((member) => ({
      artifact_id: `art_${digestOf(`member:${member.calculated_sha256}`)}`,
      format: member.artifact_format === 'javascript-bundle' ? 'file' : member.artifact_format,
      sha256: member.calculated_sha256,
      size: member.uncompressed_bytes,
      media_type: null,
      architecture: null,
      content_state: 'embedded',
      limitations: [],
      logical_path: member.logical_path,
      occurrence_id: member.occurrence_id,
      artifact_kind: member.artifact_kind,
      artifact_format: member.artifact_format,
      compressed_size: member.compressed_bytes,
      declared_size: member.uncompressed_bytes,
    }))
    .sort((left, right) => compareText(left.artifact_id, right.artifact_id));

  const rootOccurrence = {
    occurrence_id: rootOccurrenceId,
    artifact_id: rootArtifactId,
    parent_occurrence_id: null,
    logical_path: '.',
    entry_kind: 'file',
    artifact_kind: 'container',
    artifact_format: subject.format,
    declared_size: bytes.length,
    compressed_size: null,
    executable: false,
    encrypted: false,
    hash_status: 'verified',
    source_location: null,
    limitations: [],
  };

  const memberOccurrences = members.map((member) => {
    const node = memberNodes.find((row) => row.logical_path === member.logical_path);
    return {
      occurrence_id: member.occurrence_id,
      artifact_id: node?.artifact_id ?? `art_${digestOf(`missing:${member.logical_path}`)}`,
      parent_occurrence_id: rootOccurrenceId,
      logical_path: member.logical_path,
      entry_kind: member.is_directory ? 'directory' : 'file',
      artifact_kind: member.artifact_kind,
      artifact_format: member.artifact_format,
      declared_size: member.uncompressed_bytes,
      compressed_size: member.compressed_bytes,
      executable: false,
      encrypted: false,
      hash_status: member.calculated_sha256 === null ? 'unavailable' : 'verified',
      source_location: null,
      limitations: [],
    };
  });

  const edges = [...memberOccurrences]
    .map((occurrence, ordinal) => ({
      edge_id: `edge_${digestOf(`${rootArtifactId}:${occurrence.occurrence_id}:${ordinal}`)}`,
      ordinal,
      parent_artifact_id: rootArtifactId,
      relation: 'contains',
      occurrence_id: occurrence.occurrence_id,
      producer: null,
      sort_key: occurrence.occurrence_id,
    }))
    .sort((left, right) => compareText(left.sort_key, right.sort_key))
    .map((edge, ordinal) => ({
      edge_id: edge.edge_id,
      ordinal,
      parent_artifact_id: edge.parent_artifact_id,
      relation: edge.relation,
      occurrence_id: edge.occurrence_id,
      producer: null,
    }));

  const nodes = [rootNode, ...memberNodes.map(({ logical_path: _l, occurrence_id: _o, artifact_kind: _k, artifact_format: _f, compressed_size: _c, declared_size: _d, ...node }) => node)];
  const occurrences = [rootOccurrence, ...memberOccurrences];
  const manifest = {
    manifest_id: `agm_${digestOf(`manifest:${rootSha}`)}`,
    root_artifact_id: rootArtifactId,
    root_sha256: rootSha,
    root_format: subject.format,
    graph_sha256: digestOf(
      JSON.stringify({
        root: rootSha,
        nodes: nodes.map((node) => node.sha256),
        occurrences: occurrences.map((row) => row.logical_path),
        edges: edges.map((edge) => edge.occurrence_id),
      }),
    ),
    node_count: nodes.length,
    occurrence_count: occurrences.length,
    edge_count: edges.length,
  };

  const truncated = directory.entries.length > MEMBER_PAGE_LIMIT || unreadable.length > 0;
  return {
    inventory: {
      manifest,
      nodes,
      occurrences,
      edges,
      provenance: [],
      integrity_contradictions: integrityContradictions,
      coverage: {
        scope: 'container-entries',
        status: truncated ? 'partial' : 'complete',
      },
      limitations: [ZIP_LIMITATION],
    },
    zip_limitation: ZIP_LIMITATION,
  };
}

function readZipDirectoryOrThrow(bytes) {
  try {
    return readZipDirectory(bytes);
  } catch (error) {
    if (error instanceof ZipError) throw asArtifactFormatError(error);
    throw error;
  }
}

function asArtifactFormatError(error) {
  const wrapped = new Error(error.message);
  wrapped.name = 'ArtifactFormatError';
  wrapped.code = error.code === 'truncated' ? 'truncated' : 'malformed';
  wrapped.offset = error.offset ?? null;
  return wrapped;
}

function unreadableContradiction(member) {
  return {
    logical_path: member.logical_path,
    declared_sha256: null,
    calculated_sha256: null,
    unpacked: false,
    check: 'member-read',
    reason: member.read_reason ?? 'unreadable',
  };
}

function contradictionsIn(members) {
  return members
    .filter((member) => member.crc_ok === false)
    .map((member) => ({
      logical_path: member.logical_path,
      declared_sha256: null,
      calculated_sha256: member.calculated_sha256,
      unpacked: false,
      declared_crc32: member.declared_crc32,
      check: 'crc32',
    }));
}

function integrityFailure(contradictions) {
  const error = new Error(`Declared artifact integrity does not match for ${contradictions[0].logical_path}.`);
  error.name = 'IntegrityPolicyError';
  error.contradictions = contradictions;
  return error;
}

function memberOf(bytes, entry) {
  const kind = classifyMember(entry.logical_path, entry.is_directory);
  const base = {
    occurrence_id: `occ_${digestOf(`${entry.logical_path}:${entry.local_header_offset}:${entry.compressed_size}`)}`,
    logical_path: entry.logical_path,
    is_directory: entry.is_directory,
    compression_method: entry.compression_method,
    compressed_bytes: entry.compressed_size,
    uncompressed_bytes: entry.uncompressed_size,
    declared_crc32: entry.declared_crc32,
    artifact_kind: kind.artifact_kind,
    artifact_format: kind.artifact_format,
  };
  if (entry.is_directory || entry.safe_path === false) {
    return { ...base, calculated_sha256: null, crc_ok: null, read_status: entry.is_directory ? 'directory' : 'refused-unsafe-path' };
  }
  const read = readMember(bytes, entry);
  return { ...base, calculated_sha256: read.sha256, crc_ok: read.crcOk, read_status: read.status, read_reason: read.reason };
}

function classifyMember(logicalPath, isDirectory) {
  if (isDirectory) return { artifact_kind: 'directory', artifact_format: 'directory' };
  const lower = logicalPath.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.jsx') || lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return { artifact_kind: 'javascript', artifact_format: 'javascript-bundle' };
  }
  return { artifact_kind: 'resource', artifact_format: 'file' };
}

function readMember(bytes, entry) {
  try {
    const member = readZipMember(bytes, entry);
    return { status: 'read', sha256: digestOf(member.bytes), crcOk: member.crc_ok };
  } catch (error) {
    if (error instanceof ZipError) return { status: 'unreadable', sha256: null, crcOk: null, reason: error.code };
    throw error;
  }
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
