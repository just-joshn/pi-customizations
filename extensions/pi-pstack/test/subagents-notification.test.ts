import { expect, test } from 'vitest';
import { agentNotification } from '../src/subagents/notification.ts';

const defaultNote = 'A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.';

test('[B65][B67][B106] a completed agent renders the task-notification markup with summary, note, result and usage', () => {
  const text = agentNotification({
    taskId: 'task-1',
    toolUseId: 'call-1',
    outputFile: '/tmp/task-1.jsonl',
    description: 'audit <api>',
    outcome: { status: 'completed' },
    result: 'found 2 & fixed',
    usage: { totalTokens: 25, toolUses: 1, durationMs: 44 },
  });
  expect(text).toBe(
    [
      '<task-notification>',
      '<task-id>task-1</task-id>',
      '<tool-use-id>call-1</tool-use-id>',
      '<output-file>/tmp/task-1.jsonl</output-file>',
      '<status>completed</status>',
      '<summary>Agent "audit &lt;api&gt;" finished</summary>',
      `<note>${defaultNote}</note>`,
      '<result>found 2 &amp; fixed</result>',
      '<usage><subagent_tokens>25</subagent_tokens><tool_uses>1</tool_uses><duration_ms>44</duration_ms></usage>',
      '</task-notification>',
    ].join('\n'),
  );
});

test.for([
  { name: 'turn limit', outcome: { status: 'completed', maxTurnsReached: 3 }, summary: 'Agent "d" stopped at its 3-turn limit (partial result; SendMessage to task-id to continue)' },
  { name: 'failure', outcome: { status: 'failed', error: 'scripted failure' }, summary: 'Agent "d" failed: scripted failure' },
  { name: 'failure without error', outcome: { status: 'failed' }, summary: 'Agent "d" failed: Unknown error' },
  { name: 'parent stop', outcome: { status: 'stopped', killedBy: 'parent' }, summary: 'Agent "d" was stopped by Claude' },
  { name: 'user stop', outcome: { status: 'stopped', killedBy: 'user' }, summary: 'Agent "d" was stopped by user' },
  { name: 'stop with reason', outcome: { status: 'stopped', error: 'shutdown' }, summary: 'Agent "d" was stopped: shutdown' },
  { name: 'plain stop', outcome: { status: 'stopped' }, summary: 'Agent "d" was stopped' },
] as const)('[B71][C16] $name has its own terminal summary', ({ outcome, summary }) => {
  expect(agentNotification({ taskId: 't', description: 'd', outcome })).toBe(`<task-notification>\n<task-id>t</task-id>\n<status>${outcome.status}</status>\n<summary>${summary}</summary>\n<note>${defaultNote}</note>\n</task-notification>`);
});

test('[B71] an interim completion warns that the result may be interim', () => {
  expect(agentNotification({ taskId: 't', description: 'd', outcome: { status: 'completed', interim: true } })).toContain(
    '<note>This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports, and the same task-id notifies again if it does; the result below may be interim.</note>',
  );
});

test('[B67] a kept worktree is reported inside the notification', () => {
  expect(agentNotification({ taskId: 't', description: 'd', outcome: { status: 'completed' }, worktree: { path: '/w', branch: 'b<1>' } })).toContain(
    '\n<worktree><worktreePath>/w</worktreePath><worktreeBranch>b&lt;1&gt;</worktreeBranch></worktree>\n</task-notification>',
  );
});
