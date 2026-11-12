// A worker's environment is the parent's at spawn time, never the tmux server's from when the server started.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { FAKE_PI, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, until, writeAssignment } from './harness.ts';

const socket = `pstack-test-env-${randomBytes(4).toString('hex')}`;
const names = ['HOME', 'PATH', 'AWS_SESSION_TOKEN', 'U04A_REMOVED', 'U04A_ADDED'] as const;
let project: Project;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  project = makeProject();
  makeRun(project, 'run1');
  saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
});

afterEach(async () => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  try {
    execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
  await stopProject(project);
});

const collectJson = async (owner: Parent, workerId: string) => {
  const result = await until(
    async () => (await owner.call('pstack_worker', { action: 'collect', runId: 'run1', workerId })).details,
    (details) => details.settled === true,
    15_000,
    `${workerId} settles`,
  );
  return JSON.parse(result.finalText);
};

test('variables changed or unset in the parent after the tmux server started are changed or absent in the worker', async () => {
  process.env['AWS_SESSION_TOKEN'] = 'stale-credential';
  process.env['U04A_REMOVED'] = 'stale-variable';
  execFileSync('tmux', ['-L', socket, 'new-session', '-d', '-s', 'server-already-running', '--', 'sleep', '120']);
  const home = join(project.home, 'changed-home');
  const path = `/pstack-changed-path:${process.env['PATH']}`;
  process.env['HOME'] = home;
  process.env['PATH'] = path;
  delete process.env['AWS_SESSION_TOKEN'];
  delete process.env['U04A_REMOVED'];
  process.env['U04A_ADDED'] = 'added-later';

  const owner = makeParent(project, [], { tmuxSocket: socket, piCommand: [process.execPath, FAKE_PI], extraEnv: {}, resolveModel: () => ({ provider: 'amazon-bedrock', id: 'fake', thinkingLevel: null }) });
  const minimal = { mcp: 'none', env: 'minimal', externalWrite: false };
  await owner.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'm1', `@@env-json ${names.join(' ')}`, { capabilities: minimal }) });
  await owner.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'i1', `@@env-json ${names.join(' ')}`) });
  try {
    expect(await collectJson(owner, 'm1')).toEqual({ HOME: home, PATH: path, AWS_SESSION_TOKEN: null, U04A_REMOVED: null, U04A_ADDED: null });
    expect(await collectJson(owner, 'i1')).toEqual({ HOME: home, PATH: path, AWS_SESSION_TOKEN: null, U04A_REMOVED: null, U04A_ADDED: 'added-later' });
  } finally {
    for (const workerId of ['m1', 'i1']) await owner.call('pstack_worker', { action: 'abort', runId: 'run1', workerId }).catch(() => undefined);
    await owner.stop();
  }
});
