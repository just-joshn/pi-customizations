import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { flaggedOutput, lastMeteredTokens, lastReportText, taskNotification } from '../src/subagents/completion-notice.ts';
import type { Finding } from '../src/subagents/output-trust.ts';
import type { TaskRecord } from '../src/worker-records.ts';

type Messages = AgentSession['messages'];

const usage = { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (content: Extract<Messages[number], { role: 'assistant' }>['content']): Messages[number] => ({
  role: 'assistant',
  content,
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  usage,
  stopReason: 'stop',
  timestamp: 1,
});
const user = (content: string): Messages[number] => ({ role: 'user', content, timestamp: 1 });

function record(extra: Partial<TaskRecord> = {}): TaskRecord {
  return { id: 't1', persona: 'general-purpose', cwd: '/w', readonly: false, sessionFile: '/s/t1.jsonl', outputFile: '/s/t1.txt', status: 'settled', output: '', ...extra };
}

const finding = (extra: Partial<Finding>): Finding => ({ pattern: 'p', category: 'c', count: 1, reportable: true, ...extra });

test('the last assistant message with usage determines the metered token total', () => {
  const messages = [assistant([{ type: 'text', text: 'a' }]), user('next'), assistant([{ type: 'text', text: 'b' }])];
  expect(lastMeteredTokens(messages)).toBe(20);
  expect(lastMeteredTokens([user('only a user')])).toBe(undefined);
  expect(lastMeteredTokens([])).toBe(undefined);
});

test('the report text is the newest assistant message that contains text blocks', () => {
  const messages = [
    assistant([{ type: 'text', text: 'first' }]),
    assistant([
      { type: 'text', text: 'second' },
      { type: 'toolCall', id: 'c', name: 'bash', arguments: {} },
      { type: 'text', text: 'third' },
    ]),
    assistant([{ type: 'toolCall', id: 'd', name: 'bash', arguments: {} }]),
    user('thanks'),
  ];
  expect(lastReportText(messages)).toBe('second\nthird');
  expect(lastReportText([user('hi')])).toBe('');
});

test('flagged output keeps only reportable findings with unique patterns and categories and a summed count', () => {
  const findings = [finding({ pattern: 'a', category: 'x', count: 2 }), finding({ pattern: 'a', category: 'y', count: 3 }), finding({ pattern: 'b', category: 'x', count: 1 }), finding({ pattern: 'z', category: 'q', reportable: false })];
  expect(flaggedOutput('agent-1', 'result', findings)).toEqual({ agent_id: 'agent-1', surface: 'result', patterns: ['a', 'b'], categories: ['x', 'y'], match_count: 6 });
  expect(flaggedOutput('agent-1', 'result', [finding({ reportable: false })])).toBe(undefined);
  expect(flaggedOutput('agent-1', 'result', [])).toBe(undefined);
});

test('a failed task reports the first line of its output as the error', () => {
  const { message, findings } = taskNotification(record({ status: 'failed', output: 'boom\nstack trace' }), 'ignored');
  expect(message.details).toMatchObject({ task_id: 't1', status: 'failed', output_file: '/s/t1.jsonl', summary: 'Agent "general-purpose" failed: boom', task_type: 'local_agent' });
  expect(message.content).toContain('failed: boom');
  expect(message.content).not.toContain('stack trace');
  expect(findings).toEqual([]);
});

test.for([
  { status: 'running' as const, stoppedBy: undefined, phrase: 'was stopped' },
  { status: 'interrupted' as const, stoppedBy: 'parent' as const, phrase: 'was stopped by Claude' },
  { status: 'interrupted' as const, stoppedBy: 'user' as const, phrase: 'was stopped by user' },
])('a $status task stopped by $stoppedBy says "$phrase"', ({ status, stoppedBy, phrase }) => {
  const { message } = taskNotification(record({ status, description: 'Reviewer' }), '', stoppedBy);
  expect(message.details).toMatchObject({ status: 'stopped', summary: `Agent "Reviewer" ${phrase}` });
});

test('a settled task includes usage, tool-use ids and an undeleted worktree in the notification', () => {
  const { message } = taskNotification(
    record({ toolUseId: 'tu-1', description: 'Audit', durationMs: 1500, totalTokens: 900, toolUseCount: 4, worktreePath: '/w/wt', worktreeBranch: 'agent/audit', worktreeCleanupWarning: 'left dirty' }),
    'All good',
  );
  expect(message.details).toMatchObject({
    tool_use_id: 'tu-1',
    status: 'completed',
    usage: { total_tokens: 900, tool_uses: 4, duration_ms: 1500 },
    worktree_cleanup_warning: 'left dirty',
  });
  expect(message.content).toContain('<subagent_tokens>900</subagent_tokens><tool_uses>4</tool_uses><duration_ms>1500</duration_ms>');
  expect(message.content).toContain('<worktreePath>/w/wt</worktreePath><worktreeBranch>agent/audit</worktreeBranch>');
  expect(message.content).toContain('All good');
});

test('usage defaults missing token and tool counts to zero and a removed worktree is omitted', () => {
  const { message } = taskNotification(record({ durationMs: 10, worktreePath: '/w/wt', worktreeCleanlyRemoved: true }), 'done');
  expect(message.details).toMatchObject({ usage: { total_tokens: 0, tool_uses: 0, duration_ms: 10 } });
  expect(message.content).not.toContain('worktreePath');
});

test('a settled task without branch metadata lists the worktree path alone', () => {
  const { message } = taskNotification(record({ worktreePath: '/w/wt' }), 'done');
  expect(message.content).toContain('<worktree><worktreePath>/w/wt</worktreePath></worktree>');
});

test('a task that hit its turn limit is reported as partial', () => {
  const { message } = taskNotification(record({ maxTurnsReached: 7, description: 'Long' }), 'partial work');
  expect(message.details).toMatchObject({ status: 'completed', summary: 'Agent "Long" stopped at its 7-turn limit (partial result; SendMessage to task-id to continue)' });
});

test('a withheld handback hides the unsent output and a delivered one points at the message', () => {
  const withheld = taskNotification(record({ handback: { recipient: 'parent', delivered: false, flagged: false, bounces: 3, waitingOnBackground: false } }), 'SECRET_DRAFT');
  expect(withheld.message.content).not.toContain('SECRET_DRAFT');
  expect(withheld.message.content).toContain('The subagent ended without delivering a report through SubagentHandback');
  const delivered = taskNotification(record({ agentName: 'scout', handback: { recipient: 'parent', delivered: true, flagged: false, bounces: 0, waitingOnBackground: false, report: { text: 'sent report' } } }), 'SECRET_DRAFT');
  expect(delivered.message.content).not.toContain('SECRET_DRAFT');
  expect(delivered.message.content).toContain('This agent\'s report was delivered to you as a message from "scout"');
});
