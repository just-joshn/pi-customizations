import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { restartTimerService, startTimerService, timerCommand } from '../scripts/timer-client.mjs';
import { registerTimers } from '../src/timers.ts';
import { type FakeCheck, type FakeForge, fakeForge, timerOwner, userEntries } from './parity-ci-fixtures.ts';

const pass: FakeCheck = { name: 'build', bucket: 'pass' };
const fail: FakeCheck = { name: 'test', bucket: 'fail' };
const pending: FakeCheck = { name: 'build', bucket: 'pending' };

async function ownerWithRoot(prefix: string) {
  const directory = await timerOwner(prefix);
  await startTimerService(directory, {
    cwd: directory,
    agentDir: join(directory, 'agent'),
    args: ['--no-extensions', '--no-skills', '--no-prompt-templates', '-e', join(process.cwd(), 'test/journey-provider.ts'), '--provider', 'journey-test', '--model', 'recorder', '--session-dir', join(directory, 'session')],
  });
  return directory;
}

const subscribeGithub = (directory: string, extra = {}) => timerCommand(directory, { type: 'subscribe_ci', ci: { forge: 'github', pr: 12, repo: 'o/r', pollSeconds: 1, prompt: 'Act on the CI result.', cwd: directory, ...extra } });
const wakes = (receipt: { sessionFile: string }, state: string) => userEntries(receipt.sessionFile, `CI for o/r#12 reached ${state}`);
const pollsFor = async (forge: Awaited<ReturnType<typeof fakeForge>>, pr: number) => (await forge.calls()).filter((call) => call.startsWith(`pr checks ${pr} `)).length;
const polls = async (forge: Awaited<ReturnType<typeof fakeForge>>) => (await forge.calls()).filter((call) => call.startsWith('pr checks')).length;

async function polledAgain(forge: Awaited<ReturnType<typeof fakeForge>>, extra = 3) {
  const target = (await polls(forge)) + extra;
  await expect.poll(() => polls(forge), { timeout: 20000 }).toBeGreaterThanOrEqual(target);
}

test('a GitHub CI subscription wakes the owning root once per terminal state through pending, success and failure', async () => {
  const forge = await fakeForge({ head: 'sha-one', checks: [pending] });
  const directory = await ownerWithRoot('ci-states');
  const receipt = await subscribeGithub(directory);
  expect(receipt).toMatchObject({ kind: 'ci', forge: 'github', pr: 12, name: 'ci-github-o/r-12' });

  await polledAgain(forge);
  expect(await wakes(receipt, 'success')).toHaveLength(0);
  expect(await wakes(receipt, 'failure')).toHaveLength(0);

  await forge.set({ head: 'sha-one', checks: [pass, { name: 'lint', bucket: 'skipping' }] });
  await expect.poll(async () => (await wakes(receipt, 'success')).length, { timeout: 20000 }).toBe(1);
  await polledAgain(forge);
  expect(await wakes(receipt, 'success')).toHaveLength(1);
  expect((await wakes(receipt, 'success'))[0]).toContain('Act on the CI result.');

  await forge.set({ head: 'sha-two', checks: [pending, fail] });
  await polledAgain(forge);
  expect(await wakes(receipt, 'failure')).toHaveLength(0);
  await forge.set({ head: 'sha-two', checks: [pass, fail] });
  await expect.poll(async () => (await wakes(receipt, 'failure')).length, { timeout: 20000 }).toBe(1);
  await polledAgain(forge);
  expect(await wakes(receipt, 'failure')).toHaveLength(1);
  expect(await wakes(receipt, 'success')).toHaveLength(1);

  await forge.set({ head: 'sha-two', checks: [pending] });
  await polledAgain(forge, 2);
  await forge.set({ head: 'sha-two', checks: [fail] });
  await expect.poll(async () => (await wakes(receipt, 'failure')).length, { timeout: 20000 }).toBe(2);

  const calls = await forge.calls();
  expect(calls.some((call) => call.startsWith('pr checks 12') && call.includes('--json') && call.includes('-R o/r'))).toBe(true);
  expect(calls.some((call) => call.startsWith('pr view 12') && call.includes('headRefOid'))).toBe(true);
  expect(await timerCommand(directory, { type: 'list' })).toEqual([expect.objectContaining({ subscriptionId: receipt.subscriptionId, ci: expect.objectContaining({ state: 'failure', head: 'sha-two' }) })]);
}, 90000);

test('a restarted timer service does not repeat a terminal CI wake it already delivered', async () => {
  const forge = await fakeForge({ head: 'sha-one', checks: [pass] });
  const directory = await ownerWithRoot('ci-restart');
  const receipt = await subscribeGithub(directory);
  await expect.poll(async () => (await wakes(receipt, 'success')).length, { timeout: 20000 }).toBe(1);
  await expect.poll(async () => (await timerCommand(directory, { type: 'list' }))[0]?.ci?.state).toBe('success');
  const status = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'));
  process.kill(status.pid, 'SIGKILL');
  await expect
    .poll(() => {
      try {
        process.kill(status.pid, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  await restartTimerService(directory);
  await polledAgain(forge);
  expect(await wakes(receipt, 'success')).toHaveLength(1);
  const duplicate = await subscribeGithub(directory, { prompt: 'changed' });
  expect(duplicate.subscriptionId).toBe(receipt.subscriptionId);
}, 60000);

test('a gh failure is reported on the subscription and polling recovers without a wake', async () => {
  const forge = await fakeForge({ head: 'sha-one', checks: [pass], broken: true });
  const directory = await ownerWithRoot('ci-broken');
  const receipt = await subscribeGithub(directory);
  await expect.poll(async () => (await timerCommand(directory, { type: 'list' }))[0].ci?.error, { timeout: 20000 }).toContain('502');
  expect(await wakes(receipt, 'success')).toHaveLength(0);
  await forge.set({ head: 'sha-one', checks: [pass] });
  await expect.poll(async () => (await wakes(receipt, 'success')).length, { timeout: 20000 }).toBe(1);
  expect((await timerCommand(directory, { type: 'list' }))[0]?.ci?.error).toBeUndefined();
}, 60000);

test('a PR with no checks yet stays pending and a merged PR is a terminal state', async () => {
  const forge = await fakeForge({ head: 'sha-one', checks: [] });
  const directory = await ownerWithRoot('ci-empty');
  const receipt = await subscribeGithub(directory);
  await polledAgain(forge, 2);
  expect(await userEntries(receipt.sessionFile, 'CI for o/r#12 reached')).toHaveLength(0);
  expect((await timerCommand(directory, { type: 'list' }))[0]?.ci?.state).toBe('pending');
  await forge.set({ head: 'sha-one', prState: 'MERGED', checks: [] });
  await expect.poll(async () => (await wakes(receipt, 'merged')).length, { timeout: 20000 }).toBe(1);
}, 60000);

test('unsubscribing ends the polling of a CI subscription', async () => {
  const forge = await fakeForge({ head: 'sha-one', checks: [pending] });
  const directory = await ownerWithRoot('ci-stop');
  const receipt = await subscribeGithub(directory);
  await subscribeGithub(directory, { pr: 13 });
  await polledAgain(forge, 2);
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: receipt.subscriptionId });
  const settled = await pollsFor(forge, 12);
  const controlSettled = await pollsFor(forge, 13);
  await forge.set({ head: 'sha-one', checks: [pass] });
  await expect.poll(() => pollsFor(forge, 13), { timeout: 20000 }).toBeGreaterThanOrEqual(controlSettled + 3);
  expect(await pollsFor(forge, 12)).toBeLessThanOrEqual(settled + 1);
  expect(await wakes(receipt, 'success')).toHaveLength(0);
  expect((await timerCommand(directory, { type: 'list' })).map((entry: { name: string }) => entry.name)).toEqual(['ci-github-o/r-13']);
}, 60000);

test('a forge-neutral command fixture drives an Origin-style subscription to a terminal wake', async () => {
  const directory = await ownerWithRoot('ci-origin');
  const fixture = join(directory, 'origin-ci');
  await writeFile(fixture, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ head: 'origin-sha', state: 'failure', summary: 'lint failed on PR ' + process.argv[2] }));\n`);
  await chmod(fixture, 0o755);
  const receipt = await timerCommand(directory, { type: 'subscribe_ci', ci: { forge: 'origin', pr: 7, pollSeconds: 1, cwd: directory, command: [fixture] } });
  await expect.poll(async () => (await userEntries(receipt.sessionFile, 'CI for origin#7 reached failure')).length, { timeout: 20000 }).toBe(1);
  expect((await userEntries(receipt.sessionFile, 'CI for origin#7 reached failure'))[0]).toContain('lint failed on PR 7');
}, 60000);

test('invalid CI subscriptions are refused before they are armed', async () => {
  const directory = await ownerWithRoot('ci-invalid');
  for (const bad of [{ pr: 0 }, { pr: 1.5 }, { repo: 'not-a-repo' }, { pollSeconds: 0 }, { forge: 'origin' }, { forge: 'svn' }]) await expect(subscribeGithub(directory, bad)).rejects.toThrow('Invalid CI subscription');
  expect(await timerCommand(directory, { type: 'list' })).toEqual([]);
});

function toolDefinitions() {
  const definitions: Parameters<Parameters<typeof registerTimers>[0]['registerTool']>[0][] = [];
  registerTimers({ registerTool: (tool: (typeof definitions)[number]) => definitions.push(tool) } as unknown as Parameters<typeof registerTimers>[0]);
  return definitions;
}

test('SubscribeOriginCI states that the live Origin path is unsupported without a command contract', async () => {
  vi.stubEnv('PI_PSTACK_ORIGIN_CI_COMMAND', '');
  const tool = toolDefinitions().find((item) => item.name === 'SubscribeOriginCI');
  if (!tool) throw new Error('SubscribeOriginCI was not registered.');
  await expect(tool.execute('test', { pr: 3 }, undefined, undefined, { cwd: process.cwd() } as never)).rejects.toThrow('Origin CI subscriptions are unsupported');
});

test('the CI subscription tools are registered next to the timer tools', () => {
  expect(
    toolDefinitions()
      .map((tool) => tool.name)
      .sort(),
  ).toEqual(['ListSubscriptions', 'RestartSubscriptions', 'SubscribeGithubCI', 'SubscribeOriginCI', 'SubscribeTimer', 'Unsubscribe']);
});
