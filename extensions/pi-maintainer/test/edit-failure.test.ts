import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import maintainerExtension from '../index.ts';
import { createHarness, type MaintainerHarness } from './helpers/fake-pi.ts';

async function prepareTurn(harness: MaintainerHarness): Promise<void> {
  await harness.emit('session_start', { type: 'session_start', reason: 'startup' });
  await harness.emit('turn_start', { type: 'turn_start', turnIndex: 0, timestamp: 0 });
  await harness.emit('tool_call', { type: 'tool_call', toolName: 'edit', input: { path: 'missing.py' } });
}

function endTurn(harness: MaintainerHarness): Promise<unknown> {
  return harness.emit('turn_end', { type: 'turn_end', outcome: 'completed' });
}

function failedMessages(harness: MaintainerHarness): string[] {
  return harness.notifications.map((notification) => notification.message);
}

describe('reflection budget after a failed edit', () => {
  function makeBrokenRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'maintainer-budget-'));
    writeFileSync(join(dir, 'broken.js'), 'function broken( {\n  return 1;\n}\n');
    return dir;
  }

  async function failedEditTurn(harness: MaintainerHarness, turnIndex: number): Promise<void> {
    await harness.emit('turn_start', { type: 'turn_start', turnIndex, timestamp: turnIndex });
    await harness.emit('tool_result', { type: 'tool_result', toolName: 'edit', isError: true });
    await endTurn(harness);
  }

  async function lintFailureTurn(harness: MaintainerHarness, turnIndex: number): Promise<unknown> {
    await harness.emit('turn_start', { type: 'turn_start', turnIndex, timestamp: turnIndex });
    await harness.emit('tool_call', { type: 'tool_call', toolName: 'edit', input: { path: 'broken.js' } });
    return endTurn(harness);
  }

  test('spends one reflection per failed edit from the same budget', async () => {
    const harness = createHarness({ cwd: makeBrokenRepo(), confirmAnswer: true });
    maintainerExtension(harness.pi);
    await harness.emit('session_start', { type: 'session_start', reason: 'startup' });
    await failedEditTurn(harness, 0);
    await failedEditTurn(harness, 1);
    const result = await lintFailureTurn(harness, 2);
    expect(result).toEqual({ entries: expect.any(Array), continue: true });
  });

  test('drops the repair once three failed edits exhausted the budget', async () => {
    const harness = createHarness({ cwd: makeBrokenRepo(), confirmAnswer: true });
    maintainerExtension(harness.pi);
    await harness.emit('session_start', { type: 'session_start', reason: 'startup' });
    await failedEditTurn(harness, 0);
    await failedEditTurn(harness, 1);
    await failedEditTurn(harness, 2);
    const result = await lintFailureTurn(harness, 3);
    expect(result).toBe(undefined);
    expect(failedMessages(harness)).toContain('Only 3 reflections allowed, stopping.');
  });
});

describe('turn_end after an edited file', () => {
  test('lints the edited file when every edit tool call succeeded', async () => {
    const harness = createHarness();
    maintainerExtension(harness.pi);
    await prepareTurn(harness);
    await endTurn(harness);
    expect(harness.notifications[0]?.type).toBe('error');
    expect(harness.notifications[0]?.message.startsWith('Unable to read /repo/missing.py')).toBe(true);
  });

  test('skips lint and test when an edit tool result failed', async () => {
    const harness = createHarness();
    maintainerExtension(harness.pi);
    await prepareTurn(harness);
    await harness.emit('tool_result', { type: 'tool_result', toolName: 'edit', isError: true });
    const result = await endTurn(harness);
    expect(result).toBe(undefined);
    expect(failedMessages(harness).length).toBe(0);
  });

  test('skips lint and test when a write tool result failed', async () => {
    const harness = createHarness();
    maintainerExtension(harness.pi);
    await prepareTurn(harness);
    await harness.emit('tool_result', { type: 'tool_result', toolName: 'write', isError: true });
    await endTurn(harness);
    expect(failedMessages(harness).length).toBe(0);
  });

  test('lints again on the next turn after a failed edit', async () => {
    const harness = createHarness();
    maintainerExtension(harness.pi);
    await prepareTurn(harness);
    await harness.emit('tool_result', { type: 'tool_result', toolName: 'edit', isError: true });
    await endTurn(harness);
    await harness.emit('turn_start', { type: 'turn_start', turnIndex: 1, timestamp: 1 });
    await harness.emit('tool_call', { type: 'tool_call', toolName: 'edit', input: { path: 'missing.py' } });
    await endTurn(harness);
    expect(harness.notifications[0]?.message.startsWith('Unable to read /repo/missing.py')).toBe(true);
  });
});
