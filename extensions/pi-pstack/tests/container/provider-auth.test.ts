// A container worker authenticates with its model provider: only that provider's credential, an access token without the
// refresh token, and the package that registers the provider. The provider here is a fixture whose reply is the credential it saw.
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { tmuxSessionName } from '../../src/run-files.ts';
import { type Entry, killTmuxServer, makeParent, makeProject, makeRun, type Parent, PI, type Project, stopProject, until, workerDir, workerTestEnv, writeAssignment } from '../worker-lifecycle/harness.ts';

const run = promisify(execFile);

function engineEnv(): Record<string, string> {
  if (process.env['DOCKER_HOST']) return { DOCKER_HOST: process.env['DOCKER_HOST'] };
  const host = execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).trim();
  return host === '' ? {} : { DOCKER_HOST: host };
}
const ENGINE = engineEnv();
process.env['DOCKER_HOST'] = ENGINE['DOCKER_HOST'] ?? '';
if (process.env['DOCKER_HOST'] === '') delete process.env['DOCKER_HOST'];

const docker = async (...args: string[]) => (await run('docker', args)).stdout.trim();
function piEntry(): string {
  const agent = dirname(dirname(PI));
  const version = readFileSync(join(agent, 'install', 'current-version'), 'utf8').trim();
  return join(agent, 'install', 'releases', version, 'node_modules', '.bin', 'pi');
}
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const RUN_ID = `aut-${randomBytes(3).toString('hex')}`;
const HOST_REFRESH = `rt-HOST-REFRESH-${randomBytes(6).toString('hex')}`;
const DECOY = `decoy-${randomBytes(6).toString('hex')}`;
/** Random per run, so a leak into the host's process list cannot be this file's own source. */
const tokens = (name: string) => `${name}-${randomBytes(8).toString('hex')}`;
const MINUTE = 60_000;

let project: Project;
let entries: Entry[];
let parent: Parent;
const authFile = () => join(project.agentDir, 'auth.json');
const hostAuth = () => readFileSync(authFile(), 'utf8');
const digest = () => createHash('sha256').update(hostAuth()).digest('hex');
const storeCredentials = (credentials: Record<string, unknown>) => writeFileSync(authFile(), JSON.stringify({ anthropic: { type: 'api_key', key: DECOY }, ...credentials }));
const oauth = (access: string, expires: number) => ({ type: 'oauth', access, refresh: HOST_REFRESH, expires });

const spawn = (workerId: string, model: string, fields: Record<string, unknown> = {}, who: Parent = parent) =>
  who.call('pstack_worker', { action: 'spawn', runId: RUN_ID, assignmentPath: writeAssignment(project, RUN_ID, workerId, 'say anything', { model, workspace: { mode: 'container', inputCommit: project.commit }, ...fields }) });
const collect = (workerId: string) => parent.call('pstack_worker', { action: 'collect', runId: RUN_ID, workerId });
const abort = (workerId: string) => parent.call('pstack_worker', { action: 'abort', runId: RUN_ID, workerId });
const settled = (workerId: string) =>
  until(
    async () => (await collect(workerId)).details,
    (details) => details.settled === true,
    120_000,
    `${workerId} to settle`,
  );
/** What the fixture provider answered: the key it authenticated with, and the auth.json the worker's Pi had. */
const answer = (details: { finalText: string | null }) => JSON.parse(details.finalText as string) as { apiKey: string | null; stored: Record<string, Record<string, unknown>> | null };

beforeAll(async () => {
  project = makeProject('pstack-auth-');
  const remote = join(dirname(project.dir), 'remote.git');
  git(dirname(project.dir), 'init', '--quiet', '--bare', '-b', 'main', remote);
  git(project.dir, 'remote', 'add', 'origin', remote);
  git(project.dir, 'push', '--quiet', 'origin', 'main');
  makeRun(project, RUN_ID);
  entries = [];
  cpSync(join(import.meta.dirname, '../../test/fixtures/fake-provider'), join(project.agentDir, 'npm', 'node_modules', 'pstack-fake-provider'), { recursive: true });
  writeFileSync(join(project.agentDir, 'settings.json'), JSON.stringify({ packages: ['npm:pstack-fake-provider@1.0.0'] }));
  mkdirSync(join(project.dir, '.pi'), { recursive: true });
  parent = makeParent(project, entries, { containerPi: piEntry(), extraEnv: { ...workerTestEnv(project), ...ENGINE } });
  await parent.start();
}, 120_000);

afterAll(async () => {
  await parent?.stop();
  if (project !== undefined) await stopProject(project);
  const left = (await docker('ps', '--all', '--quiet', '--filter', `label=pstack.run=${RUN_ID}`)).split('\n').filter(Boolean);
  if (left.length > 0) await docker('rm', '--force', ...left);
  await killTmuxServer();
}, 120_000);

describe('a container worker on an OAuth provider', () => {
  test('authenticates with the access token it was handed, holding no refresh token and no other provider credential, and leaves the host auth.json alone', async () => {
    const access = tokens('at-ACCESS');
    storeCredentials({ 'pstack-fake-oauth': oauth(access, Date.now() + 2 * 60 * MINUTE) });
    const before = digest();

    await spawn('o1', 'pstack-fake-oauth/m');
    const result = await settled('o1');

    const seen = answer(result);
    expect(seen.apiKey).toBe(`fake-at:${access}`);
    expect(seen.stored).toEqual({ 'pstack-fake-oauth': { type: 'oauth', access, refresh: '', expires: expect.any(Number) } });
    expect(JSON.stringify(seen)).not.toContain(HOST_REFRESH);
    expect(JSON.stringify(seen)).not.toContain(DECOY);
    const name = tmuxSessionName(project.dir, RUN_ID as never, 'o1' as never);
    expect(await docker('inspect', '--format', '{{json .Config}}', name)).not.toContain(access);
    expect((await run('ps', ['-ww', '-eo', 'args'], { maxBuffer: 64 << 20 })).stdout).not.toContain(access);
    expect(existsSync(join(workerDir(project, RUN_ID, 'o1'), 'claim', 'launch-env.json'))).toBe(false);
    expect(digest()).toBe(before);
    await abort('o1');
  }, 240_000);

  test('a token near expiry is refreshed by the host before spawn, so the worker gets the new token and the host keeps the rotated refresh token', async () => {
    const fresh = tokens('at-FRESH');
    const rotated = tokens('rt-ROTATED');
    storeCredentials({ 'pstack-fake-oauth': oauth('at-STALE', Date.now() + 2 * MINUTE) });
    const asked: string[] = [];
    // The session's own model registry is what refreshes: the parent's Pi does it, not the container.
    const modelRegistry = {
      getApiKeyForProvider: async (provider: string) => {
        asked.push(provider);
        storeCredentials({ 'pstack-fake-oauth': { type: 'oauth', access: fresh, refresh: rotated, expires: Date.now() + 8 * 60 * MINUTE } });
        return `fake-at:${fresh}`;
      },
    };
    const refreshing = makeParent(project, entries, { containerPi: piEntry(), extraEnv: { ...workerTestEnv(project), ...ENGINE }, modelRegistry });
    await refreshing.start();

    await spawn('o2', 'pstack-fake-oauth/m', {}, refreshing);
    const result = await settled('o2');

    expect(asked).toEqual(['pstack-fake-oauth']);
    expect(answer(result).apiKey).toBe(`fake-at:${fresh}`);
    expect(JSON.stringify(answer(result))).not.toContain(rotated);
    expect(hostAuth()).toContain(rotated);
    await abort('o2');
    await refreshing.stop();
  }, 240_000);

  test('a token that expires while the worker runs fails the worker\'s model call, and the container tried to refresh with an empty refresh token, never the host\'s', async () => {
    storeCredentials({ 'pstack-fake-oauth': oauth('at-DYING', Date.now() + 2 * MINUTE) });
    const before = digest();
    const short = makeParent(project, entries, { containerPi: piEntry(), extraEnv: { ...workerTestEnv(project), ...ENGINE }, minOAuthValidityMs: 0 });
    await short.start();

    await spawn('o3', 'pstack-fake-oauth/m', {}, short);
    const result = await settled('o3');

    const attempt = JSON.parse(readFileSync(join(workerDir(project, RUN_ID, 'o3'), 'out', 'refresh-attempt.json'), 'utf8')) as { refresh: string };
    expect(attempt).toEqual({ refresh: '' });
    expect(result.lastSettle.phase).toBe('failed');
    expect(result.lastSettle.reason).toMatch(/refresh/i);
    expect(digest()).toBe(before);
    expect(hostAuth()).toContain(HOST_REFRESH);
    await abort('o3');
    await short.stop();
  }, 240_000);

  test('a token near expiry with nobody to refresh it fails the spawn before any claim', async () => {
    storeCredentials({ 'pstack-fake-oauth': oauth('at-DYING', Date.now() + 3 * MINUTE) });

    await expect(spawn('o4', 'pstack-fake-oauth/m')).rejects.toThrow(/ProviderAuthUnavailable: .*expires in \d+ min.*cannot refresh it/);

    expect(existsSync(join(workerDir(project, RUN_ID, 'o4'), 'claim'))).toBe(false);
  });
});

describe('a container worker on an api_key provider', () => {
  test('authenticates with its stored key, and an assignment with no model runs the host\'s default model in the container', async () => {
    const key = tokens('key-LITERAL');
    storeCredentials({ 'pstack-fake-key': { type: 'api_key', key } });
    writeFileSync(join(project.agentDir, 'settings.json'), JSON.stringify({ packages: ['npm:pstack-fake-provider@1.0.0'], defaultProvider: 'pstack-fake-key', defaultModel: 'm' }));

    // A parent with no model of its own, as an automation run has: inherit-parent then means the host's default.
    const parentless = makeParent(project, entries, { containerPi: piEntry(), extraEnv: { ...workerTestEnv(project), ...ENGINE }, resolveModel: (() => null) as never });
    await parentless.start();
    const spawned = await spawn('k1', 'inherit-parent', {}, parentless);
    const result = await settled('k1');

    expect(spawned.details.model).toEqual({ provider: 'pstack-fake-key', id: 'm' });
    expect(answer(result).apiKey).toBe(key);
    expect(answer(result).stored).toEqual({ 'pstack-fake-key': { type: 'api_key', key } });
    await abort('k1');
    await parentless.stop();
    writeFileSync(join(project.agentDir, 'settings.json'), JSON.stringify({ packages: ['npm:pstack-fake-provider@1.0.0'] }));
  }, 240_000);

  test('a provider whose package is not installed fails the spawn before any claim', async () => {
    const key = tokens('key-LITERAL');
    storeCredentials({ 'pstack-fake-key': { type: 'api_key', key } });
    writeFileSync(join(project.agentDir, 'settings.json'), JSON.stringify({ packages: [] }));

    await expect(spawn('k2', 'pstack-fake-key/m')).rejects.toThrow(/ProviderAuthUnavailable: .*no installed Pi package/);

    expect(existsSync(join(workerDir(project, RUN_ID, 'k2'), 'claim'))).toBe(false);
  });
});
