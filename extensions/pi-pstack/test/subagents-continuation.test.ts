import { expect, test } from 'vitest';
import { checkContinuation, checkRestart, coordinatorMessage } from '../src/subagents/continuation.ts';
import type { TaskRecord } from '../src/worker-records.ts';

const record: TaskRecord = { id: 'a1', persona: 'general-purpose', cwd: '/w', readonly: false, sessionFile: '/missing/a1.jsonl', outputFile: '/w/a1.txt', status: 'interrupted', output: '' };
const idle = { inFlight: false, stopping: false, resumerStopping: false };

test.for([
  { state: { ...idle, inFlight: true }, name: 'AgentResumeInProgressError', code: 'busy', message: 'Agent a1 is already running or being resumed' },
  { state: { ...idle, resumerStopping: true }, name: 'AgentStillStoppingError', code: 'still_stopping', message: 'This agent has been stopped and its stop is still completing; it cannot resume other agents.' },
  {
    state: { ...idle, stopping: true },
    name: 'AgentStillStoppingError',
    code: 'still_stopping',
    message: 'Agent a1 is still stopping — its previous run was stopped but has not exited. Re-run TaskStop on it or wait for it to exit before resuming.',
  },
])('continuation guard refuses with $code', ({ state, name, code, message }) => {
  expect(() => checkContinuation('a1', state)).toThrow(expect.objectContaining({ name, code, message }));
});

const guardOutcome = (state: typeof idle): string => {
  try {
    checkContinuation('a1', state);
    return 'passes';
  } catch (error) {
    return (error as { code: string }).code;
  }
};

test('an idle agent passes the continuation guard', () => {
  expect(guardOutcome(idle)).toBe('passes');
  expect(guardOutcome({ ...idle, inFlight: true })).toBe('busy');
});

test('a user-stopped agent is refused unless the invocation is user initiated', () => {
  const stopped: TaskRecord = { ...record, abort: { reason: 'user-cancel', telemetry: 'user_cancel', userInitiated: true } };
  expect(() => checkRestart(stopped, false)).toThrow(
    expect.objectContaining({
      name: 'AgentStoppedByUserError',
      code: 'user_stopped',
      message: "Agent a1 was stopped by the user and won't be resumed. Treat its work as cancelled; only launch a new agent if the user explicitly asks.",
    }),
  );
  expect(() => checkRestart(stopped, true)).toThrow(expect.objectContaining({ code: 'state' }));
});

test('a missing transcript is a state error rather than a fresh session', () => {
  expect(() => checkRestart(record, false)).toThrow(expect.objectContaining({ name: 'ResumeAgentStateError', code: 'state', message: 'No transcript found for agent ID: a1' }));
});

test('a message to a running agent carries the coordinator wrapper', () => {
  expect(coordinatorMessage('look at b.ts')).toBe('The coordinator sent a message while you were working:\nlook at b.ts\n\nAddress this before completing your current task.');
});
