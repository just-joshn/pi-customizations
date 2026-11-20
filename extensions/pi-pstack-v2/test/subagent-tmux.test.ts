import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { assistantLine, CHILD_WAIT_MS, startedChildren } from './subagent-child-output.ts';
import { fakePi } from './subagent-fake-pi.ts';
import { answerOf, loadSubagent, makeCtx, textOf, type ToolResult, useWorkspace } from './subagent-host.ts';

const workspace = useWorkspace();
const FAILED_EXIT = 2;
const USER_TMUX = `${os.tmpdir()}/user-tmux,1,0`;
const PANE = '%1';
const RUN_DIR_PREFIX = 'pi-subagent-tmux-';

type CallOptions = { task?: string; signal?: AbortSignal; onUpdate?: (partial: ToolResult) => void };
const callScout = ({ task = 'look', signal, onUpdate }: CallOptions = {}) => loadSubagent().call({ agent: 'scout', task }, makeCtx(workspace().project), signal, onUpdate);
/** The folders tmux runs left in the temp dir, which this test owns. */
const runDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(RUN_DIR_PREFIX));

describe('the tmux session a subagent runs in', () => {
  test('runs the child in the task directory, with a run directory that lasts only while it runs', async () => {
    fakePi.onChild(() => undefined);
    const running = callScout();
    const [child] = await startedChildren(1);
    expect(child?.cwd).toBe(workspace().project);
    expect(runDirs()).toHaveLength(1);
    child?.exit(0);
    await running;
    expect(runDirs()).toEqual([]);
  });

  test('gives every run its own tmux server, so stopping one run leaves another running', async () => {
    fakePi.onChild(() => undefined);
    const controller = new AbortController();
    const stopped = callScout({ task: 'stopped', signal: controller.signal });
    const kept = callScout({ task: 'kept' });
    const children = await startedChildren(2);
    const [stoppedChild, keptChild] = ['stopped', 'kept'].map((task) => children.find((child) => child.task === task));
    controller.abort();
    await vi.waitFor(() => expect(stoppedChild?.state).toBe('gone'), CHILD_WAIT_MS);
    keptChild?.stdout(`${assistantLine('still here')}\n`);
    keptChild?.exit(0);
    expect(answerOf(await kept)).toBe('still here');
    expect(textOf(await stopped)).toContain('aborted');
  });

  test("hands the child the dispatching Pi's environment and hides the user's tmux", async () => {
    vi.stubEnv('PI_SUBAGENT_TEST_VAR', 'from-parent');
    vi.stubEnv('TMUX', USER_TMUX);
    vi.stubEnv('TMUX_PANE', PANE);
    await callScout();
    const env: NodeJS.ProcessEnv = fakePi.children()[0]?.env ?? {};
    expect(env['PI_SUBAGENT_TEST_VAR']).toBe('from-parent');
    expect(env['PI_CODING_AGENT_DIR']).toBe(path.join(workspace().root, 'agent'));
    expect(env).not.toHaveProperty('TMUX');
    expect(env).not.toHaveProperty('TMUX_PANE');
  });
});

describe('the tmux session a subagent runs in, cleanup and streaming', () => {
  test('removes the run directory when tmux cannot start', async () => {
    fakePi.failToStart();
    expect(textOf(await callScout())).toContain('Failed to spawn subagent');
    expect(runDirs()).toEqual([]);
  });

  test('streams output to the caller while the child is still running', async () => {
    fakePi.onChild(() => undefined);
    let seen: readonly string[] = [];
    const running = callScout({
      onUpdate: (partial) => {
        seen = [...seen, partial.content[0]?.text ?? ''];
      },
    });
    const [child] = await startedChildren(1);
    child?.stdout(`${assistantLine('partway')}\n`);
    child?.stderr('warming up');
    await vi.waitFor(() => expect(seen).toContain('partway'), CHILD_WAIT_MS);
    expect(child?.state).toBe('running');
    child?.exit(0);
    expect(answerOf(await running)).toBe('partway');
  });

  test('keeps the child stderr in the result when the child stays silent otherwise', async () => {
    fakePi.onChild((child) => {
      child.stderr('first ');
      child.stderr('second');
      child.exit(FAILED_EXIT);
    });
    expect(textOf(await callScout())).toContain('stderr: first second');
  });
});
