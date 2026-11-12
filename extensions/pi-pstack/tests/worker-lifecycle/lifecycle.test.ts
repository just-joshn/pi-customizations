import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { controlSocketPath, loadAssignment, type RunId, tmuxSessionName, type WorkerId } from '../../src/run-files.ts';
import { type Entry, FIXTURE, killTmuxServer, liveTmuxSessions, makeParent, makeProject, makeRun, type Parent, type Project, readState, sleep, TMUX, tmux, transcript, until, wakes, workerDir, writeAssignment } from './harness.ts';

// The tmux server this file starts inherits it, so an inheriting worker sees it.
process.env['U04A_PARENT_MARKER'] = 'parent-secret-marker';

let project: Project;
let parent: Parent;
let entries: Entry[];

beforeEach(async () => {
  project = makeProject();
  makeRun(project, 'run1');
  entries = [];
  parent = makeParent(project, entries);
  await parent.start();
});

afterEach(async () => {
  await parent.stop();
  for (const session of await liveTmuxSessions()) await tmux('kill-session', '-t', session).catch(() => undefined);
  project.dispose();
});

afterAll(killTmuxServer);

const inspect = async (workerId: string) => (await parent.call('pstack_worker', { action: 'inspect', runId: 'run1', workerId })).details;
const phaseOf = async (workerId: string) => {
  const result = await inspect(workerId);
  return result.available ? result.state.phase : 'unavailable';
};
const sessionOf = (workerId: string) => tmuxSessionName(project.dir, 'run1' as RunId, workerId as WorkerId);
const settleCount = async (workerId: string) => ((await inspect(workerId)).state?.settles ?? []).length;
const spawn = (workerId: string, brief: string, fields: Record<string, unknown> = {}) => parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', workerId, brief, fields) });

describe('pstack_worker on real tmux and Pi', () => {
  test('spawn returns before the work finishes, with an attach command whose pane shows the output', async () => {
    const result = await spawn('w1', '@@sleep 1500 HELLO-PANE');

    expect(result.details).toMatchObject({ workerId: 'w1', tmuxSession: expect.stringMatching(/^pstack_run1_w1_[0-9a-f]{8}$/), model: { provider: 'scripted', id: 'echo' } });
    expect(result.details.attach).toBe(`tmux -L ${TMUX} attach -t ${result.details.tmuxSession}`);
    expect(result.details.sessionFile.startsWith(join(workerDir(project, 'run1', 'w1'), 'session'))).toBe(true);
    expect(await phaseOf('w1')).toBe('running');

    const pane = await until(
      () => tmux('capture-pane', '-p', '-t', result.details.tmuxSession, '-S', '-200'),
      (text) => text.includes('[pi response] HELLO-PANE'),
      20_000,
      'pane output',
    );
    expect(pane).toContain('[host ready]');
    await until(
      () => wakes(parent),
      (list) => list.length === 1,
      10_000,
      'settle wake',
    );
    expect(wakes(parent)).toEqual([{ transitionId: expect.stringMatching(/^w1:[0-9a-f-]{36}:1$/), runId: 'run1', workerId: 'w1', phase: 'idle' }]);
    expect(parent.messages[0]?.options).toEqual({ triggerTurn: true, deliverAs: 'followUp' });
  });

  test('steer while running and while idle both land in the transcript', async () => {
    await spawn('w2', '@@sleep 2000 FIRST');
    await until(
      () => phaseOf('w2'),
      (phase) => phase === 'running',
    );
    await parent.call('pstack_worker', { action: 'steer', runId: 'run1', workerId: 'w2', message: '@@say STEERED' });
    await until(
      () => transcript(project, 'run1', 'w2'),
      (texts) => texts.includes('assistant:STEERED'),
      20_000,
      'steered reply',
    );
    expect(transcript(project, 'run1', 'w2')).toContain('user:@@say STEERED');
    await until(
      () => phaseOf('w2'),
      (phase) => phase === 'idle',
    );

    await parent.call('pstack_worker', { action: 'steer', runId: 'run1', workerId: 'w2', message: '@@say AFTER-IDLE' });
    await until(
      () => transcript(project, 'run1', 'w2'),
      (texts) => texts.includes('assistant:AFTER-IDLE'),
      20_000,
      'idle follow-up reply',
    );
  });

  test('abort clears queued work, stops the worker, and wakes the parent with aborted', async () => {
    await spawn('w3', '@@sleep 3000 NEVER');
    await until(
      () => phaseOf('w3'),
      (phase) => phase === 'running',
    );
    await parent.call('pstack_worker', { action: 'steer', runId: 'run1', workerId: 'w3', message: '@@say QUEUED-NEVER' });
    const receipt = await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'w3' });

    expect(receipt.details.disposition).toBe('stopped');
    await sleep(3500);
    const texts = transcript(project, 'run1', 'w3');
    expect(texts).not.toContain('assistant:NEVER');
    expect(texts).not.toContain('assistant:QUEUED-NEVER');
    expect(await liveTmuxSessions()).not.toContain(sessionOf('w3'));
    expect(readState(project, 'run1', 'w3').phase).toBe('stopped');
    await until(
      () => wakes(parent).map((wake) => wake?.phase),
      (phases) => phases.includes('aborted'),
      5_000,
      'aborted wake',
    );
    expect(wakes(parent).map((wake) => wake?.phase)).toEqual(['aborted']);
  });

  test('collect returns report.md and the final text of a settled worktree worker', async () => {
    const report = join(workerDir(project, 'run1', 'w4'), 'report.md');
    await spawn('w4', `@@script [{"tool":"write","args":{"path":${JSON.stringify(report)},"content":"REPORT BODY"}}]`, { workspace: { mode: 'worktree', inputCommit: project.commit } });
    await until(
      () => settleCount('w4'),
      (count) => count === 1,
    );
    const done = await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId: 'w4' });
    expect(done.details).toMatchObject({ settled: true, available: true, phase: 'idle', lastSettle: { phase: 'idle' }, report: 'REPORT BODY' });
    expect(done.details.finalText).toMatch(/^RESULTS:\n\[write\]/);

    const worktree = join(workerDir(project, 'run1', 'w4'), 'worktree');
    expect(execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(project.commit);
    expect(execFileSync('git', ['-C', worktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('pstack-run/run1/w4');
  });

  test.for([
    ['a clone the operator made', (path: string) => execFileSync('git', ['clone', '--quiet', project.dir, path])],
    ['a worktree of this repo on another branch', (path: string) => execFileSync('git', ['-C', project.dir, 'worktree', 'add', '--quiet', '-b', 'operator-branch', path, project.commit])],
  ] as const)('spawn refuses to reuse %s at the worktree path', async ([, makeCheckout]) => {
    const path = join(workerDir(project, 'run1', 'w12'), 'worktree');
    const assignmentPath = writeAssignment(project, 'run1', 'w12', '@@script [{"tool":"write","args":{"path":"OWNED.txt","content":"x"}}]', { workspace: { mode: 'worktree', inputCommit: project.commit } });
    makeCheckout(path);
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath })).rejects.toThrow(/not this worker's worktree/);
    await sleep(1_000);
    expect(existsSync(join(path, 'OWNED.txt'))).toBe(false);
  });

  test('collect on a worker still running returns its live state, never a result', async () => {
    await spawn('w5', '@@sleep 3000 LATER');
    const result = await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId: 'w5' });
    expect(result.details).toEqual({ settled: false, live: expect.objectContaining({ phase: 'running' }) });
    expect(result.details.report).toBeUndefined();
  });

  test('a Pi crash is failed, never success', async () => {
    await spawn('w6', '@@say UP');
    await until(
      () => settleCount('w6'),
      (count) => count === 1,
    );
    process.kill((await inspect('w6')).state.childPid, 'SIGKILL');

    await until(
      () => phaseOf('w6'),
      (phase) => phase === 'failed',
      10_000,
      'failed phase',
    );
    expect(readState(project, 'run1', 'w6')).toMatchObject({ phase: 'failed', reason: expect.stringMatching(/Pi exited unexpectedly/) });
    await until(
      () => wakes(parent).map((wake) => wake?.phase),
      (phases) => phases.includes('failed'),
      5_000,
      'failed wake',
    );
    expect(wakes(parent).map((wake) => wake?.phase)).toEqual(['idle', 'failed']);
  });

  test('a killed host is unavailable and the assignment cannot be spawned again', async () => {
    const assignmentPath = writeAssignment(project, 'run1', 'w7', '@@say UP');
    await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath });
    await until(
      () => settleCount('w7'),
      (count) => count === 1,
    );
    const { hostPid, childPid } = (await inspect('w7')).state;
    process.kill(hostPid, 'SIGKILL');

    await until(
      () => phaseOf('w7'),
      (phase) => phase === 'unavailable',
      10_000,
      'unavailable',
    );
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath })).rejects.toThrow(/already claimed/);
    await until(
      () => wakes(parent).map((wake) => wake?.phase),
      (phases) => phases.includes('unavailable'),
      5_000,
      'unavailable wake',
    );
    expect(wakes(parent).map((wake) => wake?.phase)).toEqual(['idle', 'unavailable']);
    const collected = await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId: 'w7' });
    expect(collected.details).toMatchObject({ settled: true, available: false, phase: 'unavailable' });
    try {
      process.kill(-childPid, 'SIGKILL');
    } catch {
      // Pi usually exits on its own once the host's pipe closes.
    }
  });

  test("abort of a dead host never ends another session, even one with the worker's old or current session name", async () => {
    const spawned = await spawn('a-b', '@@say UP');
    await until(
      () => settleCount('a-b'),
      (count) => count === 1,
    );
    const { hostPid, childPid } = (await inspect('a-b')).state;
    process.kill(hostPid, 'SIGKILL');
    await until(
      () => liveTmuxSessions(),
      (sessions) => !sessions.includes(spawned.details.tmuxSession),
      5_000,
      'host session gone',
    );
    // The old scheme named both run1/a-b and run1-a/b `pstack-run1-a-b`; an operator may also reuse the current name.
    const foreign = [...new Set(['pstack-run1-a-b', spawned.details.tmuxSession])];
    for (const name of foreign) await tmux('new-session', '-d', '-s', name, '--', 'sleep', '60');

    const receipt = await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'a-b' });
    expect(receipt.details.disposition).not.toBe('session-ended');
    expect(await liveTmuxSessions()).toEqual(expect.arrayContaining(foreign));
    try {
      process.kill(-childPid, 'SIGKILL');
    } catch {
      // Pi usually exits on its own once the host's pipe closes.
    }
  });

  test('two workers whose ids join to the same text get distinct tmux sessions', async () => {
    makeRun(project, 'run1-a');
    const first = await spawn('a-b', '@@say ONE');
    const second = await parent.call('pstack_worker', { action: 'spawn', runId: 'run1-a', assignmentPath: writeAssignment(project, 'run1-a', 'b', '@@say TWO', { runId: 'run1-a' }) }).catch((error: Error) => error);
    expect(second).not.toBeInstanceOf(Error);
    expect(first.details.tmuxSession).not.toBe((second as { details: { tmuxSession: string } }).details.tmuxSession);
  });

  test('abort of a host whose control socket is lost ends its own session after verifying the pane is that host', async () => {
    const spawned = await spawn('w11', '@@say UP');
    await until(
      () => settleCount('w11'),
      (count) => count === 1,
    );
    const { hostPid, childPid } = (await inspect('w11')).state;
    rmSync(controlSocketPath(project.runRoot('run1'), 'w11' as WorkerId));
    try {
      const receipt = await parent.call('pstack_worker', { action: 'abort', runId: 'run1', workerId: 'w11' });
      expect(receipt.details.disposition).toBe('session-ended');
      expect(await liveTmuxSessions()).not.toContain(spawned.details.tmuxSession);
    } finally {
      for (const pid of [hostPid, -childPid])
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
    }
  });

  test('a readonly worker gets only read, grep, find, and ls', async () => {
    await spawn('w8', '@@tools-list');
    await until(
      () => settleCount('w8'),
      (count) => count === 1,
    );
    const result = await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId: 'w8' });
    expect(result.details.finalText.split(',').sort()).toEqual(['find', 'grep', 'ls', 'read']);
  });

  test('a watch worker wakes the parent when its command exits', async () => {
    await spawn('w9', 'unused', { kind: 'watch', watch: { argv: ['/bin/sh', '-c', 'echo WATCHED; exit 3'], cwd: project.dir } });
    await until(
      () => wakes(parent),
      (list) => list.length === 1,
      10_000,
      'watch wake',
    );
    expect(wakes(parent)[0]?.phase).toBe('exited');
    expect(readState(project, 'run1', 'w9')).toMatchObject({ phase: 'exited', exit: { code: 3 } });
    expect(await tmux('capture-pane', '-p', '-t', sessionOf('w9'))).toContain('WATCHED');
  });

  test('the control socket is private and rejects a forged identity', async () => {
    await spawn('w10', '@@say UP');
    const socket = controlSocketPath(project.runRoot('run1'), 'w10' as WorkerId);
    expect(statSync(socket).mode & 0o777).toBe(0o600);
    const { connect } = await import('node:net');
    const reply = await new Promise<string>((resolve) => {
      const client = connect(socket, () => client.write(`${JSON.stringify({ id: 'x1', workerId: 'w10', digest: '0'.repeat(64), operation: 'inspect' })}\n`));
      let data = '';
      client.on('data', (chunk) => (data += chunk));
      client.on('close', () => resolve(data));
    });
    expect(JSON.parse(reply)).toMatchObject({ ok: false, error: 'Assignment identity mismatch' });
  });
});

describe('capability boundary', () => {
  const withoutNoMcp = ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve', '--extension', FIXTURE];
  const envScript = (command: string) => `@@script [{"tool":"bash","args":{"command":${JSON.stringify(command)}}}]`;
  const collectText = async (owner: Parent, workerId: string) => {
    await until(
      async () => ((await owner.call('pstack_worker', { action: 'inspect', runId: 'run1', workerId })).details.state?.settles ?? []).length,
      (count) => count === 1,
      20_000,
      `${workerId} settle`,
    );
    return (await owner.call('pstack_worker', { action: 'collect', runId: 'run1', workerId })).details.finalText as string;
  };
  // Pi renames its process title, so the argv comes from the host's launch record in events.jsonl.
  const argvOf = (workerId: string): string[] =>
    readFileSync(join(project.runRoot('run1'), 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((event) => event.kind === 'launch' && event.workerId === workerId).data.command;

  test("mcp 'none' and env 'minimal' launch Pi with --no-mcp and without the parent's variables", async () => {
    const owner = makeParent(project, [], { extraPiArgs: withoutNoMcp });
    const worktree = { mode: 'worktree', inputCommit: project.commit };
    await owner.call('pstack_worker', {
      action: 'spawn',
      runId: 'run1',
      assignmentPath: writeAssignment(project, 'run1', 'c1', envScript('env'), { workspace: worktree, capabilities: { mcp: 'none', env: 'minimal', externalWrite: false } }),
    });
    const minimal = await collectText(owner, 'c1');
    expect(minimal).toContain('PSTACK_WORKER=1');
    expect(minimal).not.toContain('U04A_PARENT_MARKER');
    expect(argvOf('c1')).toContain('--no-mcp');

    await owner.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'c2', envScript('printenv U04A_PARENT_MARKER'), { workspace: worktree }) });
    expect(await collectText(owner, 'c2')).toContain('parent-secret-marker');
    expect(argvOf('c2')).not.toContain('--no-mcp');
    await owner.stop();
  });

  test('spawn refuses a worker that asks for external write authority', async () => {
    const path = writeAssignment(project, 'run1', 'c3', '@@say X', { capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: true } });
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: path })).rejects.toThrow(/externalWrite/);
    expect(existsSync(join(workerDir(project, 'run1', 'c3'), 'claim'))).toBe(false);
  });

  test('a worker of an automation run defaults to no MCP and the minimal environment; a parent-owned run inherits', () => {
    makeRun(project, 'auto1', null);
    const automated = loadAssignment(writeAssignment(project, 'auto1', 'owner', 'x', { runId: 'auto1', role: 'owner' }));
    expect(automated.assignment.capabilities).toEqual({ mcp: 'none', env: 'minimal', externalWrite: false });
    const engineering = loadAssignment(writeAssignment(project, 'run1', 'c4', 'x'));
    expect(engineering.assignment.capabilities).toEqual({ mcp: 'inherit', env: 'inherit', externalWrite: false });
  });

  test('rejects malformed capabilities', async () => {
    const path = writeAssignment(project, 'run1', 'c5', 'x', { capabilities: { mcp: 'some', env: 'inherit', externalWrite: false } });
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: path })).rejects.toThrow(/capabilities/);
  });
});

describe('pstack_worker boundary validation', () => {
  test.for([
    ['an uppercase run id', { action: 'inspect', runId: 'Run1', workerId: 'w1' }, /Invalid runId/],
    ['a traversal run id', { action: 'inspect', runId: '../run1', workerId: 'w1' }, /Invalid runId/],
    ['a traversal worker id', { action: 'inspect', runId: 'run1', workerId: '../../x' }, /Invalid workerId/],
    ['an over-long worker id', { action: 'steer', runId: 'run1', workerId: 'a'.repeat(41), message: 'x' }, /Invalid workerId/],
  ] as const)('rejects %s', async ([, params, error]) => {
    await expect(parent.call('pstack_worker', params)).rejects.toThrow(error);
  });

  test('rejects an assignment path that escapes the run through ..', async () => {
    writeAssignment(project, 'run1', 'w1', '@@say X');
    const escaped = join(project.runRoot('run1'), 'workers', 'w1', '..', '..', '..', 'run2', 'workers', 'w1', 'assignment.json');
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: escaped })).rejects.toThrow();
  });

  test("rejects another run's assignment", async () => {
    makeRun(project, 'run2');
    const other = writeAssignment(project, 'run2', 'w1', '@@say X', { runId: 'run2' });
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: other })).rejects.toThrow(/Assignment must be/);
  });

  test('rejects an assignment whose workerId does not name its directory', async () => {
    const path = writeAssignment(project, 'run1', 'w1', '@@say X', { workerId: 'w2' });
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: path })).rejects.toThrow(/does not name its directory/);
  });

  test('rejects a brief path outside the worker directory', async () => {
    const path = writeAssignment(project, 'run1', 'w1', '@@say X', { brief: '../../run.json' });
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: path })).rejects.toThrow(/brief must be 'brief.md'/);
  });

  test('rejects a brief.md that is a symlink, and never sends its target', async () => {
    const path = writeAssignment(project, 'run1', 'w1', 'unused');
    const secret = join(project.home, 'secret.md');
    writeFileSync(secret, '@@say SECRET-OUTSIDE-THE-WORKER');
    const { rmSync, symlinkSync } = await import('node:fs');
    rmSync(join(workerDir(project, 'run1', 'w1'), 'brief.md'));
    symlinkSync(secret, join(workerDir(project, 'run1', 'w1'), 'brief.md'));
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: path })).rejects.toThrow(/brief\.md must be a regular file/);
    await sleep(1_000);
    const session = join(workerDir(project, 'run1', 'w1'), 'session');
    expect(existsSync(session) ? transcript(project, 'run1', 'w1') : []).not.toContain('assistant:SECRET-OUTSIDE-THE-WORKER');
  });

  test('rejects an assignment reached through a symlinked worker directory', async () => {
    const real = writeAssignment(project, 'run1', 'w1', '@@say X');
    const { symlinkSync } = await import('node:fs');
    symlinkSync(join(project.runRoot('run1'), 'workers', 'w1'), join(project.runRoot('run1'), 'workers', 'w2'));
    expect(existsSync(real)).toBe(true);
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: join(project.runRoot('run1'), 'workers', 'w2', 'assignment.json') })).rejects.toThrow();
  });

  test('rejects unknown assignment fields and a tmux-unsafe id smuggled in the file', async () => {
    const extra = writeAssignment(project, 'run1', 'w1', '@@say X', { command: 'rm -rf /' });
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: extra })).rejects.toThrow(/unknown fields: command/);
    const dir = join(project.runRoot('run1'), 'workers', 'w3');
    mkdirSync(dir);
    writeFileSync(join(dir, 'assignment.json'), JSON.stringify({ ...JSON.parse(readFileSync(extra, 'utf8')), command: undefined, workerId: 'w3;kill' }));
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: join(dir, 'assignment.json') })).rejects.toThrow(/Invalid workerId/);
  });

  test('refuses control from a session that does not own the run', async () => {
    writeAssignment(project, 'run1', 'w1', '@@say X');
    const stranger = makeParent(project, [], { sessionFile: join(project.home, 'other.jsonl') });
    await expect(stranger.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: join(project.runRoot('run1'), 'workers', 'w1', 'assignment.json') })).rejects.toThrow(/only its parent session/);
    await expect(stranger.call('pstack_worker', { action: 'steer', runId: 'run1', workerId: 'w1', message: 'x' })).rejects.toThrow(/only its parent session/);
  });
});
