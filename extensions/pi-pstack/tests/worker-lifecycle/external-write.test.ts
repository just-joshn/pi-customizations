// externalWrite is a tracker-worker capability: a trusted spawner may grant it to a readonly Pi worker and to nothing else.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { spawnAssignment } from '../../src/workers.ts';
import { killTmuxServer, makeProject, makeRun, PI, type Project, stopProject, TEST_PI_ARGS, TMUX, workerDir, workerTestEnv, writeAssignment } from './harness.ts';

let project: Project;
beforeEach(() => {
  project = makeProject();
  makeRun(project, 'run1');
});
afterEach(() => stopProject(project));
afterAll(killTmuxServer);

const caps = { mcp: 'inherit', env: 'minimal', externalWrite: true };
const trusted = (workerId: string, fields: Record<string, unknown>) =>
  spawnAssignment(project.dir, 'run1' as never, writeAssignment(project, 'run1', workerId, 'unused', fields), {
    tmuxSocket: TMUX,
    piCommand: [PI],
    extraPiArgs: TEST_PI_ARGS,
    extraEnv: workerTestEnv(project),
    agentsDir: project.agentsDir,
    allowExternalWrite: true,
  });

const REFUSED = /externalWrite.*readonly/s;

test.each([
  ['worktree', { workspace: { mode: 'worktree', inputCommit: '' } }],
  ['container', { workspace: { mode: 'container', inputCommit: '' } }],
  ['watch', { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: { mode: 'readonly' }, watch: { argv: ['true'] } }],
])('a trusted spawner still cannot give externalWrite to a %s assignment, and nothing is claimed', async (name, fields) => {
  const workspace = (fields as { workspace: { inputCommit?: string } }).workspace;
  if (workspace.inputCommit === '') workspace.inputCommit = project.commit;
  await expect(trusted(name, { ...fields, capabilities: caps })).rejects.toThrow(REFUSED);
  expect(existsSync(join(workerDir(project, 'run1', name), 'claim'))).toBe(false);
});
