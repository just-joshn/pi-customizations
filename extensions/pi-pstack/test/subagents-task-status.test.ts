import { expect, test } from 'vitest';
import { acceptsMessages, canTransition, isTerminal, type TaskStatus, taskStatus, transitionBetween } from '../src/subagents/task-status.ts';
import type { TaskRecord } from '../src/worker-records.ts';

const reference-assistant = (mode: 'sync' | 'background', retired?: boolean) => ({ mode, agentType: 'explore', name: 'n', turns: [], ...(retired === undefined ? {} : { retired }) });
const view = (status: TaskRecord['status'], mode?: 'sync' | 'background', retired?: boolean): Pick<TaskRecord, 'status' | 'reference-assistant'> => ({ status, ...(mode ? { reference-assistant: reference-assistant(mode, retired) } : {}) });

test.for([
  { from: 'running', to: 'idle', allowed: true },
  { from: 'running', to: 'completed', allowed: true },
  { from: 'running', to: 'failed', allowed: true },
  { from: 'running', to: 'cancelled', allowed: true },
  { from: 'idle', to: 'running', allowed: true },
  { from: 'idle', to: 'cancelled', allowed: true },
  { from: 'idle', to: 'completed', allowed: false },
  { from: 'idle', to: 'failed', allowed: false },
  { from: 'completed', to: 'running', allowed: false },
  { from: 'failed', to: 'idle', allowed: false },
  { from: 'cancelled', to: 'running', allowed: false },
] satisfies { from: TaskStatus; to: TaskStatus; allowed: boolean }[])('$from to $to is allowed: $allowed', ({ from, to, allowed }) => {
  expect(canTransition(from, to)).toBe(allowed);
});

test.for([
  { status: 'running', terminal: false },
  { status: 'idle', terminal: false },
  { status: 'completed', terminal: true },
  { status: 'failed', terminal: true },
  { status: 'cancelled', terminal: true },
] satisfies { status: TaskStatus; terminal: boolean }[])('$status terminal is $terminal', ({ status, terminal }) => {
  expect(isTerminal(status)).toBe(terminal);
});

test.for([
  { record: view('running', 'sync'), expected: 'running' },
  { record: view('settled', 'background'), expected: 'idle' },
  { record: view('settled', 'sync'), expected: 'completed' },
  { record: view('settled', 'background', true), expected: 'completed' },
  { record: view('failed', 'background'), expected: 'failed' },
  { record: view('interrupted', 'background'), expected: 'cancelled' },
  { record: view('settled'), expected: 'completed' },
])('record %j projects to $expected', ({ record, expected }) => {
  expect(taskStatus(record)).toBe(expected);
});

test.for([
  { record: view('running', 'background'), expected: true },
  { record: view('settled', 'background'), expected: true },
  { record: view('settled', 'background', true), expected: false },
  { record: view('running', 'sync'), expected: false },
  { record: view('failed', 'background'), expected: false },
  { record: view('interrupted', 'background'), expected: false },
])('write_agent accepts $expected for $record', ({ record, expected }) => {
  expect(acceptsMessages(record)).toBe(expected);
});

test('a first sighting is a registration and an unchanged status is no transition', () => {
  expect(transitionBetween('a', undefined, view('running', 'background'))).toEqual({ id: 'a', from: 'registered', to: 'running' });
  expect(transitionBetween('a', view('running', 'background'), view('running', 'background'))).toBeUndefined();
  expect(transitionBetween('a', view('running', 'background'), view('settled', 'background'))).toEqual({ id: 'a', from: 'running', to: 'idle' });
});
