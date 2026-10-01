import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { timerCommand } from '../scripts/timer-client.mjs';
import { fakeForge, timerOwner, userEntries } from './parity-ci-fixtures.ts';

async function toolDetails(sessionFile: string, name: string) {
  const entries = (await readFile(sessionFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const result = entries.find((entry) => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === name)?.message;
  if (!result || result.isError) throw new Error(`${name} did not succeed: ${JSON.stringify(result)}`);
  return result.details;
}

test('a timer and a CI subscription armed from a cloud Task root run on the guest and outlive that root', async () => {
  await fakeForge({ head: 'guest-sha', checks: [{ name: 'build', bucket: 'pass' }] });
  const workspace = await timerOwner('ci-cloud-root');
  const hostAgent = join(workspace, 'host-agent');
  const guestAgent = join(workspace, 'guest', 'agent');
  await mkdir(hostAgent, { recursive: true });
  await mkdir(guestAgent, { recursive: true });
  vi.stubEnv('PI_CODING_AGENT_DIR', hostAgent);
  const root = await startDetachedRpc({
    directory: join(workspace, 'guest', 'task', 'rpc-one'),
    cwd: workspace,
    agentDir: guestAgent,
    ownerId: '00000000-0000-0000-0000-000000000001',
    headless: true,
    closeAfterSettle: true,
    args: ['--no-extensions', '--no-skills', '--no-prompt-templates', '-e', join(process.cwd(), 'src/index.ts'), '-e', join(process.cwd(), 'test/parity-ci-provider.ts'), '--provider', 'ci-test', '--model', 'recorder', '--session-dir', join(workspace, 'guest', 'task', 'session')],
  });
  const state = await root.send({ type: 'get_state' });
  if (!state.success || state.command !== 'get_state') throw new Error('Cloud root did not report its state.');
  const rootSession = state.data.sessionFile ?? '';
  const accepted = await root.send({ type: 'prompt', message: 'ARM_ALL' });
  expect(accepted.success).toBe(true);
  await expect.poll(async () => (await root.activity()).kind, { timeout: 30000 }).toBe('settled');
  const timer = await toolDetails(rootSession, 'SubscribeTimer');
  const ci = await toolDetails(rootSession, 'SubscribeGithubCI');
  await root.close();

  const serviceDirectory = dirname(timer.rpcDirectory);
  expect(serviceDirectory.startsWith(join(guestAgent, 'pstack-timers'))).toBe(true);
  expect(dirname(ci.rpcDirectory)).toBe(serviceDirectory);
  await expect(readFile(join(hostAgent, 'pstack-timers'))).rejects.toThrow('ENOENT');
  expect(timer.sessionFile).not.toBe(rootSession);

  await expect.poll(async () => (await userEntries(timer.sessionFile, 'TIMER:cloud-tick')).length, { timeout: 30000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await userEntries(timer.sessionFile, 'CI for o/r#12 reached success')).length, { timeout: 30000 }).toBe(1);
  expect((await userEntries(timer.sessionFile, 'CI for o/r#12 reached success'))[0]).toContain('Act on the guest CI result.');
  expect(await timerCommand(serviceDirectory, { type: 'list' })).toHaveLength(2);
  await timerCommand(serviceDirectory, { type: 'shutdown' });
}, 120000);
