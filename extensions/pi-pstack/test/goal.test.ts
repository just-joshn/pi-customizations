import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { continuationPrompt, parseGoalArgs } from '../src/goal.ts';
import { fixture, prompt } from './session-fixture.ts';

test('goal completion and session reopening preserve nonzero session usage', async () => {
  const f = await fixture({ extensionOnly: true, usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0.07, output: 0.03, cacheRead: 0, cacheWrite: 0, total: 0.1 } } });
  try {
    const { session, manager } = await f.open();
    await prompt(session, 'Work before the goal');
    expect(session.getSessionStats().tokens.total).toBe(10);
    f.calls.push(
      { type: 'toolCall', id: 'create-usage-goal', name: 'CreateGoal', arguments: { objective: 'Preserve measured usage' } },
      { type: 'toolCall', id: 'complete-usage-goal', name: 'UpdateGoal', arguments: { status: 'complete' } },
    );
    await prompt(session, 'Create and complete the fixture goal');
    expect(session.getSessionStats().tokens).toEqual({ input: 28, output: 12, cacheRead: 0, cacheWrite: 0, total: 40 });
    expect(session.getSessionStats().cost).toBeCloseTo(0.4);
    const goalEntry = manager.getBranch().findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-goal');
    expect(goalEntry?.type === 'custom' ? goalEntry.data : undefined).toEqual({ objective: 'Preserve measured usage', status: 'complete' });
    const file = manager.getSessionFile();
    expect(file).toBeDefined();
    const reopened = await f.open(SessionManager.open(file ?? '', undefined));
    expect(reopened.session.getSessionStats().tokens.total).toBe(40);
    expect(reopened.session.getSessionStats().cost).toBeCloseTo(0.4);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('goal arguments drop a leading time limit and keep the objective', () => {
  expect(parseGoalArgs('30m ship the queue')).toEqual({ objective: 'ship the queue', droppedTimeLimit: true });
  expect(parseGoalArgs('2h fix all tests')).toEqual({ objective: 'fix all tests', droppedTimeLimit: true });
  expect(parseGoalArgs('  ship 30m of work ')).toEqual({ objective: 'ship 30m of work', droppedTimeLimit: false });
  expect(parseGoalArgs('   ')).toEqual({ objective: '', droppedTimeLimit: false });
});

test('an active goal requests one continuation at the final settlement boundary', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const manager = SessionManager.inMemory(f.cwd);
    manager.appendCustomEntry('pstack-goal', { objective: 'Verify the full objective', status: 'active' });
    const { session } = await f.open(manager);
    const result = await session.extensionRunner.emitBoundary({ type: 'agent_before_settle', outcome: 'completed' }, () => ({ contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: true }));
    expect(result.continue).toBe(true);
    expect(result.entries).toEqual([{ type: 'custom_message', customType: 'pstack-goal-continue', display: true, content: continuationPrompt('Verify the full objective') }]);
    expect(f.requests).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test.each(['aborted', 'error'] as const)('an active goal does not restart after a %s settlement', async (outcome) => {
  const f = await fixture({ extensionOnly: true });
  try {
    const manager = SessionManager.inMemory(f.cwd);
    manager.appendCustomEntry('pstack-goal', { objective: 'Preserve the objective', status: 'active' });
    const { session } = await f.open(manager);
    const result = await session.extensionRunner.emitBoundary({ type: 'agent_before_settle', outcome }, () => ({ contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: true }));
    expect(result.continue).toBe(false);
    expect(result.entries).toEqual([]);
    expect(f.requests).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a goal continuation makes the preview eligible for the next request', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const manager = SessionManager.inMemory(f.cwd);
    manager.appendCustomEntry('pstack-goal', { objective: 'Retain the goal for later', status: 'active' });
    const { session } = await f.open(manager);
    const result = await session.extensionRunner.emitBoundary({ type: 'agent_before_settle', outcome: 'completed' }, (entries) => ({
      contextEntries: [],
      contextMessages: [],
      llmMessages: [],
      pendingMessages: [],
      canContinue: entries.length > 0,
    }));
    expect(result.continue).toBe(true);
    expect(result.context.canContinue).toBe(true);
    expect(result.entries).toEqual([{ type: 'custom_message', customType: 'pstack-goal-continue', display: true, content: continuationPrompt('Retain the goal for later') }]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('continuation prompt carries the full objective and the completion gate', () => {
  const text = continuationPrompt('land PR 5');
  expect(text).toContain('land PR 5');
  expect(text).toMatch(/UpdateGoal with status complete only when the audit passes/);
});
