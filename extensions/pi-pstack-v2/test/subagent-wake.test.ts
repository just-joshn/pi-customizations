import { describe, expect, test, vi } from 'vitest';
import { assistantLine, CHILD_WAIT_MS, startedChildren } from './subagent-child-output.ts';
import { type FakeChild, fakePi } from './subagent-fake-pi.ts';
import { loadSubagent, makeCtx, SUBAGENT_BANNER, settledFrom, textOf, useWorkspace } from './subagent-host.ts';

const workspace = useWorkspace();
const REPORT = 'the worker report';
const REPORT_USAGE = '<usage>turns=1 input=1 output=1 cache_read=0 cache_write=0 cost=1.0000</usage>';
const framed = (report: string): string => `${SUBAGENT_BANNER}\n\n${report}\n\n${REPORT_USAGE}`;
const WAKE = { agent: 'scout', task: 'look', wake: 'scout finished' };

const jobIdOf = (text: string): string => /subagent job (\S+?)\./.exec(text)?.[1] ?? '';
const finish = (child: FakeChild | undefined): void => {
  child?.stdout(`${assistantLine(REPORT)}\n`);
  child?.exit(0);
};
const holdChildren = (): void => fakePi.onChild(() => undefined);
const ctx = (mode: string) => makeCtx(workspace().project, { mode });

describe('a call with wake in an interactive session', () => {
  test.for(['tui', 'rpc'])('returns a job id at once, then wakes the %s session with the message and the report', async (mode) => {
    holdChildren();
    const subagent = loadSubagent();
    const started = textOf(await subagent.call(WAKE, ctx(mode)));
    const id = jobIdOf(started);
    expect(id).toMatch(/^subagent-[0-9a-f]{6}$/);
    expect(started).toContain(`Started subagent job ${id}.`);
    expect(started).toContain(`Stop it with stop: "${id}".`);
    expect(subagent.sent()).toEqual([]);
    const [child] = await startedChildren(1);
    finish(child);
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    const [woken] = subagent.sent();
    expect(woken?.message).toMatchObject({ customType: 'pstack-subagent', display: true });
    expect(woken?.message.content).toBe(`scout finished\n\nsubagent job ${id} finished.\n\n${framed(REPORT)}`);
    expect(woken?.options).toEqual({ triggerTurn: true, deliverAs: 'steer' });
  });

  test('stop aborts a running job, which still wakes the session to say so', async () => {
    holdChildren();
    const subagent = loadSubagent();
    const id = jobIdOf(textOf(await subagent.call(WAKE, ctx('tui'))));
    await startedChildren(1);
    expect(textOf(await subagent.call({ stop: id }, ctx('tui')))).toBe(`Stopped subagent job ${id}.`);
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    expect(subagent.sent()[0]?.message.content).toMatch(/aborted/i);
    expect(textOf(await subagent.call({ stop: id }, ctx('tui')))).toBe(`No running subagent job ${id}.`);
  });

  test('stop says so when no such job is running', async () => {
    expect(textOf(await loadSubagent().call({ stop: 'subagent-000000' }, ctx('tui')))).toBe('No running subagent job subagent-000000.');
  });
});

describe('a call with wake, when the job ends oddly', () => {
  test('a job whose workers crash wakes the session with the failure', async () => {
    fakePi.onChild((child) => {
      child.stdout(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [] } }));
      child.exit(0);
    });
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('tui'));
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    expect(subagent.sent()[0]?.message.content).toMatch(/subagent job \S+ finished\.\n\nSubagent report [^\n]*\n\nFailed: /);
  });

  test('a job that prints nothing wakes the session with (no output)', async () => {
    fakePi.onChild((child) => child.exit(0));
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('tui'));
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    expect(subagent.sent()[0]?.message.content).toContain('(no output)');
  });

  test('session shutdown aborts every running job', async () => {
    holdChildren();
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('tui'));
    const [child] = await startedChildren(1);
    await subagent.fire('session_shutdown', {}, ctx('tui'));
    await vi.waitFor(() => expect(child?.state).toBe('gone'), CHILD_WAIT_MS);
  });
});

describe('a call with wake in a print-mode Pi', () => {
  const settle = async (subagent: ReturnType<typeof loadSubagent>) => settledFrom(await subagent.fire('agent_before_settle', { entries: [] }, ctx('print')));

  test('waits for its jobs before it settles, then continues with their reports', async () => {
    holdChildren();
    const subagent = loadSubagent();
    const id = jobIdOf(textOf(await subagent.call(WAKE, ctx('print'))));
    const settling = settle(subagent);
    finish((await startedChildren(1))[0]);
    const settled = await settling;
    expect(settled?.continue).toBe(true);
    expect(settled?.entries).toEqual([{ type: 'custom_message', customType: 'pstack-subagent', content: `scout finished\n\nsubagent job ${id} finished.\n\n${framed(REPORT)}`, display: true }]);
    expect(subagent.sent()).toEqual([]);
    expect(await settle(subagent)).toBeUndefined();
  });

  test('keeps the entries it was given and adds the reports after them', async () => {
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('print'));
    const earlier = { type: 'custom_message', customType: 'other', content: 'x', display: true };
    const settled = settledFrom(await subagent.fire('agent_before_settle', { entries: [earlier] }, ctx('print')));
    expect(settled?.entries.map((entry) => entry.customType)).toEqual(['other', 'pstack-subagent']);
  });

  test('settles at once when it has no jobs', async () => {
    expect(await settle(loadSubagent())).toBeUndefined();
  });

  test('does not hold an interactive session back when it settles', async () => {
    holdChildren();
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('tui'));
    expect(await subagent.fire('agent_before_settle', { entries: [] }, ctx('tui'))).toBeUndefined();
    await subagent.fire('session_shutdown', {}, ctx('tui'));
  });
});
