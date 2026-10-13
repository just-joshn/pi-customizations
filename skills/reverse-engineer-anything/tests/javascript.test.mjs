import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { analyzeJavaScriptApplication } from '../scripts/lib/formats/javascript.mjs';
import { openAsarSource, openDirectorySource } from '../scripts/lib/formats/target-source.mjs';
import { describeSubject } from '../scripts/lib/target.mjs';

const run = promisify(execFile);
const fixture = fileURLToPath(new URL('../../../parity/reverse-engineer-anything/fixtures/targets/notepad-app', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/rea.mjs', import.meta.url));

const _analyzeFixture = async () => {
  const subject = await describeSubject(fixture);
  const source = await openDirectorySource(fixture);
  return analyzeJavaScriptApplication({ source, subject });
};

const nodeKinds = (result) => new Set(result.graph.nodes.map((node) => node.kind));
const findByKind = (result, kind) => result.graph.nodes.filter((node) => node.kind === kind);
const propertiesOf = (node) => node.observations[0]?.properties ?? {};

function makeTree(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'rea-js-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

const analyzeTree = async (root) => {
  const subject = await describeSubject(root);
  const source = await openDirectorySource(root);
  return analyzeJavaScriptApplication({ source, subject });
};

test('JS-001: analyzing a tree executes nothing', async (t) => {
  const marker = join(tmpdir(), `rea-executed-${process.pid}-${Date.now()}`);
  const root = makeTree(t, {
    'package.json': JSON.stringify({ name: 'probe', main: 'main.js' }),
    'main.js': `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\nconst { app } = require('electron');`,
  });
  const result = await analyzeTree(root);
  assert.equal(result.format, 'directory');
  assert.match(result.root_artifact_sha256, /^[0-9a-f]{64}$/);
  const { access } = await import('node:fs/promises');
  assert.equal(
    await access(marker).then(
      () => true,
      () => false,
    ),
    false,
    'the analyzer must not have executed the target',
  );
  assert.deepEqual(result.integrity_contradictions, []);
  assert.ok(result.limitations.some((line) => line.includes('not executed')) || result.limitations.some((line) => line.includes('inert')));
});

test('JS-002: inside, outside and unresolved specifiers are distinguished', async (t) => {
  const root = makeTree(t, {
    'package.json': JSON.stringify({ name: 'resolver', main: 'main.js' }),
    'main.js': "require('./util');\nconst Fuse = require('fuse.js');\nrequire('./missing');\n",
    'util.js': 'module.exports = {};',
  });
  const result = await analyzeTree(root);
  const properties = findByKind(result, 'javascript-module').map(propertiesOf);
  const statuses = properties.map((entry) => entry.resolution_status);
  assert.ok(statuses.includes('resolved'), 'a relative file that exists resolves');
  assert.ok(statuses.includes('external'), 'a bare package that is not vendored is external');
  assert.ok(statuses.includes('unresolved'), 'a relative file that does not exist stays unresolved');
  const imports = result.graph.edges.filter((edge) => edge.relation === 'imports');
  assert.equal(imports.length, 3);
  assert.ok(imports.every((edge) => edge.properties.specifier.length > 0));
  assert.ok(imports.some((edge) => edge.properties.resolution_status === 'unresolved'));
});

test('JS-003: electron roles and unresolved preload are reported', async (t) => {
  const root = makeTree(t, {
    'package.json': JSON.stringify({ name: 'roles', main: 'src/main.js' }),
    'src/main.js': "const { app, BrowserWindow } = require('electron');\napp.whenReady().then(() => { new BrowserWindow({ webPreferences: { preload: './nope.js' } }); });\n",
  });
  const result = await analyzeTree(root);
  const kinds = nodeKinds(result);
  assert.ok(kinds.has('electron-main'));
  assert.ok(kinds.has('browser-window'));
  const main = findByKind(result, 'electron-main')[0];
  assert.equal(propertiesOf(main).mechanism, 'package.json:main');
  assert.equal(propertiesOf(main).resolved_path, 'src/main.js');
  const window = findByKind(result, 'browser-window')[0];
  assert.equal(propertiesOf(window).options_status, 'object-literal');
  assert.equal(result.summary.preload_entrypoints, 0, 'a declared preload that does not exist is not resolved');
});

test('JS-004: paired and unpaired channels are counted', async (t) => {
  const root = makeTree(t, {
    'package.json': JSON.stringify({ name: 'ipc', main: 'main.js' }),
    'main.js': "const { ipcMain } = require('electron');\nipcMain.handle('notes:search', () => []);\nipcMain.handle('notes:save', () => {});\n",
    'renderer.js': "const { ipcRenderer } = require('electron');\nipcRenderer.invoke('notes:search');\nipcRenderer.invoke('other:thing');\n",
  });
  const result = await analyzeTree(root);
  assert.equal(result.summary.ipc.main_handlers, 2);
  assert.equal(result.summary.ipc.renderer_transmissions, 2);
  assert.equal(result.summary.ipc.paired_renderer_transmissions, 1);
  assert.equal(result.summary.ipc.unpaired_literal_renderer_transmissions, 2);
  const channels = findByKind(result, 'ipc-channel');
  assert.deepEqual(channels.map((node) => propertiesOf(node).channel).sort(), ['notes:save', 'notes:search', 'other:thing']);
});

test('JS-005: exposed members and unknown members are separated', async (t) => {
  const root = makeTree(t, {
    'package.json': JSON.stringify({ name: 'bridge', main: 'preload.js' }),
    'preload.js': "const { contextBridge } = require('electron');\ncontextBridge.exposeInMainWorld('api', { search: () => {}, save: () => {} });\ncontextBridge.exposeInMainWorld('dynamic', buildApi());\n",
  });
  const result = await analyzeTree(root);
  const bridges = findByKind(result, 'context-bridge-api').map(propertiesOf);
  assert.equal(bridges.length, 2);
  const literal = bridges.find((entry) => entry.api_key === 'api');
  const computed = bridges.find((entry) => entry.api_key === 'dynamic');
  assert.deepEqual(literal.members, ['search', 'save']);
  assert.equal(literal.unknown_members, 0);
  assert.equal(computed.unknown_members, 1);
  assert.equal(result.summary.exposed_api_members, 2);
});

test('JS-006: native member names are marked unverified', async (t) => {
  const root = makeTree(t, {
    'package.json': JSON.stringify({ name: 'native', main: 'main.js' }),
    'main.js': "const addon = require('./build/index.node');\naddon.compute();\n",
    'build/index.node': 'binary-placeholder',
  });
  const result = await analyzeTree(root);
  const exports = findByKind(result, 'native-export');
  assert.equal(exports.length, 1);
  assert.equal(propertiesOf(exports[0]).native_export_verification, 'not-performed');
  assert.ok(nodeKinds(result).has('native-addon'));
});

test('JS-007: parse failure is recorded and does not abort', async (t) => {
  const root = makeTree(t, {
    'package.json': JSON.stringify({ name: 'broken', main: 'main.js' }),
    'main.js': "require('./good');\n",
    'good.js': 'module.exports = 1;',
    'broken.js': "const x = 'unterminated\nrequire('./never');\n",
  });
  const result = await analyzeTree(root);
  assert.ok(result.statistics.parsed_javascript_files >= 3);
  assert.match(result.statistics.findings.toString(), /^\d+$/);
  assert.ok(result.graph.nodes.length > 0, 'one unparsable file must not abort the analysis');
  const assets = findByKind(result, 'javascript-asset').map(propertiesOf);
  assert.ok(assets.some((entry) => entry.path === 'broken.js'));
});

test('JS-008: asar inventory honours the integrity policy', async (_t) => {
  const { readFileSync } = await import('node:fs');
  const asarBytes = readFileSync(fileURLToPath(new URL('../../../parity/reverse-engineer-anything/fixtures/targets/notepad-app/package.json', import.meta.url)));
  const header = Buffer.from(JSON.stringify({ files: { 'main.js': { size: 12, offset: 0, integrity: { algorithm: 'SHA256', hash: 'not-the-real-hash', blockSize: 12, blocks: ['not-the-real-block'] } } } }), 'utf8');
  const padded = Buffer.concat([header, Buffer.alloc((4 - (header.length % 4)) % 4)]);
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(padded.length + 8, 4);
  prefix.writeUInt32LE(padded.length + 4, 8);
  prefix.writeUInt32LE(header.length, 12);
  const body = Buffer.concat([Buffer.from('module.exports=1\n'), asarBytes]);
  const bytes = Buffer.concat([prefix, padded, body]);
  const source = openAsarSource(bytes);
  const subject = { name: 'inline.asar', digest: { sha256: 'a'.repeat(64) }, format: 'asar', architecture: null, local_path: '/tmp/inline.asar' };
  const recordContinue = await analyzeJavaScriptApplication({ source, subject, integrityPolicy: 'record-and-continue' });
  assert.equal(recordContinue.format, 'asar');
  assert.equal(recordContinue.integrity_contradictions.length, 1);
  assert.equal(recordContinue.integrity_contradictions[0].logical_path, 'main.js');
  await assert.rejects(
    () => analyzeJavaScriptApplication({ source, subject, integrityPolicy: 'fail' }),
    (error) => error.name === 'IntegrityPolicyError' && error.contradictions.length === 1,
  );
});

test('JS-009: escaping member paths are refused', async (t) => {
  const { normalizeMemberPath } = await import('../scripts/lib/formats/zip.mjs');
  assert.equal(normalizeMemberPath('src/main.js').safe, true);
  assert.equal(normalizeMemberPath('../../etc/passwd').safe, false);
  assert.equal(normalizeMemberPath('/etc/passwd').safe, false);
  assert.equal(normalizeMemberPath('C:\\Windows\\system.ini').safe, false);
  const root = makeTree(t, { 'package.json': JSON.stringify({ name: 'escape', main: 'main.js' }), 'main.js': '' });
  const result = await analyzeTree(root);
  assert.ok(result.limitations.length > 0);
});

test('JS CLI: analyze-javascript-application reports a reference-shaped envelope', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { stdout } = await run(process.execPath, [cli, 'analyze-javascript-application', fixture, '--store', join(root, '.rea'), '--json']);
  const envelope = JSON.parse(stdout);
  assert.equal(envelope.operation, 'analyze_javascript_application');
  assert.equal(envelope.predicate_type, 'rea.javascript-application-analysis');
  assert.match(envelope.evidence_id, /^ev_[0-9a-f]{64}$/);
  assert.equal(envelope.subject.format, 'directory');
  assert.equal(envelope.normalized_result.summary.ipc.paired_renderer_transmissions, 1);
  const again = await run(process.execPath, [cli, 'analyze-javascript-application', fixture, '--store', join(root, '.rea'), '--json']);
  assert.equal(JSON.parse(again.stdout).evidence_id, envelope.evidence_id, 'the same input yields the same evidence id');
});

test('JS-011: a deeply nested ASAR header degrades instead of overflowing', async () => {
  let tree = { 'leaf.js': { size: 1, offset: 0 } };
  for (let depth = 0; depth < 80; depth += 1) tree = { [`d${depth}`]: { files: tree } };
  const header = Buffer.from(JSON.stringify({ files: tree }), 'utf8');
  const padded = Buffer.concat([header, Buffer.alloc((4 - (header.length % 4)) % 4)]);
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(padded.length + 8, 4);
  prefix.writeUInt32LE(padded.length + 4, 8);
  prefix.writeUInt32LE(header.length, 12);
  const source = openAsarSource(Buffer.concat([prefix, padded, Buffer.from('x')]));
  assert.equal(source.directory.coverage.status, 'partial');
  assert.equal(source.directory.coverage.truncated, true);
  assert.ok(source.directory.coverage.limits.some((line) => line.includes('deeper than')));
});
