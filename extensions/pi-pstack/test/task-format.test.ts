import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';
import { backgroundText, bounded, foregroundText, notificationText, worktreeLine, worktreePreface } from '../src/task/format.ts';

const id = '11111111-2222-4333-8444-555555555555';

describe('Task texts (TASK-002, TASK-003, SEC-001)', () => {
  test('foreground output keeps the Cursor structure', () => {
    expect(foregroundText(id, 'DONE', '/s/x.jsonl', ['Note: n'])).toBe(
      `This is the output of the subagent:\n\nresponse:\n<response>\nDONE\n</response>\n\nAgent ID: ${id} (pass it as \`resume\` to send a follow-up after it completes)\nTranscript: /s/x.jsonl\nNote: n`,
    );
  });

  test('background launch names the agent and says not to poll', () => {
    expect(backgroundText(id, undefined)).toBe(
      `Subagent is running in the background. Its final response arrives automatically after your turn ends, so do not wait or poll for it. End your turn or work on something else.\n\nAgent ID: ${id} (pass it as \`resume\` to send a follow-up after it completes)`,
    );
  });

  test('the notification carries every Cursor field', () => {
    expect(notificationText({ status: 'error', agentId: id, title: 't', toolCallId: 'c1', detail: 'boom' }).split('\n').slice(2)).toEqual([
      '<task>',
      'kind: subagent',
      'status: error',
      `task_id: ${id}`,
      'title: t',
      'tool_call_id: c1',
      'detail: boom',
      '</task>',
    ]);
  });

  test("bounds model-facing output with Pi's own limits and points to the transcript (review r2: architecture 6)", () => {
    const lines = Array.from({ length: 3_000 }, (_, index) => `line ${index}`).join('\n');
    const text = bounded(lines, '/s/x.jsonl');
    expect(text.split('\n').slice(-2)).toEqual([`line ${DEFAULT_MAX_LINES - 1}`, '[truncated: showing 2000 of 3000 lines; the full response is in /s/x.jsonl]']);
    expect(bounded('short', undefined)).toBe('short');
  });

  test('cuts a single oversized line at the byte limit instead of dropping it', () => {
    const text = bounded('é'.repeat(40_000), '/s/x.jsonl');
    expect([Buffer.byteLength(text.split('\n[truncated')[0] ?? '', 'utf8'), text.endsWith('[truncated: showing 50.0KB of 78.1KB; the full response is in /s/x.jsonl]')]).toEqual([DEFAULT_MAX_BYTES, true]);
  });

  test('cuts on a character boundary in linear time', () => {
    const started = performance.now();
    const text = bounded('😀'.repeat(2_000_000), undefined);
    const kept = text.split('\n[truncated')[0] ?? '';
    expect([Buffer.byteLength(kept, 'utf8'), kept.endsWith('😀'), performance.now() - started < 2_000]).toEqual([51_200, true, true]);
  });
});

describe('cloud worktree texts (TASK-010)', () => {
  const worktree = { path: '/w/wt', cwd: '/w/wt/pkg', branch: `pstack/${id}`, base: 'main', commit: 'abc123' };

  test('the result line names the worktree and the branch to merge', () => {
    expect(worktreeLine(worktree)).toBe(`Worktree: /w/wt on branch pstack/${id}, from main at abc123. Merge pstack/${id} to take the subagent's commits.`);
  });

  test("the child's prompt opens with where it runs and that it must commit", () => {
    expect(worktreePreface(worktree, 'do it')).toBe(
      `You are running in an isolated git worktree at /w/wt (working directory /w/wt/pkg) on branch pstack/${id}, created from main at abc123. Uncommitted changes in the parent's checkout are not here. Commit your changes to pstack/${id} before you finish, because the parent agent merges from that branch.\n\ndo it`,
    );
  });
});
