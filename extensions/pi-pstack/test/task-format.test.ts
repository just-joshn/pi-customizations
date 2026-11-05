import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';
import { backgroundText, bounded, foregroundText, notificationText, notificationTitle, worktreeLine, worktreePreface } from '../src/task/format.ts';
import { cursorAgents } from './cursor-reference.ts';

const id = '11111111-2222-4333-8444-555555555555';

describe('Task texts (TASK-002, TASK-003, SEC-001)', () => {
  test.for(cursorAgents.taskResults.cases.map((entry) => [entry.name, entry] as const))('%s is the text Cursor desktop renders', ([, entry]) => {
    const text = entry.background ? backgroundText(entry.agentId, entry.transcript) : foregroundText(entry.agentId, entry.response ?? '', '/s/x.jsonl', entry.suffix === undefined ? [] : [entry.suffix]);
    expect(text).toBe(entry.text);
  });

  test('a background launch without a transcript path uses the shorter Cursor text', () => {
    expect(backgroundText(id, undefined)).toBe(
      `Subagent is running in the background. When you end your turn, you will be automatically sent the subagent's final response upon its completion, so do not wait for it - either end your turn or work on something else.\n\nAgent ID: ${id} (can be used with the \`resume\` parameter to send a follow-up after it completes)`,
    );
  });

  test('the completion notification is the Cursor system notification and follow-up request', () => {
    expect(notificationText({ status: 'error', agentId: id, title: 't', toolCallId: 'c1', detail: 'boom' })).toBe(
      [
        '<system_notification>',
        'The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.',
        '',
        '<task>',
        'kind: subagent',
        'status: error',
        `task_id: ${id}`,
        'title: t',
        'tool_call_id: c1',
        'detail: boom',
        '</task>',
        '</system_notification>',
        "Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required. If you mention an agent or subagent in your response, link it with the `[Name](id)` Don't use generic label such as `[agent]`, `[worker]`, or `[subagent]`. Don't repeat the same confirmation every time.",
      ].join('\n'),
    );
  });

  test.for([
    { prompt: 'Reply with the single word PONG and nothing else. Do not use any tools. This sentence pads it.', title: 'Reply with the single word PONG and nothing else. Do not use any tools. This sen' },
    { prompt: 'Hi.\nReply with the single word ECHO.\nDo not use tools.', title: 'Hi.' },
    { prompt: '\n\n  Audit the skills.  \nThen report.', title: 'Audit the skills.' },
  ])('the notification title is the first line of the prompt, cut at 80 characters ($title)', ({ prompt, title }) => {
    expect(notificationTitle(prompt)).toBe(title);
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
