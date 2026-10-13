import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { apiSurface, HarError, readHarCapture } from '../scripts/lib/formats/har.mjs';

const MODULE_URL = new URL('../scripts/lib/formats/har.mjs', import.meta.url);

const header = (name, value) => ({ name, value });

const entry = (overrides = {}) => {
  const {
    method = 'GET',
    url = 'https://api.example.test/api/notes/42',
    status = 200,
    mimeType = null,
    requestHeaders = [],
    responseHeaders = [],
    requestBody = null,
    responseText = null,
    time = 12,
    startedDateTime = '2026-10-13T05:00:00.000Z',
  } = overrides;
  return {
    startedDateTime,
    time,
    request: {
      method,
      url,
      headers: requestHeaders,
      ...(requestBody === null ? {} : { postData: { mimeType: 'application/json', text: requestBody } }),
    },
    response: {
      status,
      headers: responseHeaders,
      content: { mimeType, ...(responseText === null ? {} : { text: responseText }) },
    },
  };
};

const harDocument = ({ version = '1.2', creator = { name: 'pi-rea-test', version: '1' }, entries = [entry()] } = {}) => ({ log: { version, creator, entries } });

test('HAR-001: inspection performs no network access', () => {
  const source = readFileSync(MODULE_URL, 'utf8');
  assert.doesNotMatch(source, /node:(http|https|net|dns)/);
  assert.equal(source.includes('fetch('), false);
  assert.equal(readHarCapture.constructor.name, 'Function');

  const capture = readHarCapture(
    harDocument({
      entries: [entry({ url: '/api/notes/42?include=comments#top' }), entry({ url: 'https://alice:hunter2@api.example.test/api/notes/42?view=full#notes' })],
    }),
  );
  assert.equal(capture instanceof Promise, false);
  assert.equal(typeof capture.then, 'undefined');
  assert.equal(capture.records.length, 2);
  assert.equal(capture.records[0].url, '/api/notes/42?include=comments#top');
  assert.equal(capture.records[0].origin, '');
  assert.equal(capture.records[0].path, '/api/notes/42');
  assert.equal(capture.records[1].url, 'https://api.example.test/api/notes/42?view=full#notes');
  assert.equal(capture.records[1].origin, 'https://api.example.test');
  assert.equal(capture.records[1].path, '/api/notes/42');
  assert.equal(capture.records[1].status, 200);
});

test('HAR-002: authorization and cookie values never appear', () => {
  const body = JSON.stringify({ note: 'the secret handshake was recorded' });
  const capture = readHarCapture(
    harDocument({
      entries: [
        entry({
          method: 'POST',
          url: 'https://api.example.test/api/notes',
          requestHeaders: [header('Authorization', 'Bearer sk-live-abc123'), header('Cookie', 'session=deadbeef'), header('X-Api-Key', 'key-abc-123'), header('Accept', 'application/json')],
          responseHeaders: [header('Set-Cookie', 'token=xyz'), header('Content-Type', 'application/json')],
          responseText: body,
          mimeType: 'application/json',
        }),
      ],
    }),
  );

  const serialized = JSON.stringify(capture);
  for (const value of ['Bearer sk-live-abc123', 'sk-live-abc123', 'session=deadbeef', 'deadbeef', 'token=xyz', 'key-abc-123', 'secret', body]) {
    assert.equal(serialized.includes(value), false, `leaked ${value}`);
  }
  assert.equal(serialized.includes('[redacted]'), true);
  assert.deepEqual(capture.records[0].credential_headers_present, ['authorization', 'cookie', 'set-cookie', 'x-api-key']);
  assert.deepEqual(capture.records[0].request_headers[0], { name: 'Authorization', value: '[redacted]' });
  assert.deepEqual(capture.records[0].request_headers[2], { name: 'X-Api-Key', value: '[redacted]' });
  assert.deepEqual(capture.records[0].response_headers[0], { name: 'Set-Cookie', value: '[redacted]' });
  assert.deepEqual(capture.records[0].request_headers[3], { name: 'Accept', value: 'application/json' });
  assert.equal(capture.records[0].response_body, 'recorded');
  assert.equal(capture.records[0].response_body_size, body.length);
  assert.equal(capture.records[0].response_bytes, body.length);
});

test('HAR-003: api surface groups by method, origin and path template', () => {
  const capture = readHarCapture(
    harDocument({
      entries: [
        entry({ url: 'https://api.example.test/api/notes/42' }),
        entry({ method: 'POST', url: 'https://api.example.test/api/notes/42' }),
        entry({ url: 'https://api.example.test/api/notes/43' }),
        entry({ url: 'https://admin.example.test/api/notes/7' }),
        entry({ url: 'https://api.example.test/api/files/deadbeefcafe01' }),
      ],
    }),
  );

  assert.deepEqual(apiSurface(capture.records), [
    { method: 'GET', origin: 'https://admin.example.test', path_template: '/api/notes/{id}', ordinals: [3], observations: 1 },
    { method: 'GET', origin: 'https://api.example.test', path_template: '/api/files/{id}', ordinals: [4], observations: 1 },
    { method: 'GET', origin: 'https://api.example.test', path_template: '/api/notes/{id}', ordinals: [0, 2], observations: 2 },
    { method: 'POST', origin: 'https://api.example.test', path_template: '/api/notes/{id}', ordinals: [1], observations: 1 },
  ]);
});

test('HAR-004: record ordinals survive paging', () => {
  const capture = readHarCapture(
    harDocument({
      entries: [entry({ url: 'https://api.example.test/api/notes/1' }), entry({ url: 'https://api.example.test/api/notes/2' }), entry({ url: 'https://api.example.test/api/notes/3' }), entry({ url: 'https://api.example.test/api/notes/4' })],
    }),
  );
  assert.deepEqual(
    capture.records.map((record) => record.ordinal),
    [0, 1, 2, 3],
  );

  const page = capture.records.slice(2, 3);
  assert.equal(page.length, 1);
  assert.equal(page[0].ordinal, 2);
  assert.equal(page[0].url, 'https://api.example.test/api/notes/3');

  assert.throws(
    () => readHarCapture({ log: { version: '2.0', entries: [] } }),
    (error) => {
      assert.ok(error instanceof HarError);
      assert.equal(error.code, 'unsupported_version');
      assert.match(error.message, /2\.0/);
      return true;
    },
  );
  assert.throws(
    () => readHarCapture({ log: { version: '1.2' } }),
    (error) => error instanceof HarError && error.code === 'malformed',
  );
});

test('HAR-005: a truncated capture reports the omission', () => {
  const entries = Array.from({ length: 5125 }, (_, index) => entry({ url: `https://api.example.test/api/notes/${index}` }));
  const capture = readHarCapture(harDocument({ entries }));
  assert.equal(capture.records.length, 5000);
  assert.equal(capture.coverage.status, 'partial');
  assert.equal(capture.coverage.truncated, true);
  assert.equal(capture.coverage.omitted_count, 125);
  assert.equal(capture.records.at(-1).ordinal, 4999);
  assert.equal(
    capture.coverage.limits.some((limit) => limit.includes('5000')),
    true,
  );
  assert.equal(
    capture.coverage.limits.some((limit) => limit.includes('125')),
    true,
  );

  const boundary = readHarCapture(harDocument({ entries: entries.slice(0, 5000) }));
  assert.equal(boundary.records.length, 5000);
  assert.equal(boundary.coverage.status, 'complete');
  assert.equal(boundary.coverage.truncated, false);
  assert.equal(boundary.coverage.omitted_count, null);
  assert.deepEqual(boundary.coverage.limits, []);
});

test('HAR-006: credential query values and signing headers are redacted', () => {
  const document = {
    log: {
      version: '1.2',
      entries: [
        {
          request: {
            method: 'GET',
            url: 'https://api.example.test/notes?page=2&access_token=live-token-value&tag=keepme',
            headers: [
              { name: 'X-Amz-Signature', value: 'deadbeefsignature' },
              { name: 'Accept', value: 'application/json' },
            ],
          },
          response: { status: 200, content: { text: '{}', mimeType: 'application/json' } },
        },
      ],
    },
  };
  const result = readHarCapture(document);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('live-token-value'), 'a credential query value must not survive');
  assert.ok(result.records[0].url.includes('access_token=[redacted]'));
  assert.ok(result.records[0].url.includes('tag=keepme'), 'ordinary query values stay as recorded');
  assert.ok(result.records[0].url.includes('page=2'));
  assert.ok(!serialized.includes('deadbeefsignature'), 'a signing header value must not survive');
  assert.ok(result.records[0].credential_headers_present.includes('x-amz-signature'));
});

test('HAR-007: a capture that is not JSON is refused as an unsupported target', async (t) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const run = promisify(execFile);
  const cli = new URL('../scripts/rea.mjs', import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), 'rea-har-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const capture = join(root, 'broken.har');
  writeFileSync(capture, 'this is not json');
  const failure = await run(process.execPath, [cli, 'inspect-web-network-capture', capture, '--store', join(root, '.rea'), '--json']).catch((error) => JSON.parse(error.stdout));
  assert.equal(failure.code, 'unsupported_target');
  assert.equal(failure.category, 'unsupported_target');
  assert.ok(failure.details.path.endsWith('broken.har'));
});
