import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { assistantLine, startedChildren } from './subagent-child-output.ts';
import { fakeTmux } from './subagent-fake-tmux.ts';
import { loadSubagent, makeCtx, type ToolResult, textOf, useWorkspace } from './subagent-host.ts';

vi.mock('node:child_process', () => import('./subagent-fake-tmux.ts'));

const workspace = useWorkspace();
const RUN_VALUES = 4;
const FAILED_EXIT = 2;
const SOCKET_ARGS = 4;
const USER_TMUX = '/tmp/user-tmux,1,0';
const PANE = '%1';

const callScout = (signal?: AbortSignal, onUpdate?: (partial: ToolResult) => void) => loadSubagent().call({ agent: 'scout', task: 'look' }, makeCtx(workspace().project), signal, onUpdate);
const newSession = () => fakeTmux.calls().find((call) => call.argv.includes('new-session'));

describe('the tmux session a subagent runs in', () => {
  test('starts a detached session in the task directory, on a socket of its own', async () => {
    await callScout();
    const call = newSession();
    expect(call?.command).toBe('tmux');
    expect(call?.argv.slice(0, SOCKET_ARGS)).toEqual(['-S', 'tmux.sock', 'new-session', '-d']);
    expect(call?.argv[call.argv.indexOf('-s') + 1]).toMatch(/^pi-subagent-\d+-/);
    expect(call?.argv[call.argv.indexOf('-c') + 1]).toBe(workspace().project);
    expect(path.dirname(call?.cwd ?? '')).toBe(os.tmpdir());
    expect(path.basename(call?.cwd ?? '')).toMatch(/^pi-subagent-tmux-/);
  });

  test('gives every run its own tmux server and session', async () => {
    await callScout();
    await callScout();
    const sessions = fakeTmux.calls().flatMap((call) => (call.argv.includes('new-session') ? [call.argv[call.argv.indexOf('-s') + 1], call.cwd] : []));
    expect(new Set(sessions)).toHaveProperty('size', RUN_VALUES);
  });

  test("hands the child the dispatching Pi's environment and hides the user's tmux", async () => {
    vi.stubEnv('PI_SUBAGENT_TEST_VAR', 'from-parent');
    vi.stubEnv('TMUX', USER_TMUX);
    vi.stubEnv('TMUX_PANE', PANE);
    await callScout();
    const env: NodeJS.ProcessEnv = newSession()?.env ?? {};
    expect(env['PI_SUBAGENT_TEST_VAR']).toBe('from-parent');
    expect(env['PI_CODING_AGENT_DIR']).toBe(path.join(workspace().root, 'agent'));
    expect(env).not.toHaveProperty('TMUX');
    expect(env).not.toHaveProperty('TMUX_PANE');
  });
});

describe('the tmux session a subagent runs in, cleanup and streaming', () => {
  test('stops the tmux server and removes the run directory when the child finishes', async () => {
    await callScout();
    const runDir = newSession()?.cwd ?? '';
    expect(fakeTmux.calls().some((call) => call.cwd === runDir && call.argv.includes('kill-server'))).toBe(true);
    expect(fs.existsSync(runDir)).toBe(false);
  });

  test('removes the run directory when tmux cannot start', async () => {
    fakeTmux.failToStart(new Error('no tmux'));
    await callScout();
    expect(fs.existsSync(newSession()?.cwd ?? '')).toBe(false);
  });

  test('streams output to the caller while the child is still running', async () => {
    fakeTmux.onChild(() => undefined);
    let seen: readonly string[] = [];
    const running = callScout(undefined, (partial) => {
      seen = [...seen, partial.content[0]?.text ?? ''];
    });
    const [child] = await startedChildren(1);
    child?.stdout(`${assistantLine('partway')}\n`);
    child?.stderr('warming up');
    await vi.waitFor(() => expect(seen).toContain('partway'));
    expect(child?.state).toBe('running');
    child?.exit(0);
    expect(textOf(await running)).toBe('partway');
  });

  test('keeps the child stderr in the result when the child stays silent otherwise', async () => {
    fakeTmux.onChild((child) => {
      child.stderr('first ');
      child.stderr('second');
      child.exit(FAILED_EXIT);
    });
    expect(textOf(await callScout())).toContain('stderr: first second');
  });
});
