import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { assistantLine, CHILD_WAIT_MS, startedChildren } from './subagent-child-output.ts';
import { type FakeChild, fakePi } from './subagent-fake-pi.ts';
import { loadSubagent, makeCtx, textOf, useWorkspace } from './subagent-host.ts';

const workspace = useWorkspace();
const WAKE = { agent: 'scout', task: 'look', wake: 'scout finished' };
const REPORT = 'the worker report';
const FILE_MODE = 0o600;
const MODE_BITS = 0o777;
const CLEAN_EXIT = 0;
const STATUS_KEY = 'pstack-subagent';
const TOOL_CALLS = [{ name: 'read', arguments: { path: 'a.ts' } }];

const jobIdOf = (text: string): string => /subagent job (\S+?)\./.exec(text)?.[1] ?? '';
const outputOf = (id: string): string => path.join(workspace().root, 'agent', 'pstack-v2', 'subagents', `${id}.output`);
const holdChildren = (): void => fakePi.onChild(() => undefined);
const finish = (child: FakeChild | undefined): void => {
  child?.stdout(`${assistantLine(REPORT)}\n`);
  child?.exit(CLEAN_EXIT);
};

const uiSpies = () => {
  const setStatus = vi.fn();
  const setWidget = vi.fn();
  return { setStatus, setWidget, ctx: makeCtx(workspace().project, { mode: 'tui', hasUI: true, ui: { setStatus, setWidget } }) };
};

describe('the persistent .output log of a wake job', () => {
  test('is named in the launch text and in the final wake report', async () => {
    const subagent = loadSubagent();
    const started = textOf(await subagent.call(WAKE, makeCtx(workspace().project, { mode: 'tui' })));
    const id = jobIdOf(started);
    expect(started).toContain(`Output file: ${outputOf(id)}`);
    expect(started).toContain(`Stop it with stop: "${id}".`);
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    expect(subagent.sent()[0]?.message.content).toContain(`Output file: ${outputOf(id)}`);
  });

  test('is private and holds the worker messages as JSONL once the job is done', async () => {
    const subagent = loadSubagent();
    const id = jobIdOf(textOf(await subagent.call(WAKE, makeCtx(workspace().project, { mode: 'tui' }))));
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    expect(fs.statSync(outputOf(id)).mode & MODE_BITS).toBe(FILE_MODE);
    const LogLine = z.looseObject({ type: z.string(), message: z.looseObject({ role: z.string() }).optional(), report: z.string().optional() });
    const lines = fs
      .readFileSync(outputOf(id), 'utf8')
      .trim()
      .split('\n')
      .map((line) => LogLine.parse(JSON.parse(line)));
    expect(lines[0]?.type).toBe('start');
    expect(lines.filter((line) => line.type === 'message').map((line) => line.message?.role)).toEqual(['assistant']);
    expect(lines.at(-1)?.type).toBe('final');
    expect(lines.at(-1)?.report).toContain('done');
  });
});

/** Launches a wake job whose child is held, with spies on the UI, and returns what a test needs to drive it. */
const launchHeldJob = async () => {
  holdChildren();
  const { ctx, setStatus, setWidget } = uiSpies();
  const subagent = loadSubagent();
  const id = jobIdOf(textOf(await subagent.call(WAKE, ctx)));
  return { subagent, ctx, id, setStatus, setWidget };
};

describe('live background progress in the Pi UI', () => {
  test('shows a job that just launched with its agent and zero counts', async () => {
    const { id, setStatus, setWidget } = await launchHeldJob();
    expect(setStatus).toHaveBeenLastCalledWith(STATUS_KEY, 'subagents: 1 running');
    expect(setWidget).toHaveBeenLastCalledWith(STATUS_KEY, [`${id} scout 0t 0 tools 0 tok`]);
  });

  test('updates the turns, tool calls and tokens as the worker streams', async () => {
    const { id, setWidget } = await launchHeldJob();
    const [child] = await startedChildren(1);
    child?.stdout(`${assistantLine('working', { toolCalls: TOOL_CALLS })}\n`);
    await vi.waitFor(() => expect(setWidget).toHaveBeenLastCalledWith(STATUS_KEY, [`${id} scout 1t 1 tools 2 tok`]), CHILD_WAIT_MS);
  });

  test('clears both when the job ends', async () => {
    const { setStatus, setWidget } = await launchHeldJob();
    const [child] = await startedChildren(1);
    finish(child);
    await vi.waitFor(() => expect(setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined), CHILD_WAIT_MS);
    expect(setWidget).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
  });

  test('clears both when a running job is stopped', async () => {
    const { subagent, ctx, id, setStatus, setWidget } = await launchHeldJob();
    await startedChildren(1);
    await subagent.call({ stop: id }, ctx);
    await vi.waitFor(() => expect(setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined), CHILD_WAIT_MS);
    expect(setWidget).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
  });

  test('draws nothing when the session has no UI', async () => {
    const setStatus = vi.fn();
    const ctx = makeCtx(workspace().project, { mode: 'tui', hasUI: false, ui: { setStatus } });
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx);
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    expect(setStatus).not.toHaveBeenCalled();
  });
});
