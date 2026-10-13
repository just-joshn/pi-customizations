import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { readGoBuildInfo } from '../scripts/lib/formats/gobinary.mjs';

const MARKER = Buffer.from('\xff Go buildinf:', 'latin1');
const VERSION = 'go1.17.5';
const MODULES = [
  'example.com/reverse/probe (devel)',
  'github.com/google/uuid v1.6.0 h1:J5MvLHFVKvyWZYcxVS8dGVIlC+GGYk8wb0y8krl9Xl8=',
  'golang.org/x/text v0.14.0 h1:ScX5w1eTa3QqT8oi6+ziP7dTV1S2+ALU0bI+0zXKWiQ= => golang.org/x/text v0.13.0 h1:g2BN5c6I1PVsdZ+m7p4CVXUEBL7EUAb1iN3eZ0BW7iw=',
];
const SETTINGS = ['GOOS=darwin', 'GOARCH=arm64', '-buildmode=exe', '-compiler=gc'];
const PREFIX = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
const TRAILER = Buffer.from([0x00, 0xff, 0x00]);

/** 32-byte header (magic, ptrSize, flags, 16 bytes of padding) then inline text. */
function legacyInlineBlob() {
  const header = Buffer.alloc(32);
  MARKER.copy(header, 0);
  header[14] = 8;
  header[15] = 0;
  const text = Buffer.from(`${VERSION}\n${MODULES.join('\n')}\n\n${SETTINGS.join('\n')}\n`, 'latin1');
  return { header, text, blob: Buffer.concat([header, text]) };
}

function embed(blob) {
  return Buffer.concat([PREFIX, blob, TRAILER]);
}

function uvarint(value) {
  const bytes = [];
  let remaining = value;
  do {
    const byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(remaining > 0 ? byte | 0x80 : byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

/** Go 1.18+ inline form: varint-length-prefixed version and module strings. */
function modernInlineBlob() {
  const header = Buffer.alloc(32);
  MARKER.copy(header, 0);
  header[14] = 8;
  header[15] = 2;
  const version = Buffer.from(VERSION, 'latin1');
  const modinfo = Buffer.from(`${MODULES.join('\n')}\n\n${SETTINGS.join('\n')}\n`, 'latin1');
  return { header, version, modinfo };
}

function rangeOf(result, field) {
  const range = result.ranges.find((candidate) => candidate.field === field);
  assert.ok(range, `expected a ${field} range`);
  return range;
}

test('GO-001: buildinfo yields version, settings and modules', () => {
  const { blob } = legacyInlineBlob();
  const input = embed(blob);
  const result = readGoBuildInfo(input);

  assert.equal(result.present, true);
  assert.equal(result.go_version, VERSION);
  assert.deepEqual(result.modules, [
    { path: 'example.com/reverse/probe', version: '(devel)', sum: '', main: true, replacement: null },
    { path: 'github.com/google/uuid', version: 'v1.6.0', sum: 'h1:J5MvLHFVKvyWZYcxVS8dGVIlC+GGYk8wb0y8krl9Xl8=', main: false, replacement: null },
    {
      path: 'golang.org/x/text',
      version: 'v0.14.0',
      sum: 'h1:ScX5w1eTa3QqT8oi6+ziP7dTV1S2+ALU0bI+0zXKWiQ=',
      main: false,
      replacement: { path: 'golang.org/x/text', version: 'v0.13.0' },
    },
  ]);
  assert.deepEqual(result.build_settings, [
    { key: 'GOOS', value: 'darwin' },
    { key: 'GOARCH', value: 'arm64' },
    { key: '-buildmode', value: 'exe' },
    { key: '-compiler', value: 'gc' },
  ]);
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.coverage.truncated, false);
  assert.equal(result.coverage.omitted_count, null);

  const blobStart = PREFIX.length;
  const header = rangeOf(result, 'buildinfo-header');
  assert.equal(header.start, blobStart);
  assert.equal(header.end, blobStart + 32);
  assert.ok(input.subarray(header.start, header.end).includes(MARKER));

  const moduleRange = rangeOf(result, 'module-list');
  const moduleSlice = input.subarray(moduleRange.start, moduleRange.end).toString('latin1');
  assert.ok(moduleSlice.startsWith('example.com/reverse/probe (devel)'));
  assert.ok(moduleSlice.includes('github.com/google/uuid v1.6.0'));
  assert.ok(moduleSlice.includes('=> golang.org/x/text v0.13.0'));
  assert.ok(moduleRange.end <= blobStart + blob.length);

  const settingsRange = rangeOf(result, 'build-settings');
  const settingsSlice = input.subarray(settingsRange.start, settingsRange.end).toString('latin1');
  assert.ok(settingsSlice.startsWith('GOOS=darwin'));
  assert.ok(settingsSlice.includes('-compiler=gc'));
  assert.ok(settingsRange.end <= blobStart + blob.length);
});

test('GO-002: missing buildinfo is reported as unknown', () => {
  const random = Buffer.from(Array.from({ length: 256 }, (_, index) => (index * 37 + 11) % 256));
  const truncatedMarker = Buffer.from(MARKER);
  const machOHeader = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(124)]);

  for (const [caseName, input] of [
    ['random bytes', random],
    ['truncated marker', truncatedMarker],
    ['mach-o header', machOHeader],
  ]) {
    const result = readGoBuildInfo(input);
    assert.equal(result.present, false, `${caseName} must not claim a present header`);
    assert.equal(result.coverage.status, 'unavailable', `${caseName} coverage`);
    assert.equal(result.coverage.truncated, false);
    assert.equal(result.coverage.omitted_count, null);
    assert.equal(result.go_version, null);
    assert.deepEqual(result.build_settings, []);
    assert.deepEqual(result.modules, []);
    assert.deepEqual(result.ranges, []);
    assert.ok(result.coverage.limits.length > 0, `${caseName} must name its limits`);
    assert.ok(
      result.limitations.some((limit) => limit.includes('not evidence that the binary is not Go')),
      `${caseName} must state that absence proves nothing`,
    );
  }
});

test('GO-003: a real Go binary is read when present', (t) => {
  const binary = '/opt/homebrew/bin/gh';
  if (!existsSync(binary)) {
    t.skip(`${binary} is not installed`);
    return;
  }
  const result = readGoBuildInfo(readFileSync(binary));

  assert.equal(result.present, true);
  assert.match(result.go_version, /^go1\./);
  assert.ok(result.modules.length >= 1);
  assert.ok(result.modules.every((module) => typeof module.path === 'string' && module.path.length > 0));
  assert.ok(result.build_settings.length >= 1);
  assert.equal(result.coverage.status, 'complete');
  assert.ok(result.ranges.some((range) => range.field === 'module-list'));
  assert.ok(result.ranges.some((range) => range.field === 'build-settings'));
  assert.equal(result.limitations.length, 0);
});

test('GO-004: a malformed blob degrades instead of throwing', () => {
  const { header, version, modinfo } = modernInlineBlob();
  const bogusLength = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x7f]);
  const malformed = Buffer.concat([header, uvarint(version.length), version, bogusLength, modinfo]);

  const result = readGoBuildInfo(malformed);
  assert.equal(result.present, true);
  assert.equal(result.coverage.status, 'partial');
  assert.ok(result.coverage.limits.length > 0);
  assert.ok(result.limitations.length > 0);
  assert.equal(result.go_version, VERSION);
});
