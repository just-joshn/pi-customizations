// Orchestrate's sub-coordinators: a worker with capabilities.spawn runs pstack_worker itself, owns the runs under its
// own workspace, and receives its workers' wakes; its parent never sees them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { registerWorkerSideTools } from '../../src/workers.ts';
import { makeParent, makeProject, makeRun, type Parent, PI, type Project, readState, stopProject, TEST_PI_ARGS, until, wakes, workerDir, workerTestEnv, writeAssignment } from './harness.ts';

const WORKER_SIDE = join(PACKAGE_ROOT, 'tests/worker-lifecycle/worker-side-extension.ts');
const PI_ARGS = [...TEST_PI_ARGS, '--extension', WORKER_SIDE];

test.for([
  [{ PSTACK_WORKER: '1' }, ['pstack_evidence']],
  [{ PSTACK_WORKER: '1', PSTACK_SPAWN: '1' }, ['pstack_evidence', 'pstack_worker']],
] as const)('a worker with env %j registers %j', ([env, tools]) => {
  const registered: string[] = [];
  const pi = { registerTool: (tool: { name: string }) => registered.push(tool.name), on: () => undefined } as unknown as ExtensionAPI;
  registerWorkerSideTools(pi, env);
  expect(registered.sort()).toEqual(tools);
});

let project: Project;
let parent: Parent;

beforeEach(() => {
  project = makeProject();
  makeRun(project, 'run1');
  const workerOptions = { piCommand: [PI], extraPiArgs: PI_ARGS, agentsDir: project.agentsDir, pollMs: 150 };
  parent = makeParent(project, [], { extraPiArgs: PI_ARGS, extraEnv: { ...workerTestEnv(project), PSTACK_TEST_WORKER_OPTIONS: JSON.stringify(workerOptions) } });
});

afterEach(async () => {
  await parent.stop();
  await stopProject(project);
});

// Pi creates a session file on the worker's first message, so a poll can arrive before it exists.
const sessionEntries = (file: string) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];

test('a sub-coordinator spawns a worker into its own run, gets its wake, and its parent never does; it cannot spawn a third coordinator level', async () => {
  const worktree = join(workerDir(project, 'run1', 'sub'), 'worktree');
  const subRun = join(worktree, '.pi', 'pstack', 'runs', 'sub1');
  const leaf = join(subRun, 'workers', 'leaf');
  const third = join(subRun, 'workers', 'c3');
  // A writable leaf declares every registered tool; a readonly one's --tools allowlist would hide pstack_worker anyway.
  const leafAssignment = { runId: 'sub1', workerId: 'leaf', role: 'general', model: 'scripted/echo', workspace: { mode: 'worktree', inputCommit: project.commit }, brief: 'brief.md' };
  const thirdAssignment = { ...leafAssignment, workerId: 'c3', capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false, spawn: true } };
  const script = [
    { tool: 'bash', args: { command: `node ${join(PACKAGE_ROOT, 'scripts/start-run.mjs')} --playbook feature --title nested --run-id sub1` } },
    [
      { tool: 'write', args: { path: join(leaf, 'brief.md'), content: '@@tools-list' } },
      { tool: 'write', args: { path: join(leaf, 'assignment.json'), content: JSON.stringify(leafAssignment) } },
      { tool: 'write', args: { path: join(third, 'brief.md'), content: '@@say THIRD' } },
      { tool: 'write', args: { path: join(third, 'assignment.json'), content: JSON.stringify(thirdAssignment) } },
    ],
    { tool: 'pstack_worker', args: { action: 'spawn', runId: 'sub1', assignmentPath: join(leaf, 'assignment.json') } },
    { tool: 'pstack_worker', args: { action: 'spawn', runId: 'sub1', assignmentPath: join(third, 'assignment.json') } },
  ];
  const brief = `@@script ${JSON.stringify(script)}`;
  const capabilities = { mcp: 'inherit', env: 'inherit', externalWrite: false, spawn: true };
  await parent.start();
  await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'sub', brief, { workspace: { mode: 'worktree', inputCommit: project.commit }, capabilities }) });

  const subSession = (await until(
    () => readState(project, 'run1', 'sub').sessionFile as string | null,
    (file) => file !== null,
    20_000,
    "the sub-coordinator's session file",
  )) as string;
  const results = await until(
    () => sessionEntries(subSession).find((entry) => entry.type === 'message' && entry.message.role === 'assistant' && entry.message.content[0]?.text?.startsWith('RESULTS:'))?.message.content[0].text as string | undefined,
    (text) => text !== undefined,
    40_000,
    "the sub-coordinator's script results",
  );
  expect(results).toContain('[pstack_worker] Spawned worker leaf');
  expect(results).toMatch(/\[pstack_worker error\][^\n]*spawn: true at depth 3/);
  expect(existsSync(join(third, 'claim'))).toBe(false);
  expect(JSON.parse(readFileSync(join(subRun, 'run.json'), 'utf8')).parentSessionFile).toBe(subSession);

  const leafState = await until(
    () => (existsSync(join(leaf, 'state.json')) ? JSON.parse(readFileSync(join(leaf, 'state.json'), 'utf8')) : undefined),
    (state) => state?.settles?.some((settle: { phase: string }) => settle.phase === 'idle') === true,
    30_000,
    'the leaf settles',
  );
  const leafSession = sessionEntries(leafState.sessionFile);
  const leafTools = leafSession.filter((entry) => entry.type === 'message' && entry.message.role === 'assistant').at(-1).message.content[0].text.split(',');
  expect(leafTools).toContain('pstack_evidence');
  expect(leafTools).not.toContain('pstack_worker');

  const leafWake = await until(
    () => sessionEntries(subSession).filter((entry) => entry.type === 'custom_message' && entry.customType === 'pstack-worker'),
    (entries) => entries.length > 0,
    20_000,
    "the leaf's wake in the sub-coordinator's session",
  );
  expect(leafWake).toEqual([expect.objectContaining({ details: expect.objectContaining({ runId: 'sub1', workerId: 'leaf', phase: 'idle' }) })]);

  // The wake starts a turn in the sub-coordinator. Once the settle after its reply is recorded, the root has exactly
  // one wake per settle of the sub-coordinator, and none for the leaf.
  const reply = await until(
    () => sessionEntries(subSession).find((entry) => entry.type === 'message' && entry.message.role === 'assistant' && entry.message.content[0]?.text?.startsWith('ECHO: pstack worker leaf in run sub1')),
    (entry) => entry !== undefined,
    20_000,
    "the sub-coordinator's reply to the leaf's wake",
  );
  const { settles } = await until(
    () => ({ settles: readState(project, 'run1', 'sub').settles as { at: string }[], woken: wakes(parent).length }),
    ({ settles, woken }) => Date.parse(settles.at(-1)?.at ?? '') >= Date.parse(reply.timestamp) && woken === settles.length,
    20_000,
    'one root wake per settle of the sub-coordinator',
  );
  expect(wakes(parent).map((wake) => wake?.workerId)).toEqual(Array(settles.length).fill('sub'));
  expect(readdirSync(join(project.dir, '.pi', 'pstack', 'runs'))).toEqual(['run1']);
});
