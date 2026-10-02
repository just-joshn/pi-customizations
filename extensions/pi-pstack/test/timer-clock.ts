import { readFile } from 'node:fs/promises';

import { expect } from 'vitest';
import { timerCommand } from '../scripts/timer-client.mjs';

export const occurrences = async (sessionFile: string, needle: string) => (await readFile(sessionFile, 'utf8')).split(needle).length - 1;

const completedClockRuns = async (sessionFile: string) => ((await readFile(sessionFile, 'utf8')).match(/recorded TIMER:clock/gi) ?? []).length;

// A second timer on the same root is the clock: once it has completed several runs, any other timer still armed would have run too.
export async function letTimersTick(directory: string, runs = 3): Promise<void> {
  const clock = await timerCommand(directory, { type: 'subscribe', timer: { name: 'clock', prompt: 'TIMER:clock', delaySeconds: 1 } });
  await expect.poll(() => completedClockRuns(clock.sessionFile), { timeout: 20000 }).toBeGreaterThanOrEqual(runs);
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: clock.subscriptionId });
}
