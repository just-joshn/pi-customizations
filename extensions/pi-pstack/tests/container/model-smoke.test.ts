// Opt-in: one tiny prompt per real provider, inside a real container, with the operator's real credentials.
// PSTACK_E2E_REAL_MODELS=1 npx vitest run tests/container/model-smoke.test.ts
// PSTACK_E2E_SMOKE_MODELS overrides the models, comma separated (default: deepseek/deepseek-flash,claude-subscription/claude-sonnet-5-5).
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { agentDirOf } from '../../src/container-auth.ts';
import { tmuxSessionName } from '../../src/run-files.ts';
import { type Entry, FIXTURE, killTmuxServer, makeParent, makeProject, makeRun, type Parent, PI, type Project, stopProject, transcript, until, workerDir, writeAssignment } from '../worker-lifecycle/harness.ts';

const run = promisify(execFile);
const REAL = process.env['PSTACK_E2E_REAL_MODELS'] === '1';
const MODELS = (process.env['PSTACK_E2E_SMOKE_MODELS'] ?? 'deepseek/deepseek-flash,claude-subscription/claude-sonnet-5-5').split(',');

function engineEnv(): Record<string, string> {
  if (process.env['DOCKER_HOST']) return { DOCKER_HOST: process.env['DOCKER_HOST'] };
  const host = execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).trim();
  return host === '' ? {} : { DOCKER_HOST: host };
}
function piEntry(): string {
  const agent = dirname(dirname(PI));
  const version = readFileSync(join(agent, 'install', 'current-version'), 'utf8').trim();
  return join(agent, 'install', 'releases', version, 'node_modules', '.bin', 'pi');
}
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const RUN_ID = `smk-${randomBytes(3).toString('hex')}`;
let project: Project;
let parent: Parent;
const entries: Entry[] = [];

describe.skipIf(!REAL)('a container worker on a real model', () => {
  beforeAll(async () => {
    project = makeProject('pstack-smoke-');
    const remote = join(dirname(project.dir), 'remote.git');
    git(dirname(project.dir), 'init', '--quiet', '--bare', '-b', 'main', remote);
    git(project.dir, 'remote', 'add', 'origin', remote);
    git(project.dir, 'push', '--quiet', 'origin', 'main');
    makeRun(project, RUN_ID);
    const env = { ...engineEnv(), HOME: process.env['HOME'] ?? homedir(), PI_CODING_AGENT_DIR: agentDirOf(process.env) };
    parent = makeParent(project, entries, { containerPi: piEntry(), extraPiArgs: [], extraEnv: env });
    await parent.start();
  }, 120_000);
  afterAll(async () => {
    await parent?.stop();
    if (project !== undefined) await stopProject(project);
    await killTmuxServer();
  }, 120_000);

  test.for(MODELS)('%s answers one short prompt from inside the container', { timeout: 300_000 }, async (model) => {
    const workerId = model.replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const authFile = join(agentDirOf(process.env), 'auth.json');
    const digest = () => (existsSync(authFile) ? createHash('sha256').update(readFileSync(authFile)).digest('hex') : null);
    const before = digest();
    const assignment = writeAssignment(project, RUN_ID, workerId, 'Reply with exactly the word PONG and nothing else.', { model, workspace: { mode: 'container', inputCommit: project.commit } });
    await parent.call('pstack_worker', { action: 'spawn', runId: RUN_ID, assignmentPath: assignment });

    const collected = await until(
      async () => (await parent.call('pstack_worker', { action: 'collect', runId: RUN_ID, workerId })).details,
      (details) => details.settled === true,
      180_000,
      `${model} to settle`,
    );

    process.stdout.write(`SMOKE ${model}: phase=${collected.lastSettle.phase} reason=${JSON.stringify(collected.lastSettle.reason)} finalText=${JSON.stringify(collected.finalText)}\n`);
    expect(collected.lastSettle.phase).toBe('idle');
    expect(digest()).toBe(before);
    expect(collected.finalText).toMatch(/PONG/i);
    const session = tmuxSessionName(project.dir, RUN_ID as never, workerId as never);
    const inspected = (await run('docker', ['inspect', '--format', '{{json .Config}}', session])).stdout;
    expect(inspected).not.toMatch(/sk-ant|"key"/);
    await parent.call('pstack_worker', { action: 'abort', runId: RUN_ID, workerId });
    expect(workerDir(project, RUN_ID, workerId)).toBeTruthy();
  });

  test.skipIf(!MODELS.includes('claude-subscription/claude-sonnet-5-5'))('a container worker whose OAuth token expires cannot refresh it, so its model call fails, and the real credential on the host is never touched', { timeout: 300_000 }, async () => {
    // A copy of the real agent directory whose access token claims to expire in 90 seconds, so Pi inside the container tries to refresh it.
    const real = agentDirOf(process.env);
    const copy = mkdtempSync(join(tmpdir(), 'pstack-expiry-agent-'));
    const auth = JSON.parse(readFileSync(join(real, 'auth.json'), 'utf8')) as Record<string, { expires?: number }>;
    const claude = auth['claude-subscription'] as { expires: number };
    writeFileSync(join(copy, 'auth.json'), JSON.stringify({ 'claude-subscription': { ...claude, expires: Date.now() + 90_000 } }));
    writeFileSync(join(copy, 'settings.json'), readFileSync(join(real, 'settings.json')));
    symlinkSync(join(real, 'npm'), join(copy, 'npm'));
    mkdirSync(join(copy, 'sessions'));
    const hostDigest = createHash('sha256').update(readFileSync(join(real, 'auth.json'))).digest('hex');
    const env = { ...engineEnv(), HOME: process.env['HOME'] ?? homedir(), PI_CODING_AGENT_DIR: copy };
    const short = makeParent(project, entries, { containerPi: piEntry(), extraPiArgs: [], extraEnv: env, minOAuthValidityMs: 0 });
    await short.start();
    const assignment = writeAssignment(project, RUN_ID, 'expiry', 'Reply with exactly the word PONG and nothing else.', { model: 'claude-subscription/claude-sonnet-5-5', workspace: { mode: 'container', inputCommit: project.commit } });
    await short.call('pstack_worker', { action: 'spawn', runId: RUN_ID, assignmentPath: assignment });

    const collected = await until(
      async () => (await short.call('pstack_worker', { action: 'collect', runId: RUN_ID, workerId: 'expiry' })).details,
      (details) => details.settled === true,
      180_000,
      'the expiring worker to settle',
    );

    process.stdout.write(`SMOKE expiry: phase=${collected.lastSettle.phase} reason=${JSON.stringify(collected.lastSettle.reason)}\n`);
    expect(collected.lastSettle.phase).toBe('failed');
    expect(collected.lastSettle.reason).toMatch(/refresh/i);
    expect(createHash('sha256').update(readFileSync(join(real, 'auth.json'))).digest('hex')).toBe(hostDigest);
    await short.call('pstack_worker', { action: 'abort', runId: RUN_ID, workerId: 'expiry' });
    await short.stop();
  });

  test('a forge worker gets the operator\'s gh login as a token, and gh in the container accepts it', { timeout: 300_000 }, async () => {
    const env = { ...engineEnv(), HOME: process.env['HOME'] ?? homedir(), PI_CODING_AGENT_DIR: agentDirOf(process.env) };
    const forge = makeParent(project, entries, { containerPi: piEntry(), extraPiArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-approve', '--extension', FIXTURE], extraEnv: env });
    await forge.start();
    const script = [{ tool: 'bash', args: { command: 'gh --version | head -1; gh auth status 2>&1 | head -6' } }];
    const assignment = writeAssignment(project, RUN_ID, 'forge', `@@script ${JSON.stringify(script)}`, { model: 'scripted/echo', workspace: { mode: 'container', inputCommit: project.commit }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } });
    await forge.call('pstack_worker', { action: 'spawn', runId: RUN_ID, assignmentPath: assignment });

    await until(
      async () => (await forge.call('pstack_worker', { action: 'collect', runId: RUN_ID, workerId: 'forge' })).details.settled,
      (done) => done === true,
      180_000,
      'the forge worker to settle',
    );

    const shown = transcript(project, RUN_ID, 'forge').filter((line) => line.startsWith('assistant:RESULTS:')).join('\n');
    process.stdout.write(`SMOKE forge: ${JSON.stringify(shown)}\n`);
    expect(shown).toMatch(/gh version/);
    expect(shown).toMatch(/Logged in to github\.com/);
    expect(shown).toMatch(/\(GH_TOKEN\)/);
    await forge.call('pstack_worker', { action: 'abort', runId: RUN_ID, workerId: 'forge' });
    await forge.stop();
  });
});
