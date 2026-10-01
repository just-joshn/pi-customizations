import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { continuationPrompt, parseGoalArgs } from '../src/goal.ts';
import { fixture } from './session-fixture.ts';

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
