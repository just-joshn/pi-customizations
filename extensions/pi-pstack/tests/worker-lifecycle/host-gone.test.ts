import { spawn } from 'node:child_process';
import { expect, test } from 'vitest';
import { claimedHostGone } from '../../src/workers.ts';

test('a live pid whose start time cannot be read is treated as the host, so its launch secrets stay', () => {
  expect(claimedHostGone(process.pid, 'recorded', () => undefined)).toBe(false);
});

test('a live pid with a different start time is not the host', () => {
  expect(claimedHostGone(process.pid, 'recorded', () => 'other')).toBe(true);
});

test('a live pid with the recorded start time is the host', () => {
  expect(claimedHostGone(process.pid, 'recorded', () => 'recorded')).toBe(false);
});

test('a dead pid is gone even when its start time cannot be read', async () => {
  const child = spawn('true');
  await new Promise((resolve) => child.once('exit', resolve));
  expect(claimedHostGone(child.pid!, 'recorded', () => undefined)).toBe(true);
});
