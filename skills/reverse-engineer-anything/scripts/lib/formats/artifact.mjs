import { digestOf } from '../canonical.mjs';
import { coverage } from '../envelope.mjs';
import { readZipDirectory, readZipMember, ZipError } from './zip.mjs';

const MEMBER_PAGE_LIMIT = 2000;

/**
 * Inventory a ZIP-family container without extracting it. Every occurrence
 * carries the digest of the bytes actually read, so a later reader can prove the
 * inventory describes this artifact and not a similar one.
 */
export function inspectArtifact({ bytes, subject, integrityPolicy = 'fail' }) {
  const directory = readZipDirectoryOrThrow(bytes);
  const capped = directory.entries.slice(0, MEMBER_PAGE_LIMIT);
  const occurrences = capped.map((entry) => occurrenceOf(bytes, entry));
  const integrityContradictions = contradictionsIn(occurrences);
  const unreadable = occurrences.filter((occurrence) => occurrence.read_status === 'unreadable');
  if ((integrityContradictions.length > 0 || unreadable.length > 0) && integrityPolicy === 'fail') {
    throw integrityFailure(integrityContradictions.length > 0 ? integrityContradictions : unreadable.map(unreadableContradiction));
  }
  const _truncated = directory.entries.length > MEMBER_PAGE_LIMIT || unreadable.length > 0;
  return {
    input_path: subject.local_path,
    format: subject.format,
    root_artifact_sha256: subject.digest.sha256,
    collections: collectionsOf(subject, occurrences, integrityContradictions),
    integrity_contradictions: integrityContradictions,
    summary: summaryOf(directory, occurrences),
    statistics: {
      declared_entries: directory.entries.length,
      read_entries: occurrences.length,
      crc_mismatches: integrityContradictions.length,
      unsafe_paths: occurrences.filter((occurrence) => occurrence.safe_path === false).length,
      unreadable_entries: occurrences.filter((occurrence) => occurrence.read_status !== 'read').length,
    },
    coverage: coverageFor({ directory, unreadable }),
    limitations: [
      'Members are read in memory by logical path; nothing is written to disk and no member is executed.',
      'A missing member in a partial inventory does not establish absence.',
      'Containers other than the ZIP family are refused rather than approximated.',
    ],
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

function unreadableContradiction(occurrence) {
  return { logical_path: occurrence.logical_path, declared_sha256: null, calculated_sha256: null, unpacked: false, check: 'member-read', reason: occurrence.read_reason ?? 'unreadable' };
}

/** Coverage states each reduction: a page cap, and every member that could not be read. */
function coverageFor({ directory, unreadable }) {
  const capped = directory.entries.length > MEMBER_PAGE_LIMIT;
  if (!capped && unreadable.length === 0) return directory.coverage;
  const limits = [];
  if (capped) limits.push(`Only the first ${MEMBER_PAGE_LIMIT} members were read.`);
  if (unreadable.length > 0) limits.push(`${unreadable.length} member(s) could not be read: ${unreadable.map((entry) => entry.logical_path).join(', ')}.`);
  const omitted = (capped ? directory.entries.length - MEMBER_PAGE_LIMIT : 0) + unreadable.length;
  return coverage({ status: 'partial', truncated: true, omittedCount: omitted, limits });
}

function contradictionsIn(occurrences) {
  return occurrences
    .filter((occurrence) => occurrence.crc_ok === false)
    .map((occurrence) => ({ logical_path: occurrence.logical_path, declared_sha256: null, calculated_sha256: occurrence.calculated_sha256, unpacked: false, declared_crc32: occurrence.declared_crc32, check: 'crc32' }));
}

function integrityFailure(contradictions) {
  const error = new Error(`Declared artifact integrity does not match for ${contradictions[0].logical_path}.`);
  error.name = 'IntegrityPolicyError';
  error.contradictions = contradictions;
  return error;
}

function collectionsOf(subject, occurrences, integrityContradictions) {
  return {
    occurrences,
    nodes: [{ node_id: `art_${subject.digest.sha256}`, kind: 'archive-root', logical_path: null }, ...occurrences.map((occurrence) => ({ node_id: occurrence.occurrence_id, kind: 'archive-member', logical_path: occurrence.logical_path }))],
    edges: occurrences.map((occurrence) => ({ source_node_id: `art_${subject.digest.sha256}`, target_node_id: occurrence.occurrence_id, relation: 'contains' })),
    integrity_contradictions: integrityContradictions,
  };
}

function summaryOf(directory, occurrences) {
  return {
    member_count: directory.entries.length,
    regular_file_count: occurrences.filter((occurrence) => !occurrence.is_directory).length,
    directory_count: occurrences.filter((occurrence) => occurrence.is_directory).length,
    total_uncompressed_bytes: occurrences.reduce((total, occurrence) => total + occurrence.uncompressed_bytes, 0),
    zip64: directory.zip64,
  };
}

function occurrenceOf(bytes, entry) {
  const base = {
    occurrence_id: `occ_${digestOf(`${entry.logical_path}:${entry.local_header_offset}:${entry.compressed_size}`)}`,
    logical_path: entry.logical_path,
    safe_path: entry.safe_path,
    unsafe_reason: entry.unsafe_reason,
    is_directory: entry.is_directory,
    compression_method: entry.compression_method,
    compressed_bytes: entry.compressed_size,
    uncompressed_bytes: entry.uncompressed_size,
    declared_crc32: entry.declared_crc32,
    declared_sha256: null,
    unpacked: false,
  };
  if (entry.is_directory || entry.safe_path === false) return { ...base, calculated_sha256: null, crc_ok: null, read_status: entry.is_directory ? 'directory' : 'refused-unsafe-path' };
  const read = readMember(bytes, entry);
  return { ...base, calculated_sha256: read.sha256, crc_ok: read.crcOk, read_status: read.status, read_reason: read.reason };
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
