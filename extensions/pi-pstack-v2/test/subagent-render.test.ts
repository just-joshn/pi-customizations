import type { Message } from '@earendil-works/pi-ai';
import type { Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { renderSubagentCall } from '../src/subagent/render-call.ts';
import { renderSubagentResult } from '../src/subagent/render-result.ts';
import { createUnstartedResult, emptyUsage } from '../src/subagent/results.ts';
import type { SingleResult, SubagentDetails, SubagentMode } from '../src/subagent/types.ts';

const theme = { fg: (color: string, value: string) => `<${color}:${value}>`, bold: (value: string) => `*${value}*` } as unknown as Theme;
const READ_TARGET = '/x';
const WIDTH = 400;
const ESCAPE_CODE = 27;
const ESC = String.fromCharCode(ESCAPE_CODE);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const MANY_ITEMS = 12;
const PREVIEW_CHARS = 40;
const SINGLE_CHARS = 60;
const COST = 0.5;

const show = (component: Component): string =>
  component
    .render(WIDTH)
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(ANSI, '');
const assistant = (...content: object[]): Message => ({ role: 'assistant', content }) as unknown as Message;
const said = (value: string): Message => assistant({ type: 'text', text: value });
const call = (name: string, args: Record<string, unknown>) => ({ type: 'toolCall', id: name, name, arguments: args });
const result = (overrides: Partial<SingleResult> = {}): SingleResult => ({
  agent: 'scout',
  agentSource: 'user',
  task: 'find things',
  status: 'completed',
  exitCode: 0,
  messages: [],
  stderr: '',
  usage: emptyUsage(),
  ...overrides,
});
const render = (mode: SubagentMode, results: SingleResult[], expanded: boolean): string =>
  show(renderSubagentResult({ content: [{ type: 'text', text: 'fallback' }], details: { mode, results, isError: false } satisfies SubagentDetails }, expanded, theme));

describe('renderSubagentResult fallbacks', () => {
  test('uses the first text content when details are missing or empty', () => {
    expect(show(renderSubagentResult({ content: [{ type: 'text', text: 'plain' }], details: undefined }, false, theme))).toBe('plain');
    expect(render('single', [], false)).toBe('fallback');
  });

  test('uses (no output) when the first content is not text', () => {
    const image = { content: [{ type: 'image', data: '', mimeType: 'image/png' }], details: undefined } as never;
    expect(show(renderSubagentResult(image, false, theme))).toBe('(no output)');
    expect(show(renderSubagentResult({ content: [], details: undefined }, false, theme))).toBe('(no output)');
  });

  test('single mode with several results falls back to text', () => {
    expect(render('single', [result(), result()], false)).toBe('fallback');
  });
});

describe('single mode', () => {
  const usage = { ...emptyUsage(), turns: 1, input: 5, cost: COST };

  test('collapsed completed result shows tool calls, text and usage', () => {
    const messages = [assistant(call('bash', { command: 'ls' }), { type: 'text', text: 'l1\nl2\nl3\nl4' })];
    const out = render('single', [result({ messages, usage, model: 'm1' })], false);
    expect(out).toContain('<success:✓> <toolTitle:*scout*><muted: (user)>');
    expect(out).toContain('→ ');
    expect(out).toContain('l3');
    expect(out).not.toContain('l4');
    expect(out).toContain('1 turn ↑5 $0.5000 m1');
  });

  test('collapsed result truncates long item lists with an expand hint', () => {
    const messages = Array.from({ length: MANY_ITEMS }, (_, i) => said(`item-${i}`));
    const out = render('single', [result({ messages })], false);
    expect(out).toContain('... 2 earlier items');
    expect(out).toContain('(Ctrl+O to expand)');
    expect(out).not.toContain('item-1\n');
  });

  test('collapsed without output, active and failed headers', () => {
    expect(render('single', [result()], false)).toContain('(no output)');
    expect(render('single', [result({ status: 'running' })], false)).toContain('<warning:[running]>');
    const failed = render('single', [result({ status: 'failed', stopReason: 'error', errorMessage: 'boom' })], false);
    expect(failed).toContain('<error:[error]>');
    expect(failed).toContain('Error: boom');
    expect(render('single', [result({ status: 'aborted' })], false)).toContain('<error:[aborted]>');
  });

  test('expanded shows task, diagnostics, tool calls, markdown output and usage', () => {
    const messages = [assistant(call('read', { path: READ_TARGET }), { type: 'text', text: 'final answer' })];
    const failed = result({ messages, usage, status: 'failed', errorMessage: 'boom', terminationSignal: 'SIGTERM', stderr: ' bad \n' });
    const out = render('single', [failed], true);
    for (const piece of ['Error: boom', 'Signal: SIGTERM', 'stderr: bad', '─── Task ───', 'find things', '─── Output ───', 'read ', 'final answer', '1 turn']) expect(out).toContain(piece);
  });

  test('expanded without output or usage shows placeholder', () => {
    const out = render('single', [result()], true);
    expect(out).toContain('(no output)');
    expect(out).not.toContain('turn');
  });
});

describe('chain mode', () => {
  const steps = [result({ step: 1, messages: [said('one')], usage: { ...emptyUsage(), turns: 1 } }), result({ step: 2, agent: 'writer', status: 'failed', errorMessage: 'nope' }), result({ step: 3, agent: 'idle' })];

  test('collapsed shows step headings, summaries, total and hint', () => {
    const out = render('chain', steps, false);
    expect(out).toContain('<error:✗> <toolTitle:*chain *><accent:2/3 steps>');
    expect(out).toContain('<muted:─── Step 1: ><accent:scout>');
    expect(out).toContain('nope');
    expect(out).toContain('(no output)');
    expect(out).toContain('Total: 1 turn');
    expect(out).toContain('(Ctrl+O to expand)');
  });

  test('icons reflect active, success and failure states', () => {
    expect(render('chain', [result({ step: 1, status: 'pending' })], false)).toContain('<warning:⏳> <toolTitle');
    expect(render('chain', [result({ step: 1 })], false)).toContain('<success:✓> <toolTitle');
  });

  test('expanded lists each step with task, output and total', () => {
    const out = render('chain', [{ ...(steps[0] as SingleResult), messages: [assistant(call('ls', {}), { type: 'text', text: 'done' })] }, steps[1] as SingleResult], true);
    for (const piece of ['Task: ', 'find things', 'done', 'Error: nope', 'Total: 1 turn']) expect(out).toContain(piece);
  });
});

describe('parallel mode', () => {
  test('running tasks show progress and pending/running placeholders', () => {
    const out = render('parallel', [result({ status: 'running' }), result({ status: 'pending' }), result(), result({ status: 'failed', errorMessage: 'x' })], false);
    expect(out).toContain('2/4 done, 1 running, 1 pending');
    expect(out).toContain('(running...)');
    expect(out).toContain('(pending...)');
    expect(out).toContain('<warning:⏳> <toolTitle:*parallel *>');
    expect(out).toContain('(Ctrl+O to expand)');
    expect(out).not.toContain('Total:');
  });

  test('running tasks stay compact even when expanded', () => {
    const out = render('parallel', [result({ status: 'running', messages: [said('a\nb\nc\nd')] })], true);
    expect(out).toContain('d');
    expect(out).not.toContain('Task: ');
    expect(out).not.toContain('(Ctrl+O');
  });

  test('finished runs report completion, partial failure and total', () => {
    const usage = { ...emptyUsage(), turns: 2 };
    const ok = render('parallel', [result({ usage, messages: [said('hi')] }), result()], false);
    expect(ok).toContain('<success:✓> <toolTitle:*parallel *><accent:2/2 tasks>');
    expect(ok).toContain('Total: 2 turns');
    const partial = render('parallel', [result(), result({ status: 'failed', stderr: 'bad' })], false);
    expect(partial).toContain('<warning:◐>');
    expect(partial).toContain('bad');
  });

  test('finished expanded run renders the full group', () => {
    const out = render('parallel', [result({ messages: [said('full text\nline2\nline3\nline4')], usage: { ...emptyUsage(), turns: 1 }, model: 'm' })], true);
    for (const piece of ['Task: ', 'full text', 'line4', 'Total: 1 turn']) expect(out).toContain(piece);
  });

  test('unstarted results render as failed or pending', () => {
    const out = render('parallel', [createUnstartedResult('a', 't', undefined, 'aborted', 'cancelled')], false);
    expect(out).toContain('cancelled');
  });
});

describe('renderSubagentCall', () => {
  const item = (agent: string, task: string) => ({ agent, task });

  test('single call shows agent, scope and clipped task', () => {
    const task = 'z'.repeat(SINGLE_CHARS + 1);
    const out = show(renderSubagentCall({ agent: 'scout', task, agentScope: 'project' } as never, theme));
    expect(out).toContain('subagent');
    expect(out).toContain('scout');
    expect(out).toContain('[project]');
    expect(out).toContain(`${'z'.repeat(SINGLE_CHARS)}...`);
  });

  test('single call without agent or task uses placeholders and the user scope', () => {
    const out = show(renderSubagentCall({} as never, theme));
    expect(out).toContain('...');
    expect(out).toContain('[user]');
  });

  test('chain call strips {previous}, clips and summarizes the overflow', () => {
    const chain = [item('a', 'x {previous}'), item('b', 'y'.repeat(PREVIEW_CHARS + 1)), item('c', 'c'), item('d', 'd')];
    const out = show(renderSubagentCall({ chain, agentScope: 'both' } as never, theme));
    expect(out).toContain('chain (4 steps)');
    expect(out).toContain('<muted:1.> <accent:a><dim: x>');
    expect(out).not.toContain('{previous}');
    expect(out).toContain(`${'y'.repeat(PREVIEW_CHARS)}...`);
    expect(out).toContain('... +1 more');
    expect(out).not.toContain(' d');
  });

  test('parallel call lists up to three tasks without an overflow line when small', () => {
    const out = show(renderSubagentCall({ tasks: [item('a', 'one'), item('b', 'two')] } as never, theme));
    expect(out).toContain('parallel (2 tasks)');
    expect(out).toContain('<accent:a><dim: one>');
    expect(out).not.toContain('more');
  });

  test('empty chain and tasks arrays fall through to the single form', () => {
    expect(show(renderSubagentCall({ chain: [], tasks: [], agent: 'solo', task: 'go' } as never, theme))).toContain('solo');
  });
});
