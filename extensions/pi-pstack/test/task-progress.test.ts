import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { progressObserver, type TaskToolDetails } from '../src/subagents/task-progress.ts';

function observe(isCurrent = () => true) {
  const updates: Array<{ text: string; details: TaskToolDetails }> = [];
  const listener = progressObserver('task-1', isCurrent, (update) => {
    const block = update.content[0];
    updates.push({ text: block?.type === 'text' ? block.text : '', details: update.details });
  });
  return { updates, listener };
}

const started = (toolCallId: string, toolName: string, parentToolCallId?: string): AgentSessionEvent => ({ type: 'tool_execution_start', toolCallId, toolName, args: {}, ...(parentToolCallId ? { parentToolCallId } : {}) });
const finished = (toolCallId: string, toolName: string, isError: boolean): AgentSessionEvent => ({ type: 'tool_execution_end', toolCallId, toolName, result: {}, isError });

test('a tool run reports its start and end with the tools still active', () => {
  const { updates, listener } = observe();
  listener(started('a', 'read'));
  listener(started('b', 'grep'));
  listener(finished('a', 'read', false));
  expect(updates.map((update) => update.text)).toEqual([
    'Task task-1 running. Active tools: read. Latest: read started.',
    'Task task-1 running. Active tools: read, grep. Latest: grep started.',
    'Task task-1 running. Active tools: grep. Latest: read finished.',
  ]);
});

test('a failed tool is reported as failed', () => {
  const { updates, listener } = observe();
  listener(started('a', 'bash'));
  listener(finished('a', 'bash', true));
  expect(updates.at(-1)?.text).toBe('Task task-1 running. Active tools: none. Latest: bash failed.');
});

test('a tool name that is not a plain identifier is reported as an extension tool', () => {
  const { updates, listener } = observe();
  listener(started('a', 'secret path /etc/passwd'));
  expect(updates[0]?.details).toMatchObject({ kind: 'progress', task_id: 'task-1', status: 'running', active_tools: ['extension tool'], latest: { kind: 'tool-started', tool: 'extension tool' } });
});

test('retries are reported with their attempt numbers', () => {
  const { updates, listener } = observe();
  listener({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: 'overloaded' });
  listener({ type: 'auto_retry_end', success: true, attempt: 1 });
  listener({ type: 'auto_retry_end', success: false, attempt: 2, finalError: 'gave up' });
  expect(updates.map((update) => update.text)).toEqual([
    'Task task-1 running. Active tools: none. Latest: retry 1/3 started.',
    'Task task-1 running. Active tools: none. Latest: retry 1 recovered.',
    'Task task-1 running. Active tools: none. Latest: retry 2 failed.',
  ]);
});

test('nested tool calls and unrelated events produce no update', () => {
  const { updates, listener } = observe();
  listener(started('child', 'read', 'parent'));
  listener({ type: 'agent_start' });
  expect(updates).toEqual([]);
});

test('a stale generation reports nothing', () => {
  const { updates, listener } = observe(() => false);
  listener(started('a', 'read'));
  expect(updates).toEqual([]);
});
