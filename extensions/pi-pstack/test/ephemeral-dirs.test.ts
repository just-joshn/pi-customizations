import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { EphemeralDirs } from '../src/ephemeral-dirs.ts';
import type { ShellRecord } from '../src/shell-runtime.ts';
import { fixture, prompt, toolResults } from './session-fixture.ts';

test('removeAll deletes only the directories created for that owner', async () => {
  const dirs = new EphemeralDirs('pstack-ephemeral-test-');
  const first = {};
  const second = {};
  const mine = await dirs.create(first);
  const other = await dirs.create(second);
  try {
    expect(dirname(mine)).toBe(tmpdir().replace(/\/$/, ''));
    expect(basename(mine).startsWith('pstack-ephemeral-test-')).toBe(true);
    await dirs.removeAll(first);
    expect([existsSync(mine), existsSync(other)]).toEqual([false, true]);
  } finally {
    await dirs.removeAll(second);
  }
  expect(existsSync(other)).toBe(false);
});

test('removeAll can run twice for one owner', async () => {
  const dirs = new EphemeralDirs('pstack-ephemeral-test-');
  const owner = {};
  const dir = await dirs.create(owner);
  await dirs.removeAll(owner);
  await dirs.removeAll(owner);
  expect(existsSync(dir)).toBe(false);
});

test('an unpersisted session shell log is removed at shutdown', async () => {
  const f = await fixture({ extensionOnly: true });
  const { session } = await f.open(SessionManager.inMemory());
  try {
    f.calls.push({ type: 'toolCall', id: 'shell-1', name: 'BackgroundShell', arguments: { command: 'true', title: 'ephemeral' } });
    await prompt(session, 'run it');
    const result = toolResults(session, 'BackgroundShell')[0];
    const record = result?.details as ShellRecord;
    const outputFile = record.outputFile;
    expect(basename(dirname(outputFile)).startsWith('pstack-shells-')).toBe(true);
    expect(existsSync(outputFile)).toBe(true);
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    expect(existsSync(dirname(outputFile))).toBe(false);
  } finally {
    await f.close();
  }
});
