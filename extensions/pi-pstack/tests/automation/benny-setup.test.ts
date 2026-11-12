import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadBennyConfig } from '../../src/automation/configuration.ts';
import { checkConnectors, threadSafetyCheck } from '../../src/automation/setup-check.ts';
import { bennyProject, fakeGh, REPO } from './benny-fakes.ts';

const script = resolve(import.meta.dirname, '../../scripts/benny-setup.mjs');
let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'benny-setup-test-'));
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

const run = () => JSON.parse(execFileSync(process.execPath, [script, '--project', project, '--credentials', join(project, 'absent.json')], { encoding: 'utf8' }));

test('setup preserves existing local config and pack edits and reports them as conflicts', () => {
  const config = join(project, '.pi', 'benny', 'configuration.yaml');
  const packFile = join(project, '.pi', 'automations', 'benny', 'skills', 'setup-benny', 'SKILL.md');
  const localOnly = join(project, '.pi', 'automations', 'benny', 'local-notes.md');
  mkdirSync(join(project, '.pi', 'benny'), { recursive: true });
  mkdirSync(join(project, '.pi', 'automations', 'benny', 'skills', 'setup-benny'), { recursive: true });
  writeFileSync(config, 'slack:\n  source_channel_id: "CMINE"\n');
  writeFileSync(packFile, 'my local edit\n');
  writeFileSync(localOnly, 'keep me\n');

  const report = run();

  expect(readFileSync(config, 'utf8')).toBe('slack:\n  source_channel_id: "CMINE"\n');
  expect(readFileSync(packFile, 'utf8')).toBe('my local edit\n');
  expect(readFileSync(localOnly, 'utf8')).toBe('keep me\n');
  expect(report.localConfig.conflicts).toEqual(['.pi/benny/configuration.yaml']);
  expect(report.localConfig.added).toEqual(['.pi/benny/feature-map.md', '.pi/benny/routing.md']);
  expect(report.pack.conflicts).toEqual(['skills/setup-benny/SKILL.md']);
  expect(report.pack.added).toContain('FOR_AGENTS.md');
  expect(report.sameUidLimit).toMatch(/uid/);
  expect(report.connector).toEqual({ webhookSecret: 'present, 0600' });
  expect(report.testEvent).toEqual({ ok: true, spawns: 1, replies: 1 });
});

test('a second setup run changes nothing and reports every file unchanged', () => {
  run();
  const report = run();
  expect(report.pack.added).toEqual([]);
  expect(report.pack.conflicts).toEqual([]);
  expect(report.localConfig).toEqual({ added: [], unchanged: ['.pi/benny/configuration.yaml', '.pi/benny/feature-map.md', '.pi/benny/routing.md'], conflicts: [] });
});

describe('thread-safety checks on a filled configuration (vendor setup-benny SKILL.md section 8)', () => {
  const NAMES = ['1 root thread_ts and one verdict reply', '2 one configured marker', '3 marker trusted only from the triage identity', '4 immutable source coordinates', '5 no source-channel root message', '6 a worker has no Slack write', '7 missing coordinates or a deleted parent post and write nothing'];

  test('setup runs the seven checks on the project\'s own configuration, with nothing outside memory', () => {
    const filled = bennyProject();
    const report = JSON.parse(execFileSync(process.execPath, [script, '--project', filled.dir, '--credentials', join(filled.dir, 'absent.json')], { encoding: 'utf8' }));
    rmSync(filled.dir, { recursive: true, force: true });
    expect(report.threadSafety.ok).toBe(true);
    expect(report.threadSafety.checks.map((check: { name: string }) => check.name)).toEqual(NAMES);
    expect(report.threadSafety.checks.every((check: { ok: boolean }) => check.ok)).toBe(true);
    expect(report.connectors).toBeUndefined();
  });

  test('a configuration that cannot carry a report fails the first check by name, and the others still run', async () => {
    const filled = bennyProject();
    const config = { ...loadBennyConfig(filled.dir, 'triage'), sourceChannelId: 'not a channel id' };
    const result = await threadSafetyCheck(config);
    rmSync(filled.dir, { recursive: true, force: true });
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ name: NAMES[0], ok: false });
  });

  test('an unedited template is reported as placeholder values and does not fail setup', () => {
    expect(run().threadSafety).toEqual({ skipped: 'the configuration still has placeholder values' });
  });
});

describe('connector validation (vendor setup-benny SKILL.md section 4)', () => {
  let server: Server | undefined;
  let bin: string;
  afterEach(async () => {
    await new Promise((resolve) => (server === undefined ? resolve(undefined) : server.close(resolve)));
    server = undefined;
  });

  /** A Slack that records every method called, and a `gh` that answers the read calls the checks make. */
  async function fakes(options: { scopes: string; labels: string[]; member?: boolean }) {
    const methods: string[] = [];
    server = createServer((request, response) => {
      const method = request.url?.split('/').at(-1) ?? '';
      methods.push(method);
      response.setHeader('content-type', 'application/json');
      if (method === 'auth.test') response.setHeader('x-oauth-scopes', options.scopes);
      response.end(JSON.stringify(method === 'conversations.info' ? { ok: true, channel: { is_member: options.member ?? true } } : { ok: true }));
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    bin = join(project, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncase "$*" in\n  *"/labels"*) printf '%s\\n' ${options.labels.map((label) => `'${label}'`).join(' ')} ;;\n  *"--jq .full_name"*) for arg in "$@"; do case "$arg" in repos/*) echo "\${arg#repos/}" ;; esac; done ;;\n  *) exit 1 ;;\nesac\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    const token = join(project, 'slack.json');
    writeFileSync(token, JSON.stringify({ token: 'xoxb-setup-test-token-0000' }), { mode: 0o600 });
    return { methods, url: `http://127.0.0.1:${port}/api/`, token };
  }

  const runChecked = async (filled: ReturnType<typeof bennyProject>, f: { url: string; token: string }) =>
    promisify(execFile)(process.execPath, [script, '--project', filled.dir, '--credentials', join(filled.dir, 'absent.json'), '--check-connectors', '--slack-credentials', f.token, '--slack-api-url', f.url], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env['PATH']}` } }).then(
      (result) => ({ code: 0, report: JSON.parse(result.stdout) }),
      (error: { code: number; stdout: string }) => ({ code: error.code, report: JSON.parse(error.stdout) }),
    );

  test('a healthy Slack, tracker and repository pass with read-only calls, and nothing is posted', async () => {
    const f = await fakes({ scopes: 'chat:write,files:read,channels:history,channels:read', labels: ['bug', 'performance', 'intake', 'needs-repro'] });
    const filled = bennyProject({ operationsChannel: 'COPS00001' });
    const { code, report } = await runChecked(filled, f);
    rmSync(filled.dir, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(report.connectors.map((check: { name: string; ok: boolean }) => [check.name, check.ok])).toEqual([['slack connector', true], ['slack scopes', true], ['source channel', true], ['operations channel', true], ['tracker', true], ['tracker labels', true], ['repository', true]]);
    expect(f.methods).toEqual(['auth.test', 'conversations.info', 'conversations.info']);
  });

  test('a missing scope, a missing label and a channel the bot is not in each fail by name and fail setup', async () => {
    const f = await fakes({ scopes: 'chat:write,channels:history', labels: ['bug', 'intake'], member: false });
    const filled = bennyProject();
    const { code, report } = await runChecked(filled, f);
    rmSync(filled.dir, { recursive: true, force: true });
    expect(code).toBe(1);
    const problems = Object.fromEntries(report.connectors.map((check: { name: string; ok: boolean; detail: string }) => [check.name, check.ok ? 'ok' : check.detail]));
    expect(problems['slack scopes']).toContain('files:read');
    expect(problems['source channel']).toContain('not a member');
    expect(problems['tracker labels']).toContain('performance');
    expect(problems['tracker labels']).toContain('needs-repro');
    expect(f.methods).not.toContain('chat.postMessage');
  });

  test('without the Slack credential only that connector fails, and no request is made to Slack', async () => {
    const f = await fakes({ scopes: '', labels: [] });
    const filled = bennyProject();
    const config = loadBennyConfig(filled.dir, 'triage');
    const gh = fakeGh();
    const checks = await checkConnectors(config, { fetch: async () => Promise.reject(new Error('no network in this test')), slack: { ok: false, reason: 'missing' }, exec: gh.exec });
    rmSync(filled.dir, { recursive: true, force: true });
    expect(checks[0]).toMatchObject({ name: 'slack connector', ok: false });
    expect(checks[0]?.detail).toContain('missing');
    expect(checks.find((check) => check.name === 'tracker')).toMatchObject({ ok: true, detail: `gh reaches ${REPO}` });
    expect(f.methods).toEqual([]);
  });
});
