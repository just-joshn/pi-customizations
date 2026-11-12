// /pstack automation runs each event source as a kind 'watch' worker: a real receiver process in tmux.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { automationRunId, registerPstackCommand } from '../../src/commands.ts';
import { readHostState } from '../../src/run-files.ts';
import { workerSocket } from '../../src/workers.ts';
import { type FakePi, fakePi, stopWorkers } from '../integration/fake-pi.ts';

const PKG = resolve(import.meta.dirname, '../..');
let root: string;
let project: string;
let home: string;
let fake: FakePi;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-auto-cmd-')));
  project = join(root, 'project');
  home = join(root, 'home');
  mkdirSync(project);
  mkdirSync(home);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: project });
  fake = fakePi({ cwd: project, session: SessionManager.create(project, join(root, 'sessions')) });
  registerPstackCommand(fake.pi, { conflicts: () => [], spawnOptions: { extraEnv: { HOME: home, PI_CODING_AGENT_DIR: join(home, '.pi', 'agent') } } });
});

afterEach(async () => {
  await stopWorkers(project);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function statusUntil(name: string, accept: (text: string) => boolean): Promise<string> {
  let text = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    text = (await fake.pstack(`automation status ${name}`)).text;
    if (accept(text)) return text;
    await sleep(100);
  }
  throw new Error(`status never matched: ${text}`);
}

const receiverOf = (text: string) => /receiver (http:\S+)/.exec(text)?.[1] as string;

function credential(name: string, field: string, value: string): void {
  const dir = join(home, '.pi', 'agent', 'pstack', 'credentials');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ [field]: value }), { mode: 0o600 });
}

test('a webhook routine starts as a watch worker running routine-setup --serve, reports its receiver, and stops', async () => {
  const prompt = join(root, 'prompt.md');
  writeFileSync(prompt, 'Handle the event.');
  execFileSync(process.execPath, [join(PKG, 'scripts/routine-setup.mjs'), '--project', project, '--name', 'nightly', '--prompt-file', prompt], { env: { ...process.env, HOME: home } });
  const started = await fake.pstack('automation start nightly');
  expect(started.text).toMatch(new RegExp(`^Started automation nightly \\(webhook routine\\) as watch worker source-1 in run ${automationRunId('nightly')}\\. .*Attach: tmux -L ${workerSocket()} attach -t pstack_serve-`));
  const running = await statusUntil('nightly', (text) => text.includes('receiver http'));
  expect(running).toMatch(/^Automation nightly: webhook routine; running as source-1/);
  const assignment = JSON.parse(readFileSync(join(project, '.pi/pstack/runs', automationRunId('nightly'), 'workers/source-1/assignment.json'), 'utf8'));
  expect(assignment).toMatchObject({ kind: 'watch', role: 'watcher', watch: { argv: ['node', join(PKG, 'scripts/routine-setup.mjs'), '--project', project, '--name', 'nightly', '--serve'], cwd: project } });
  expect((await fetch(receiverOf(running).replace(/\/?$/, ''), { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' })).status).toBe(401);
  expect((await fake.pstack('automation start nightly')).text).toBe('Automation nightly is already running as worker source-1. Stop it first with /pstack automation stop nightly.');
  expect((await fake.pstack('automation stop nightly')).text).toBe('Stopped automation nightly: source-1: stopped.');
  expect(await statusUntil('nightly', (text) => text.includes('not running'))).toContain('source-1 (watch, watcher): stopped; tmux session gone');
});

test('Benny starts through loadBennyConfig and startEventSource, fails closed without the Slack connector, and blocks a case it cannot probe', async () => {
  mkdirSync(join(project, '.pi', 'benny'), { recursive: true });
  // A real Slack channel id: the template's placeholder has underscores, which the event parser refuses.
  writeFileSync(join(project, '.pi/benny/configuration.yaml'), readFileSync(join(PKG, 'automations/benny/templates/configuration.example.yaml'), 'utf8').replace('"SOURCE_CHANNEL_ID"', '"CTEST123"'));
  const key = 'k'.repeat(40);
  credential('benny-triage', 'key', key);
  await fake.pstack('automation start benny-triage');
  const runRoot = join(project, '.pi/pstack/runs', automationRunId('benny-triage'));
  const failed = await statusUntil('benny-triage', (text) => text.includes('not running') && !text.includes('(watch, watcher): idle'));
  expect(failed).toMatch(/^Automation benny-triage: Benny triage; not running/);
  expect(readHostState(join(runRoot, 'workers', 'source-1'))?.phase).toBe('exited');

  credential('slack', 'token', 'xoxb-test-token-not-real');
  const started = await fake.pstack('automation start benny-triage');
  expect(started.text).toMatch(/^Started automation benny-triage \(Benny triage\) as watch worker source-2/);
  const running = await statusUntil('benny-triage', (text) => text.includes('receiver http'));
  const response = await fetch(receiverOf(running), {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ source_channel_id: 'CTEST123', ts: '1700000000.000100', text: 'harmless test report' }),
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ status: 'blocked', missing: ['tracker'] });
  expect((await fake.pstack('automation stop benny-triage')).text).toBe('Stopped automation benny-triage: source-2: stopped.');
});

test('an unknown automation name is an error naming where it looked', async () => {
  expect(await fake.pstack('automation start nothing-here')).toEqual({ level: 'error', text: expect.stringContaining(`No automation named nothing-here: no routine at ${project}/.pi/pstack/automation/nothing-here/config.json`) });
});
