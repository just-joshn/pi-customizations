// A user fanning out a swarm spawns several container workers at once. Each Pi cold-starts on the same engine, so every worker must
// still start: Pi's first answer is slower than a lone worker's, and spawn must wait for it instead of failing a worker that is only slow.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { killTmuxServer, makeParent, makeProject, makeRun, type Parent, PI, type Project, stopProject, workerTestEnv, writeAssignment } from '../worker-lifecycle/harness.ts';

const run = (args: string[], env: NodeJS.ProcessEnv = process.env) => execFileSync('docker', args, { encoding: 'utf8', env }).trim();
// The merge gate isolates HOME, which hides a docker context (OrbStack, Colima), so the engine is pinned here too.
const ENGINE: Record<string, string> = process.env['DOCKER_HOST'] ? { DOCKER_HOST: process.env['DOCKER_HOST'] } : { DOCKER_HOST: run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']) };
const WORKERS = 10;
const RUN_ID = `cc-${randomBytes(3).toString('hex')}`;

let project: Project;
let parent: Parent;

function piEntry(): string {
  const override = process.env['PSTACK_E2E_PI_ENTRY'];
  if (override) return override;
  const agent = dirname(dirname(PI));
  const version = readFileSync(join(agent, 'install', 'current-version'), 'utf8').trim();
  return join(agent, 'install', 'releases', version, 'node_modules', '.bin', 'pi');
}

beforeAll(() => {
  project = makeProject('pstack-cc-');
  const remote = join(dirname(project.dir), 'remote.git');
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git(dirname(project.dir), 'init', '--quiet', '--bare', '-b', 'main', remote);
  git(project.dir, 'remote', 'add', 'origin', remote);
  git(project.dir, 'push', '--quiet', 'origin', 'main');
  makeRun(project, RUN_ID);
}, 120_000);

afterAll(async () => {
  await parent?.stop();
  if (project !== undefined) await stopProject(project);
  const left = run(['ps', '--all', '--quiet', '--filter', `label=pstack.run=${RUN_ID}`], { ...process.env, ...ENGINE }).split('\n').filter(Boolean);
  for (const id of left) spawnSync('docker', ['rm', '--force', id], { env: { ...process.env, ...ENGINE } });
  await killTmuxServer();
}, 120_000);

describe('container workers spawned together', () => {
  test(`${WORKERS} spawned at once all start`, async () => {
    parent = makeParent(project, [], { containerPi: piEntry(), extraEnv: { ...workerTestEnv(project), ...ENGINE } });
    await parent.start();
    const outcomes = await Promise.allSettled(
      Array.from({ length: WORKERS }, (_, i) =>
        parent.call('pstack_worker', { action: 'spawn', runId: RUN_ID, assignmentPath: writeAssignment(project, RUN_ID, `w${i}`, '@@tools-list', { workspace: { mode: 'container', inputCommit: project.commit } }) }),
      ),
    );

    expect(outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [String(outcome.reason)] : []))).toEqual([]);
  }, 300_000);
});
