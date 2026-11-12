// Opt-in (PSTACK_REAL_FORGE=1): a container worker with the forge capability against the real GitHub sandbox repository.
// The host clones nothing: the worker clones the private repository itself with the injected token, commits, pushes a branch
// over https to github.com, and reads the repository with gh. The test reads the pushed branch back from the GitHub API.
// Branches live under pfprobe/, which the sandbox workflow's push filter does not match, so no Actions minutes are used.
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { REAL_FORGE_ENABLED, SANDBOX_REPO } from '../workflow-parity/fixtures/real-forge.ts';
import { type Entry, killTmuxServer, makeParent, makeProject, makeRun, type Parent, PI, type Project, stopProject, transcript, until, workerTestEnv, writeAssignment } from '../worker-lifecycle/harness.ts';

const run = promisify(execFile);
const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

describe.skipIf(!REAL_FORGE_ENABLED)('a container worker with the forge capability against github.com', () => {
  const stamp = randomBytes(3).toString('hex');
  const RUN_ID = `rgh-${stamp}`;
  const base = `pfprobe/${stamp}/base`;
  const pushed = `pfprobe/${stamp}/pushed`;
  let project: Project;
  let parent: Parent;
  const entries: Entry[] = [];

  beforeAll(async () => {
    const engine = process.env['DOCKER_HOST'] ?? execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).trim();
    project = makeProject('pstack-real-github-');
    git(project.dir, 'config', '--add', 'credential.helper', '');
    git(project.dir, 'config', '--add', 'credential.helper', '!gh auth git-credential');
    git(project.dir, 'remote', 'add', 'origin', `https://github.com/${SANDBOX_REPO}.git`);
    git(project.dir, 'push', '--quiet', 'origin', `HEAD:refs/heads/${base}`);
    makeRun(project, RUN_ID);
    const token = gh('auth', 'token');
    parent = makeParent(project, entries, { containerPi: piEntry(), extraEnv: { ...workerTestEnv(project), ...(engine === '' ? {} : { DOCKER_HOST: engine }), GH_TOKEN: token, PSTACK_CONTAINER_FORGE_TOKEN: token } });
    await parent.start();
  }, 120_000);

  afterAll(async () => {
    await parent?.stop();
    for (const ref of [base, pushed]) await run('gh', ['api', '--method', 'DELETE', `repos/${SANDBOX_REPO}/git/refs/heads/${ref}`]).catch(() => undefined);
    if (project !== undefined) await stopProject(project);
    const left = (await run('docker', ['ps', '--all', '--quiet', '--filter', `label=pstack.run=${RUN_ID}`])).stdout.split('\n').filter(Boolean);
    if (left.length > 0) await run('docker', ['rm', '--force', ...left]);
    await killTmuxServer();
  }, 120_000);

  test('clones the private repository with the injected token, pushes a branch over https, and the GitHub API shows that commit', async () => {
    const command = [
      '[ -n "$GH_TOKEN" ] && echo token-present',
      'echo container > container.txt && git add container.txt && git -c user.name=container-worker -c user.email=container@users.noreply.github.com commit -qm "probe: pushed from a container"',
      `git push origin HEAD:refs/heads/${pushed} 2>&1 | tail -2`,
      `echo PUSHED=$(git rev-parse HEAD)`,
      `echo API-READS-REPO=$(gh api repos/${SANDBOX_REPO} --jq .full_name)`,
    ].join(' ; ');
    const assignment = writeAssignment(project, RUN_ID, 'pusher', `@@script ${JSON.stringify([{ tool: 'bash', args: { command } }])}`, { workspace: { mode: 'container', inputCommit: project.commit }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } });
    await parent.call('pstack_worker', { action: 'spawn', runId: RUN_ID, assignmentPath: assignment });
    await until(async () => (await parent.call('pstack_worker', { action: 'collect', runId: RUN_ID, workerId: 'pusher' })).details.settled, (done) => done === true, 180_000, 'the pusher to settle');
    const out = transcript(project, RUN_ID, 'pusher').filter((line) => line.startsWith('assistant:RESULTS:')).join('\n');
    const sha = /PUSHED=([0-9a-f]{40})/.exec(out)?.[1];
    expect(out).toContain('token-present');
    expect(out).toContain(`API-READS-REPO=${SANDBOX_REPO}`);
    const onGithub = JSON.parse(gh('api', `repos/${SANDBOX_REPO}/git/ref/heads/${pushed}`)) as { object: { sha: string } };
    expect(sha).toBeDefined();
    expect(onGithub.object.sha).toBe(sha);
    const commit = JSON.parse(gh('api', `repos/${SANDBOX_REPO}/commits/${sha}`)) as { commit: { author: { name: string }; message: string } };
    expect(commit.commit.author.name).toBe('container-worker');
    expect(out).not.toContain(gh('auth', 'token'));
    const dir = process.env['PSTACK_REAL_FORGE_EVIDENCE_DIR'];
    if (dir !== undefined) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'container-push.json'), `${JSON.stringify({ repo: SANDBOX_REPO, ref: `refs/heads/${pushed}`, sha, apiSha: onGithub.object.sha, author: commit.commit.author.name, message: commit.commit.message, recordedAt: new Date().toISOString(), runId: RUN_ID, workerId: 'pusher', workspace: 'container', forgeCapability: true, tokenInjectedBy: 'PSTACK_CONTAINER_FORGE_TOKEN' }, null, 2)}\n`);
    }
  }, 300_000);
});

function piEntry(): string {
  const override = process.env['PSTACK_E2E_PI_ENTRY'];
  if (override) return override;
  const agent = dirname(dirname(PI));
  const version = execFileSync('cat', [join(agent, 'install', 'current-version')], { encoding: 'utf8' }).trim();
  return join(agent, 'install', 'releases', version, 'node_modules', '.bin', 'pi');
}
