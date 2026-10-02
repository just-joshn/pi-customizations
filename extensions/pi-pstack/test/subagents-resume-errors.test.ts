import { expect, test } from 'vitest';
import { ResumeError, resumeMessages } from '../src/subagents/resume-errors.ts';

test.for([
  { code: 'busy', name: 'AgentResumeInProgressError' },
  { code: 'still_stopping', name: 'AgentStillStoppingError' },
  { code: 'transient', name: 'AgentResumeTransientError' },
  { code: 'permanent', name: 'AgentResumePermanentlyRefusedError' },
  // biome-ignore lint/security/noSecrets: fixture name from the module under test, not a credential
  { code: 'user_stopped', name: 'AgentStoppedByUserError' },
  { code: 'state', name: 'ResumeAgentStateError' },
] as const)('$code ResumeError carries the documented name and code', ({ code, name }) => {
  const error = new ResumeError(code, 'why it failed');
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe(name);
  expect(error.code).toBe(code);
  expect(error.message).toBe('why it failed');
});

test('resume messages name the agent and the recovery step', () => {
  expect(resumeMessages.busy('a1')).toBe('Agent a1 is already running or being resumed');
  expect(resumeMessages.resumerStopping).toBe('This agent has been stopped and its stop is still completing; it cannot resume other agents.');
  expect(resumeMessages.targetStopping('a1')).toBe('Agent a1 is still stopping — its previous run was stopped but has not exited. Re-run TaskStop on it or wait for it to exit before resuming.');
  expect(resumeMessages.userStopped('a1')).toBe("Agent a1 was stopped by the user and won't be resumed. Treat its work as cancelled; only launch a new agent if the user explicitly asks.");
  expect(resumeMessages.transcriptMissing('a1')).toBe('No transcript found for agent ID: a1');
  expect(resumeMessages.notOffered('explore')).toBe("Agent type 'explore' is not offered in this session.");
});
