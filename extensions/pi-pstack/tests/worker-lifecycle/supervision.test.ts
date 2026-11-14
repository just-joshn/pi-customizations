import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from 'vitest';
import { processStartTime, readClaim, readHostState } from '../../src/run-files.ts';
import type { HostLaunch } from '../../src/worker-host.ts';
import { killTmuxServer, makeParent, makeProject, makeRun, workerDir as projectWorkerDir, stopProject, tmux, writeAssignment } from './harness.ts';

const HOST = resolve(import.meta.dirname, '../../dist/worker-host.js');
const PI = process.env['PSTACK_E2E_PI'] || '/Users/josh-desktop/.pi/agent/bin/pi';
const SECRET = 'supervision-credential-negative';
const CREDENTIAL = JSON.stringify({ token: SECRET });

test('the deployed tmux watch host exposes the same durable supervision through pstack_worker', async () => {
  const project = makeProject('pstack-supervision-tmux-');
  makeRun(project, 'run1');
  const parent = makeParent(project, []);
  await parent.start();
  try {
    const argv = [process.execPath, '-e', "console.log('WATCH-READY'); setInterval(() => {}, 1000)"];
    const assignmentPath = writeAssignment(project, 'run1', 'watch', 'Watch only.', { kind: 'watch', watch: { argv, cwd: project.dir } });
    await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath });
    const dir = projectWorkerDir(project, 'run1', 'watch');
    const before = readHostState(dir);
    assert(before?.supervision);
    expect(Number((await tmux('display-message', '-p', '-t', before.tmuxSession, '#{pane_pid}')).trim())).toBe(before.hostPid);
    expect(before.supervision.command).toEqual(argv);
    await expect.poll(() => readHostState(dir)?.supervision?.heartbeat.at, { timeout: 7000 }).not.toBe(before.supervision?.heartbeat.at);
    expect(readFileSync(before.supervision.logs.output, 'utf8')).toContain('WATCH-READY');
    await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'watch' });
    const stopped = readHostState(dir);
    expect(stopped?.phase).toBe('stopped');
    const evidence = process.env['PSTACK_SUPERVISION_EVIDENCE'];
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(join(evidence, 'tmux-watch.json'), JSON.stringify({ before, stopped }));
    }
  } finally {
    await parent.stop();
    await stopProject(project);
    await killTmuxServer();
  }
});

test.each(['pi', 'watch', 'watch-exit', 'watch-stubborn'] as const)('%s host persists safe supervision without mistaking heartbeat for progress', async (kind) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-supervision-')));
  const runRoot = join(root, '.pi/pstack/runs/supervision');
  const workerDir = join(runRoot, 'workers/worker');
  mkdirSync(join(workerDir, 'claim'), { recursive: true });
  mkdirSync(join(root, 'agent'));
  const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  json(join(runRoot, 'run.json'), {
    schemaVersion: 1,
    runId: 'supervision',
    title: 'supervision',
    playbook: 'bug-fix',
    upstreamRevision: 'test',
    createdAt: new Date().toISOString(),
    parentSessionFile: join(root, 'parent.jsonl'),
    inputCommit: null,
  });
  writeFileSync(join(workerDir, 'brief.md'), 'Never start a model call.');
  const watch = kind !== 'pi';
  const argv = [
    process.execPath,
    '-e',
    `${kind === 'watch-stubborn' ? "process.on('SIGTERM', () => {});" : ''} console.log(process.env.SUPERVISION_CREDENTIAL); ${kind === 'watch-exit' ? '' : 'setInterval(() => {}, 1000);'}`,
    SECRET,
    'tiny',
    'https://user:password@example.test',
  ];
  json(join(workerDir, 'assignment.json'), {
    schemaVersion: 1,
    runId: 'supervision',
    workerId: 'worker',
    kind: watch ? 'watch' : 'pi',
    role: 'general',
    brief: 'brief.md',
    model: 'openai/gpt-4o',
    thinkingLevel: null,
    workspace: { mode: 'readonly', path: root },
    skills: [],
    capabilities: { mcp: 'none', env: 'inherit', externalWrite: false, spawn: false },
    ...(watch ? { watch: { argv, cwd: root } } : {}),
  });
  const launch: HostLaunch = {
    piCommand: [PI],
    model: { provider: 'openai', id: 'gpt-4o' },
    thinkingLevel: null,
    appendSystemPrompt: null,
    tools: null,
    tmuxSession: 'pstack_supervision_worker_12345678',
    extraArgs: ['--offline', '--no-context-files'],
    credentialEnv: ['SUPERVISION_CREDENTIAL', 'SHORT_API_KEY'],
    container: null,
  };
  const env = { PATH: process.env['PATH'], HOME: root, TMPDIR: tmpdir(), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', SUPERVISION_CREDENTIAL: CREDENTIAL, SHORT_API_KEY: 'tiny' };
  json(join(workerDir, 'claim/launch-env.json'), env);
  const host = spawn(process.execPath, [HOST, join(workerDir, 'assignment.json'), JSON.stringify(launch)], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(host, 'close');
  let output = '';
  host.stdout.on('data', (chunk) => {
    output += chunk;
  });
  host.stderr.on('data', (chunk) => {
    output += chunk;
  });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toContain('[host ready]');
    const state = readHostState(workerDir);
    assert(state);
    const record = state.supervision;
    expect(record).toBeDefined();
    assert(record);
    assert(state.childPid !== null);
    expect(record.hostStarted).toBe(readClaim(workerDir)?.hostStarted);
    if (kind !== 'watch-exit') expect(record.childStarted).toBe(processStartTime(state.childPid));
    expect(record.cwd).toBe(root);
    expect(record.environment).toEqual({ mode: 'inherit', values: 'omitted', names: expect.arrayContaining(['SUPERVISION_CREDENTIAL', 'SHORT_API_KEY', 'PSTACK_WORKER_ID']) });
    expect(record.command).toEqual(watch ? argv.map((part) => part.replace(SECRET, '***').replace('tiny', '***').replace('user:password@', '***@')) : expect.arrayContaining([PI, '--mode', 'rpc', '--no-approve', '--offline']));
    expect(record.heartbeat).toEqual({ meaning: 'host-liveness', intervalMs: 5000, at: expect.any(String) });
    expect(record.stopPolicy).toEqual({
      cancel: watch ? null : ['get_state', 'clear_queue', 'abort', 'get_state'],
      abortDeadlineMs: watch ? null : 60000,
      shutdown: watch ? ['SIGTERM'] : ['clear_queue', 'abort', 'stdin.end'],
      failure: 'SIGTERM',
      signals: ['SIGTERM', 'SIGHUP'],
      target: 'child-process-group',
      termAfterMs: 3000,
      killAfterMs: 6000,
    });
    if (kind === 'watch-exit') await expect.poll(() => readHostState(workerDir)?.phase).toBe('exited');
    const before = readHostState(workerDir);
    assert(before);
    await expect.poll(() => readHostState(workerDir)?.supervision?.heartbeat.at, { timeout: 7000 }).not.toBe(before.supervision?.heartbeat.at);
    const after = readHostState(workerDir);
    assert(after);
    expect(after.generation).toBe(before.generation);
    expect(after.settles).toEqual(before.settles);
    expect(after.phase).toBe(before.phase);
    expect(record.logs.events).toBe(join(runRoot, 'events.jsonl'));
    expect(record.logs.output).toBe(join(workerDir, 'output.log'));
    expect(statSync(record.logs.output).mode & 0o777).toBe(0o600);
    expect(readFileSync(record.logs.output, 'utf8')).toContain('[host ready]');
    if (watch) expect(readFileSync(record.logs.output, 'utf8')).toContain('***');
    expect(processStartTime(state.hostPid)).toBe(record.hostStarted);
    if (kind === 'watch') host.kill('SIGTERM');
    else host.stdin.write('shutdown\n');
    expect(await closed, output).toEqual([0, null]);
    const stopped = readHostState(workerDir);
    assert(stopped);
    expect(stopped.exit).not.toBeNull();
    if (kind === 'watch-stubborn') expect(stopped.exit?.signal).toBe('SIGKILL');
    expect(processStartTime(state.hostPid)).toBeUndefined();
    expect(processStartTime(state.childPid)).toBeUndefined();
    expect(stopped.phase).toBe(kind === 'watch-exit' ? 'exited' : 'stopped');
    expect(existsSync(join(workerDir, 'claim/launch-env.json'))).toBe(false);
    for (const path of [join(workerDir, 'state.json'), record.logs.events, record.logs.output]) {
      const text = readFileSync(path, 'utf8');
      for (const secret of [SECRET, CREDENTIAL, 'tiny', 'user:password@']) expect(text).not.toContain(secret);
    }
    const evidence = process.env['PSTACK_SUPERVISION_EVIDENCE'];
    if (evidence) {
      const dir = join(evidence, kind);
      mkdirSync(dir, { recursive: true });
      for (const [name, value] of Object.entries({ before, after, stopped, claim: readClaim(workerDir) })) json(join(dir, `${name}.json`), value);
      writeFileSync(join(dir, 'output.log'), readFileSync(record.logs.output));
      writeFileSync(join(dir, 'events.jsonl'), readFileSync(record.logs.events));
    }
  } finally {
    if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
    await closed;
    rmSync(root, { recursive: true, force: true });
  }
});
