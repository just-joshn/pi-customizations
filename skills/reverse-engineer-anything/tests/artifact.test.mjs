import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { inspectArtifact } from '../scripts/lib/formats/artifact.mjs';
import { crc32, MAX_MEMBER_BYTES, normalizeMemberPath, readZipDirectory, readZipMember } from '../scripts/lib/formats/zip.mjs';
import { detectFormatFromBytes } from '../scripts/lib/target.mjs';
import { buildView } from '../scripts/lib/views.mjs';

function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content ?? '');
    const stored = entry.deflate !== true;
    const body = stored ? raw : deflateRawSync(raw);
    const declaredCrc = entry.declaredCrc ?? crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(declaredCrc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(stored ? 0 : 8, 10);
    directory.writeUInt32LE(declaredCrc, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...chunks, centralBuffer, eocd]);
  return archive;
}

const subject = { name: 'fixture.zip', digest: { sha256: 'a'.repeat(64) }, format: 'zip', architecture: null, local_path: '/tmp/fixture.zip' };

test('ART-001: inventory lists every member with digests', () => {
  const bytes = makeZip([
    { name: 'package.json', content: '{"name":"x"}' },
    { name: 'main.js', content: 'module.exports = 1;', deflate: true },
  ]);
  const result = inspectArtifact({ bytes, subject });
  assert.equal(result.format, 'zip');
  assert.equal(result.summary.member_count, 2);
  assert.equal(result.summary.regular_file_count, 2);
  assert.deepEqual(
    result.collections.occurrences.map((entry) => entry.logical_path),
    ['package.json', 'main.js'],
  );
  for (const occurrence of result.collections.occurrences) {
    assert.match(occurrence.calculated_sha256, /^[0-9a-f]{64}$/);
    assert.equal(occurrence.crc_ok, true);
    assert.equal(occurrence.read_status, 'read');
  }
  assert.equal(result.collections.nodes.length, 3, 'root plus two members');
  assert.equal(result.collections.edges.length, 2);
  assert.deepEqual(result.integrity_contradictions, []);
});

test('ART-002: integrity policy decides the outcome', () => {
  const bytes = makeZip([{ name: 'main.js', content: 'module.exports = 1;', declaredCrc: 0xdeadbeef }]);
  assert.throws(
    () => inspectArtifact({ bytes, subject, integrityPolicy: 'fail' }),
    (error) => error.name === 'IntegrityPolicyError' && error.contradictions[0].logical_path === 'main.js',
  );
  const recorded = inspectArtifact({ bytes, subject, integrityPolicy: 'record-and-continue' });
  assert.equal(recorded.integrity_contradictions.length, 1);
  assert.equal(recorded.integrity_contradictions[0].check, 'crc32');
  assert.equal(recorded.integrity_contradictions[0].calculated_sha256.length, 64);
  assert.equal(recorded.collections.integrity_contradictions.length, 1);
});

test('ART-003: occurrence selection pages without implying completeness', async () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({ name: `file-${index}.js`, content: `module.exports = ${index};` }));
  const result = inspectArtifact({ bytes: makeZip(entries), subject });
  const record = {
    evidence_id: `ev_${'b'.repeat(64)}`,
    operation: 'inspect_artifact',
    predicate_type: 'rea.artifact-inventory',
    subject,
    limitations: ['Inventory only.'],
    normalized_result: result,
  };
  const page = await buildView(record, { kind: 'inventory', collection: 'occurrences', logicalPaths: ['file-2.js', 'file-5.js'], offset: 0, limit: 1 });
  assert.equal(page.normalized_result.inventory.returned, 1);
  assert.equal(page.normalized_result.inventory.remaining, 1);
  assert.equal(page.normalized_result.inventory.total, 2);
  assert.equal(page.normalized_result.inventory.source_complete, true, 'the producer covered every member');
  const all = await buildView(record, { kind: 'inventory', collection: 'occurrences', offset: 0, limit: 3 });
  assert.equal(all.normalized_result.inventory.remaining, 5, 'page exhaustion is reported separately from source completeness');
});

test('ART-004: unsupported containers are named, not guessed', () => {
  const dmg = Buffer.concat([Buffer.from('koly'), Buffer.alloc(600)]);
  assert.equal(detectFormatFromBytes(dmg, 'image.dmg').format, 'dmg');
  assert.equal(detectFormatFromBytes(Buffer.from('not-an-archive'), 'mystery.bin').format, 'unknown');
  const directory = readZipDirectory(makeZip([{ name: 'a.txt', content: 'a' }]));
  assert.equal(directory.coverage.status, 'complete');
});

test('ART-005: hostile member paths are never read', () => {
  const bytes = makeZip([{ name: '../../etc/passwd', content: 'root:x:0:0' }]);
  const result = inspectArtifact({ bytes, subject });
  const occurrence = result.collections.occurrences[0];
  assert.equal(occurrence.safe_path, false);
  assert.equal(occurrence.unsafe_reason, 'parent-traversal');
  assert.equal(occurrence.calculated_sha256, null);
  assert.equal(occurrence.read_status, 'refused-unsafe-path');
  assert.equal(normalizeMemberPath('..\\..\\windows\\win.ini').safe, false);
});

test('ART-006: a truncated container fails closed', () => {
  const bytes = makeZip([{ name: 'main.js', content: 'module.exports = 1;' }]).subarray(0, 40);
  assert.throws(
    () => inspectArtifact({ bytes, subject }),
    (error) => error.name === 'ArtifactFormatError' && ['malformed', 'truncated'].includes(error.code),
  );
});

test('ART-007: an oversized member is refused before it is decompressed', () => {
  const bytes = makeZip([{ name: 'bomb.bin', content: 'x' }]);
  const entry = readZipDirectory(bytes).entries[0];
  const hostile = { ...entry, uncompressed_size: MAX_MEMBER_BYTES + 1 };
  assert.throws(
    () => readZipMember(bytes, hostile),
    (error) => error.code === 'member_too_large' && error.message.includes('member limit'),
  );
});
