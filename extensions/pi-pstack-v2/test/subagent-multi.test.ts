import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { assistantLine, byTask, CHILD_WAIT_MS, dies, says, startedByTask, startedChildren } from './subagent-child-output.ts';
import { fakePi } from './subagent-fake-pi.ts';
import { answerOf, loadSubagent, makeCtx, textOf, type ToolResult, useWorkspace, writeAgent } from './subagent-host.ts';

const workspace = useWorkspace();
const MAX_PARALLEL_TASKS = 8;
const OVER_LIMIT_TASKS = 9;
const MAX_CONCURRENCY = 4;
const SIX_TASKS = 6;
const PARALLEL_CAP_BYTES = 51_200;
const OVER_CAP_BYTES = 60_000;

const run = (params: Record<string, unknown>, onUpdate?: (partial: ToolResult) => void) => loadSubagent().call(params, makeCtx(workspace().project), undefined, onUpdate);
const tasksFor = (...tasks: string[]) => tasks.map((task) => ({ agent: 'scout', task }));
const runningNow = () => fakePi.children().filter((child) => child.state === 'running').length;

describe('chain mode', () => {
  test('threads each step output into the next step through {previous}', async () => {
    fakePi.onChild(byTask({ first: says('one'), 'use one': says('two') }));
    const onUpdate = vi.fn<(partial: ToolResult) => void>();
    const chain = [
      { agent: 'scout', task: 'first' },
      { agent: 'worker', task: 'use {previous}' },
    ];
    const result = await run({ chain }, onUpdate);
    expect(answerOf(result)).toBe('two');
    expect(result.details?.mode).toBe('chain');
    expect(result.details?.results.map((r) => [r.agent, r.step])).toEqual([
      ['scout', 1],
      ['worker', 2],
    ]);
    expect(fakePi.children().map((child) => child.task)).toEqual(['first', 'use one']);
    const last = onUpdate.mock.calls.at(-1)?.[0];
    expect(last?.details?.results).toHaveLength(2);
  });

  test('replaces every {previous} in a step', async () => {
    fakePi.onChild(byTask({ first: says('one') }));
    await run({
      chain: [
        { agent: 'scout', task: 'first' },
        { agent: 'scout', task: '{previous}+{previous}' },
      ],
    });
    expect(fakePi.children()[1]?.task).toBe('one+one');
  });

  test('stops at the first failing step and starts nothing after it', async () => {
    fakePi.onChild(dies(1, 'bad'));
    const result = await run({ chain: tasksFor('first', 'second') });
    expect(textOf(result)).toContain('Chain stopped at step 1 (scout):');
    expect(textOf(result)).toContain('stderr: bad');
    expect(result.details?.isError).toBe(true);
    expect(fakePi.children()).toHaveLength(1);
  });

  test('reports an unknown agent as the failing step', async () => {
    const result = await run({ chain: [{ agent: 'ghost', task: 'go' }] });
    expect(textOf(result)).toContain('Chain stopped at step 1 (ghost): Error: Unknown agent: "ghost"');
  });
});

describe('chain mode, step output and settings', () => {
  test('says (no output) when the last step is silent', async () => {
    fakePi.onChild(says(''));
    expect(answerOf(await run({ chain: tasksFor('go') }))).toBe('(no output)');
  });

  test('gives each step its own model, thinking level and directory', async () => {
    fs.mkdirSync(path.join(workspace().project, 'sub'));
    await run({ chain: [{ agent: 'scout', task: 'two', model: 'x/two', thinking: 'xhigh', cwd: 'sub' }] });
    const [child] = fakePi.children();
    expect([child?.flag('--model'), child?.flag('--thinking'), child?.cwd]).toEqual(['x/two', 'xhigh', path.join(workspace().project, 'sub')]);
  });

  test('streams the finished steps together with the step that is running', async () => {
    fakePi.onChild(byTask({ first: says('one') }, (child) => child.stdout(`${assistantLine('mid')}\n`)));
    let seen: readonly number[] = [];
    const running = run({ chain: tasksFor('first', 'second') }, (partial) => {
      seen = [...seen, partial.details?.results.length ?? 0];
    });
    const [, second] = await startedChildren(2);
    await vi.waitFor(() => expect(seen.at(-1)).toBe(2), CHILD_WAIT_MS);
    second?.exit(0);
    await running;
    expect(seen).toContain(1);
  });

  test('truncates a very long step answer', async () => {
    fakePi.onChild(says('y'.repeat(OVER_CAP_BYTES * 2)));
    expect(textOf(await run({ chain: tasksFor('go') }))).toMatch(/\[Output truncated: \d+ bytes omitted/);
  });
});

describe('parallel mode', () => {
  test('summarizes successes and failures with their stop reasons', async () => {
    fakePi.onChild(byTask({ ok: says('fine'), bad: says('oops', { stopReason: 'error' }), dead: dies(1) }));
    const onUpdate = vi.fn<(partial: ToolResult) => void>();
    const result = await run({ tasks: tasksFor('ok', 'bad', 'dead') }, onUpdate);
    const text = textOf(result);
    expect(text).toContain('Parallel: 1/3 succeeded');
    expect(text).toContain('### [scout] completed\n\nfine');
    expect(text).toContain('### [scout] failed (error)');
    expect(text).toContain('### [scout] failed\n');
    expect(result.details?.mode).toBe('parallel');
    expect(result.details?.isError).toBe(true);
    const progress = onUpdate.mock.calls.map(([update]) => update.content[0]?.text ?? '');
    expect(progress.at(-1)).toBe('Parallel: 3/3 done, 0 running, 0 pending...');
    expect(progress.some((line) => /Parallel: \d\/3 done, \d running, \d pending\.\.\./.test(line))).toBe(true);
  });

  test('keeps results in the order of the tasks even when they finish out of order', async () => {
    fakePi.onChild(() => undefined);
    const running = run({ tasks: tasksFor('slow', 'quick') });
    const [slow, quick] = await startedByTask('slow', 'quick');
    quick?.stdout(`${assistantLine('quick answer')}\n`);
    quick?.exit(0);
    slow?.stdout(`${assistantLine('slow answer')}\n`);
    slow?.exit(0);
    const text = textOf(await running);
    expect(text.indexOf('slow answer')).toBeLessThan(text.indexOf('quick answer'));
  });
});

describe('parallel mode, limits', () => {
  test(`rejects more than ${MAX_PARALLEL_TASKS} tasks without starting any`, async () => {
    const result = await run({ tasks: tasksFor(...Array.from({ length: OVER_LIMIT_TASKS }, () => 't')) });
    expect(textOf(result)).toBe(`Too many parallel tasks (${OVER_LIMIT_TASKS}). Max is ${MAX_PARALLEL_TASKS}.`);
    expect(result.details?.isError).toBe(true);
    expect(fakePi.children()).toHaveLength(0);
  });

  test(`runs at most ${MAX_CONCURRENCY} children at once and starts the next as one finishes`, async () => {
    let peak = 0;
    fakePi.onChild(() => {
      peak = Math.max(peak, runningNow());
    });
    const running = run({ tasks: tasksFor(...Array.from({ length: SIX_TASKS }, (_, i) => `t${i}`)) });
    await startedChildren(MAX_CONCURRENCY);
    expect(runningNow()).toBe(MAX_CONCURRENCY);
    for (let finished = 0; finished < SIX_TASKS; finished += 1) {
      const next = await vi.waitFor(() => {
        const live = fakePi.children().find((child) => child.state === 'running');
        if (!live) throw new Error('no running child yet');
        return live;
      }, CHILD_WAIT_MS);
      next.stdout(`${assistantLine('ok')}\n`);
      next.exit(0);
    }
    expect(textOf(await running)).toContain(`Parallel: ${SIX_TASKS}/${SIX_TASKS} succeeded`);
    expect(peak).toBe(MAX_CONCURRENCY);
  });
});

describe('parallel mode, task settings and output', () => {
  test('reports an unknown agent as a failed task and still runs the others', async () => {
    const result = await run({
      tasks: [
        { agent: 'ghost', task: 't' },
        { agent: 'scout', task: 'real' },
      ],
    });
    expect(textOf(result)).toContain('Parallel: 1/2 succeeded');
    expect(textOf(result)).toContain('Unknown agent: "ghost"');
    expect(fakePi.children().map((child) => child.task)).toEqual(['real']);
  });

  test('gives each task its own model and thinking level', async () => {
    writeAgent(workspace().userAgents, 'tuned', 'model: agent/model\n');
    await run({
      tasks: [
        { agent: 'scout', task: 'a', model: 'x/one', thinking: 'minimal' },
        { agent: 'tuned', task: 'b' },
      ],
    });
    const byTaskName = Object.fromEntries(fakePi.children().map((child) => [child.task, [child.flag('--model'), child.flag('--thinking')]]));
    expect(byTaskName).toEqual({ a: ['x/one', 'minimal'], b: ['agent/model', undefined] });
  });

  test('cuts each task output at 50 KiB and says how much was omitted', async () => {
    fakePi.onChild(says('é'.repeat(OVER_CAP_BYTES)));
    const text = textOf(await run({ tasks: tasksFor('big') }));
    const [, body = ''] = text.split('### [scout] completed\n\n');
    const [kept = ''] = body.split('\n\n[Output truncated');
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(PARALLEL_CAP_BYTES);
    expect(text).toMatch(/\[Output truncated: \d+ bytes omitted\. Full output preserved in tool details\.\]\n\n<usage>/);
  });

  test('lists an error and an identical assistant message once in a failed task', async () => {
    fakePi.onChild(says('same', { stopReason: 'error', errorMessage: 'same' }));
    const text = textOf(await run({ tasks: tasksFor('x') }));
    expect(text).toContain('Error: same');
    expect(text.match(/same/g)).toHaveLength(1);
  });
});
