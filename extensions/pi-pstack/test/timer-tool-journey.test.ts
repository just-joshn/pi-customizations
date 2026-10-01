import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { timerCommand } from '../scripts/timer-client.mjs';

test('SubscribeTimer preserves an explicitly loaded provider in its independent Pi root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-timer-tool-'));
  let service: string | undefined;
  onTestFinished(async () => {
    if (service) await timerCommand(service, { type: 'shutdown' });
    await rm(directory, { recursive: true, force: true });
  });
  const { stdout } = await promisify(execFile)(process.execPath, ['test/timer-tool-initiator.mjs', directory, process.cwd()]);
  const receipt = JSON.parse(stdout);
  service = dirname(receipt.rpcDirectory);
  expect(receipt.execution).toContain('Dedicated persistent Pi root');
  expect(receipt.sessionFile).not.toContain('initiating-session');
  await expect.poll(async () => (await readFile(receipt.sessionFile, 'utf8')).split('TIMER:via-tool').length, { timeout: 15000 }).toBeGreaterThan(3);
  await timerCommand(service, { type: 'unsubscribe', subscriptionId: receipt.subscriptionId });
  expect(await timerCommand(service, { type: 'list' })).toEqual([]);
}, 30000);
