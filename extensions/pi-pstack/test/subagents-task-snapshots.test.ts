import { expect, test } from 'vitest';
import { panelLines, taskSnapshot } from '../src/subagents/task-snapshots.ts';
import type { TaskRecord } from '../src/worker-records.ts';

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    persona: 'explore',
    cwd: '/repo',
    readonly: false,
    sessionFile: '/sessions/t1.jsonl',
    outputFile: '/sessions/t1.out',
    status: 'settled',
    output: '',
    ...overrides,
  };
}

const sources = { liveTokens: () => undefined, contextWindow: (model: string) => (model === 'gpt' ? 200_000 : undefined) };

test('a settled record becomes a completed local-agent snapshot with its model and effort split', () => {
  expect(taskSnapshot(record({ agentName: 'alpha', description: 'look around', startedAt: 1000, modelReference: 'gpt:high', usage: { totalTokens: 12 } as never }), sources)).toMatchObject({
    id: 't1',
    name: 'alpha',
    type: 'local_agent',
    agentType: 'explore',
    status: 'completed',
    description: 'look around',
    startTime: 1000,
    model: 'gpt',
    effort: 'high',
    contextWindowSize: 200_000,
    tokenCount: 12,
    cwd: '/repo',
  });
});

test('running live tokens win over the recorded usage and missing model metadata is omitted', () => {
  const snapshot = taskSnapshot(record({ status: 'running', usage: { totalTokens: 99 } as never }), { ...sources, liveTokens: () => 42 });
  expect(snapshot.tokenCount).toBe(42);
  expect(snapshot).not.toHaveProperty('model');
  expect(snapshot).not.toHaveProperty('effort');
  expect(snapshot).not.toHaveProperty('contextWindowSize');
  expect(snapshot.description).toBe('explore');
  expect(taskSnapshot(record({ status: 'failed' }), sources).status).toBe('failed');
  expect(taskSnapshot(record({ status: 'interrupted' }), sources).status).toBe('killed');
});

test('panel lines pick the status icon and append any decoration', () => {
  const tasks = [
    taskSnapshot(record({ id: 'a', status: 'running' }), sources),
    taskSnapshot(record({ id: 'b', status: 'settled', agentName: 'beta' }), sources),
    taskSnapshot(record({ id: 'c', status: 'failed' }), sources),
    taskSnapshot(record({ id: 'd', status: 'interrupted' }), sources),
  ];
  expect(panelLines(tasks, { b: '48% used' })).toEqual(['● explore: explore', '✓ beta: explore · 48% used', '✗ explore: explore', '■ explore: explore']);
});
