import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { resolveTargetName, routeByPath } from '../scripts/lib/route.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/rea.mjs', import.meta.url));

function makeTarget(t, name, bytes) {
  const root = mkdtempSync(join(tmpdir(), 'rea-route-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, name);
  if (bytes === null) mkdirSync(path, { recursive: true });
  else writeFileSync(path, bytes);
  return path;
}

const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(200)]);
const MACHO = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(200)]);
const PE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]);
const ZIP = (() => {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20), eocd]);
})();

test('ROUTE-001: each reference target class routes to its operation', async (t) => {
  const routes = [
    [makeTarget(t, 'tree', null), 'analyze-javascript-application', 'directory'],
    [makeTarget(t, 'app.zip', ZIP), 'inspect-artifact', 'zip'],
    [makeTarget(t, 'app.apk', ZIP), 'inspect-artifact', 'apk'],
    [makeTarget(t, 'binary', MACHO), 'inspect-binary-layout', 'mach-o'],
    [makeTarget(t, 'lib.so', ELF), 'inspect-binary-layout', 'elf'],
    [makeTarget(t, 'app.exe', PE), 'inspect-binary-layout', 'pe'],
    [makeTarget(t, 'capture.har', Buffer.from('{"log":{"entries":[]}}')), 'inspect-web-network-capture', 'har'],
  ];
  for (const [path, operation, format] of routes) {
    const decision = await routeByPath(path);
    assert.equal(decision.operation, operation, `${path} should route to ${operation}`);
    assert.equal(decision.format, format);
    assert.equal(decision.supported, true);
  }
});

test('ROUTE-002: ambiguous target asks instead of choosing', () => {
  assert.throws(
    () =>
      resolveTargetName('notes', [
        { name: 'Notes.app', path: '/Applications/Notes.app' },
        { name: 'notes-cli', path: '/usr/local/bin/notes-cli' },
      ]),
    (error) => error.category === 'invalid_input' && error.details.issues[0].reason === 'ambiguous' && error.details.issues[0].candidates.length === 2,
  );
  assert.throws(
    () => resolveTargetName('nothing', []),
    (error) => error.details.issues[0].reason === 'not_found',
  );
  const only = resolveTargetName('Notes', [{ name: 'Notes.app', path: '/Applications/Notes.app' }]);
  assert.equal(only.path, '/Applications/Notes.app');
});

test('ROUTE-003: content beats extension and mismatches are reported', async (t) => {
  const disguised = makeTarget(t, 'looks-like-a-zip.bin', MACHO);
  const decision = await routeByPath(disguised);
  assert.equal(decision.format, 'mach-o');
  assert.equal(decision.operation, 'inspect-binary-layout');
  const dmg = makeTarget(t, 'image.dmg', Buffer.concat([Buffer.from('koly'), Buffer.alloc(600)]));
  const unsupported = await routeByPath(dmg);
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.operation, null);
  assert.equal(unsupported.availability_code, 'unsupported_format');
  assert.ok(unsupported.reason.includes('mount'));
});

test('ROUTE-004: a Go binary routes to the Go reader', async (t) => {
  const goMarker = Buffer.from([0xff, 0x20, 0x47, 0x6f, 0x20, 0x62, 0x75, 0x69, 0x6c, 0x64, 0x69, 0x6e, 0x66, 0x3a]);
  const goBinary = makeTarget(t, 'tool', Buffer.concat([MACHO, Buffer.alloc(1000), goMarker, Buffer.alloc(500)]));
  const decision = await routeByPath(goBinary);
  assert.equal(decision.operation, 'inspect-go-binary');
  assert.deepEqual(decision.alternatives, ['inspect-binary-layout']);
});

test('ROUTE CLI: route reports the decision as JSON without touching the store', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-route-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = makeTarget(t, 'binary', MACHO);
  const { stdout } = await run(process.execPath, [cli, 'route', path, '--json'], { cwd: root });
  const decision = JSON.parse(stdout);
  assert.equal(decision.operation, 'inspect-binary-layout');
  const { access } = await import('node:fs/promises');
  assert.equal(
    await access(join(root, '.rea')).then(
      () => true,
      () => false,
    ),
    false,
    'a read-only route must not create a store',
  );
});

test('ROUTE-005: route --name resolves through a candidate list and refuses ambiguity', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-name-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = makeTarget(t, 'binary', MACHO);
  const candidates = join(root, 'candidates.json');
  writeFileSync(candidates, JSON.stringify([{ name: 'Notes.app', path: binary }]));
  const { stdout } = await run(process.execPath, [cli, 'route', '--name', 'Notes', '--candidates', candidates, '--json']);
  const decision = JSON.parse(stdout);
  assert.equal(decision.matched_by_name, 'Notes.app');
  assert.equal(decision.operation, 'inspect-binary-layout');
  writeFileSync(
    candidates,
    JSON.stringify([
      { name: 'Notes.app', path: binary },
      { name: 'notes-cli', path: binary },
    ]),
  );
  const ambiguous = await run(process.execPath, [cli, 'route', '--name', 'notes', '--candidates', candidates, '--json']).catch((error) => JSON.parse(error.stdout));
  assert.equal(ambiguous.code, 'invalid_request');
  assert.equal(ambiguous.details.issues[0].reason, 'ambiguous');
  assert.equal(ambiguous.details.issues[0].candidates.length, 2);
  const unknown = await run(process.execPath, [cli, 'route', '--name', 'nothing', '--candidates', candidates, '--json']).catch((error) => JSON.parse(error.stdout));
  assert.equal(unknown.details.issues[0].reason, 'not_found');
});

test('ROUTE-006: inspect-analysis-view refuses a directory as evidence', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-view-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const failure = await run(process.execPath, [cli, 'inspect-analysis-view', root, '--view', 'summary', '--store', join(root, '.rea'), '--json']).catch((error) => JSON.parse(error.stdout));
  assert.equal(failure.code, 'invalid_request');
  assert.equal(failure.details.issues[0].path[0], 'evidence');
});

test('ROUTE-007: a flag is only boolean where the command declares it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-flags-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = makeTarget(t, 'binary', MACHO);
  const ignored = await run(process.execPath, [cli, 'inspect-binary-layout', path, '--overwrite', '--store', join(root, '.rea'), '--json']).catch((error) => JSON.parse(error.stdout));
  assert.equal(ignored.code, 'invalid_request');
  assert.ok(ignored.details.issues.some((issue) => issue.path[0] === '--overwrite' && issue.reason === 'unknown_flag'));
  const missingValue = await run(process.execPath, [cli, 'route', '--name', '--json']).catch((error) => JSON.parse(error.stdout));
  assert.ok(missingValue.details.issues.some((issue) => issue.path[0] === '--name' && issue.reason === 'required'));
});
