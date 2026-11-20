import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { dies, says } from './subagent-child-output.ts';
import { type FakeChild, fakePi } from './subagent-fake-pi.ts';
import { type CtxOptions, loadSubagent, makeCtx, textOf, useWorkspace } from './subagent-host.ts';

const workspace = useWorkspace();
const IS_FORK = 'PI_SUBAGENT_IS_FORK';
const FORK_DISABLED = 'PI_SUBAGENT_FORK_DISABLED';
const BOILERPLATE = '<fork-boilerplate>\nYou are a forked subagent of the parent session. Do not spawn another fork.\n</fork-boilerplate>\n\nTask: look';
const STARTED = 'Forked subagent started to handle this call.';
const PARENT_CALL = 'Handled by parent session.';
const PARENT_MODEL = { provider: 'anthropic', id: 'parent-model' };
const SESSION_VERSION = 3;
const LAST_TWO = -2;
const TIMESTAMP = '2026-01-01T00:00:00.000Z';
const PARENT_CWD = '/parent';

const LineSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  parentId: z.string().nullable().optional(),
  message: z
    .looseObject({
      role: z.string(),
      toolCallId: z.string().optional(),
      isError: z.boolean().optional(),
      content: z.union([z.string(), z.array(z.looseObject({ type: z.string(), text: z.string().optional() }))]).optional(),
    })
    .optional(),
});
type Line = z.infer<typeof LineSchema>;

const linesOf = (session: string): Line[] =>
  session
    .trim()
    .split('\n')
    .map((line) => LineSchema.parse(JSON.parse(line)));

const entry = (id: string, parentId: string | null, message: object): string => JSON.stringify({ type: 'message', id, parentId, timestamp: TIMESTAMP, message });
const header = JSON.stringify({ type: 'session', version: SESSION_VERSION, id: 'parent', timestamp: TIMESTAMP, cwd: PARENT_CWD });

/** A parent session whose last assistant message has called `subagent` (id "call") and `read` (id "sibling"), neither answered. */
function writeParentSession(...extraLines: string[]): string {
  const file = path.join(workspace().root, 'parent.jsonl');
  const calls = [
    { type: 'toolCall', id: 'call', name: 'subagent', arguments: {} },
    { type: 'toolCall', id: 'sibling', name: 'read', arguments: {} },
  ];
  const lines = [header, entry('u1', null, { role: 'user', content: 'hi', timestamp: 1 }), entry('a1', 'u1', { role: 'assistant', content: [{ type: 'text', text: 'working' }, ...calls] }), ...extraLines];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

const parentCtx = (file: string | undefined, options: CtxOptions = {}) => makeCtx(workspace().project, { model: PARENT_MODEL, thinkingLevel: 'high', ...options, sessionManager: { getSessionFile: () => file, getBranch: () => [] } });

type Seen = { child: FakeChild; sessionFile: string | undefined; session: string };

/** Scripts the fork's child to copy what it was given before it answers, since the temp session is removed on exit. */
const watchChild = (): (() => Seen | undefined) => {
  let seen: Seen | undefined;
  fakePi.onChild((child) => {
    const sessionFile = child.flag('--session');
    seen = { child, sessionFile, session: sessionFile && fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, 'utf8') : '' };
    says('forked answer')(child);
  });
  return () => seen;
};

const fork = (ctx: unknown, params: Record<string, unknown> = {}) => loadSubagent().call({ agent: 'fork', task: 'look', ...params }, ctx);

describe('a fork continues the parent session', () => {
  test('starts the child on a copy of the parent session instead of with no session', async () => {
    const seen = watchChild();
    const parentFile = writeParentSession();
    await fork(parentCtx(parentFile));
    expect(seen()?.child.args).not.toContain('--no-session');
    expect(seen()?.sessionFile).toBeDefined();
    expect(seen()?.sessionFile).not.toBe(parentFile);
    expect(seen()?.session.startsWith(fs.readFileSync(parentFile, 'utf8'))).toBe(true);
  });

  test('answers every tool call the parent left open, so the transcript is valid', async () => {
    const seen = watchChild();
    await fork(parentCtx(writeParentSession()));
    const [started, sibling] = linesOf(seen()?.session ?? '').slice(LAST_TWO);
    expect(started?.message).toMatchObject({ role: 'toolResult', toolCallId: 'call', isError: false, content: [{ type: 'text', text: STARTED }] });
    expect(sibling?.message).toMatchObject({ role: 'toolResult', toolCallId: 'sibling', isError: false, content: [{ type: 'text', text: PARENT_CALL }] });
    expect([started?.parentId, sibling?.parentId]).toEqual(['a1', started?.id]);
  });

  test('adds nothing when the parent already answered its last tool call', async () => {
    const seen = watchChild();
    const answered = entry('r1', 'a1', { role: 'toolResult', toolCallId: 'call', toolName: 'subagent', content: [], isError: false, timestamp: 1 });
    const file = writeParentSession(answered, entry('r2', 'r1', { role: 'toolResult', toolCallId: 'sibling', toolName: 'read', content: [], isError: false, timestamp: 1 }));
    await fork(parentCtx(file));
    expect(seen()?.session).toBe(fs.readFileSync(file, 'utf8'));
  });

  test('starts from a fresh session when the parent has no session file', async () => {
    const seen = watchChild();
    await fork(parentCtx(undefined));
    expect(seen()?.sessionFile).toBeDefined();
    expect(linesOf(seen()?.session ?? '')).toMatchObject([{ type: 'session' }]);
  });

  test('wraps the task in the fork boilerplate', async () => {
    const seen = watchChild();
    await fork(parentCtx(writeParentSession()));
    expect(seen()?.child.args.at(-1)).toBe(BOILERPLATE);
  });

  test('reports the fork answer like any other subagent', async () => {
    watchChild();
    expect(textOf(await fork(parentCtx(writeParentSession())))).toContain('forked answer');
  });
});

const SIBLING_RESULT = entry('r2', 'a1', { role: 'toolResult', toolCallId: 'sibling', toolName: 'read', content: [], isError: false, timestamp: 1 });
const CORRUPT_LINE = '{this is not json';
const toolResultIds = (session: string): (string | undefined)[] =>
  linesOf(session)
    .filter((line) => line.message?.role === 'toolResult')
    .map((line) => line.message?.toolCallId);
const branchOf = (message: object) => makeCtx(workspace().project, { sessionManager: { getSessionFile: () => undefined, getBranch: () => [{ type: 'message', message }] } });

describe('a fork continues an unusual parent session', () => {
  test('closes the unanswered call even when its sibling already has a result', async () => {
    const seen = watchChild();
    await fork(parentCtx(writeParentSession(SIBLING_RESULT)));
    const results = linesOf(seen()?.session ?? '').filter((line) => line.message?.role === 'toolResult');
    expect(toolResultIds(seen()?.session ?? '').toSorted((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual(['call', 'sibling']);
    expect(results.find((line) => line.message?.toolCallId === 'call')?.message).toMatchObject({ isError: false, content: [{ type: 'text', text: STARTED }] });
  });

  test('skips a corrupt line in the parent session and starts the child', async () => {
    const seen = watchChild();
    const result = await fork(parentCtx(writeParentSession(CORRUPT_LINE)));
    expect(result.details?.isError).toBe(false);
    expect(seen()?.session).toContain(STARTED);
    expect(seen()?.session).not.toContain(CORRUPT_LINE);
  });
});

describe('a fork refuses what would break it', () => {
  test('an assistant message quoting the fork boilerplate does not block the fork', async () => {
    const result = await fork(branchOf({ role: 'assistant', content: [{ type: 'text', text: `Quoting: ${BOILERPLATE}` }] }));
    expect(result.details?.isError).toBe(false);
    expect(fakePi.children()).toHaveLength(1);
  });

  test('a user message starting with the fork boilerplate blocks the fork', async () => {
    const result = await fork(branchOf({ role: 'user', content: BOILERPLATE }));
    expect(result.details?.isError).toBe(true);
    expect(fakePi.children()).toHaveLength(0);
  });

  test('refuses a fork that asks for a worktree, starting no child', async () => {
    const result = await fork(parentCtx(writeParentSession()), { isolation: 'worktree' });
    expect(result.details?.isError).toBe(true);
    expect(textOf(result)).toMatch(/fork.*worktree|worktree.*fork/i);
    expect(fakePi.children()).toHaveLength(0);
  });
});

describe('a fork shares the parent prompt prefix', () => {
  test('keeps the parent model and thinking level, whatever the call names', async () => {
    const seen = watchChild();
    await fork(parentCtx(writeParentSession()), { model: 'other/model', thinking: 'low' });
    expect(seen()?.child.flag('--model')).toBe('anthropic/parent-model');
    expect(seen()?.child.flag('--thinking')).toBe('high');
  });

  test('adds no system prompt and keeps the context files, so the prefix matches the parent', async () => {
    const seen = watchChild();
    await fork(parentCtx(writeParentSession()));
    expect(seen()?.child.args).not.toContain('--append-system-prompt');
    expect(seen()?.child.args).not.toContain('--no-context-files');
    expect(seen()?.child.args).not.toContain('--tools');
    expect(seen()?.child.args).toContain('--session');
  });

  test('marks the child as a fork for the nesting guard', async () => {
    const seen = watchChild();
    await fork(parentCtx(writeParentSession()));
    expect(seen()?.child.env[IS_FORK]).toBe('1');
  });

  test('a call that does not fork does not mark its child', async () => {
    const seen = watchChild();
    await loadSubagent().call({ agent: 'scout', task: 'look' }, parentCtx(writeParentSession()));
    expect(seen()?.child.env[IS_FORK]).toBeUndefined();
    expect(seen()?.child.args).toContain('--no-session');
  });
});

describe('a fork cleans up its session copy', () => {
  test('removes the temp session file when the child finishes', async () => {
    const seen = watchChild();
    await fork(parentCtx(writeParentSession()));
    expect(fs.existsSync(seen()?.sessionFile ?? '')).toBe(false);
  });

  test('removes the temp session file when the child fails', async () => {
    let sessionFile: string | undefined;
    fakePi.onChild((child) => {
      sessionFile = child.flag('--session');
      dies(1, 'boom')(child);
    });
    const result = await fork(parentCtx(writeParentSession()));
    expect(result.details?.isError).toBe(true);
    expect(sessionFile).toMatch(/\.jsonl$/);
    expect(fs.existsSync(sessionFile ?? '')).toBe(false);
  });
});

describe('a fork cannot fork again or run when disabled', () => {
  const refused = async (ctx: unknown) => {
    const result = await fork(ctx);
    expect(result.details?.isError).toBe(true);
    expect(fakePi.children()).toHaveLength(0);
    return textOf(result);
  };

  test('refuses inside a fork child', async () => {
    vi.stubEnv(IS_FORK, '1');
    expect(await refused(parentCtx(writeParentSession()))).toMatch(/cannot fork again/i);
  });

  test('refuses when the parent branch already holds the fork boilerplate', async () => {
    const branch = [{ type: 'message', message: { role: 'user', content: BOILERPLATE } }];
    const ctx = makeCtx(workspace().project, { sessionManager: { getSessionFile: () => undefined, getBranch: () => branch } });
    expect(await refused(ctx)).toMatch(/cannot fork again/i);
  });

  test.for(['1', 'true'])('refuses when forks are disabled with %j', async (value) => {
    vi.stubEnv(FORK_DISABLED, value);
    expect(await refused(parentCtx(writeParentSession()))).toMatch(/disabled/i);
  });

  test.for([
    [IS_FORK, 'inside a fork child'],
    [FORK_DISABLED, 'when forks are disabled'],
  ] as const)('still starts ordinary agents %#: %s is set', async ([variable]) => {
    vi.stubEnv(variable, '1');
    const result = await loadSubagent().call({ agent: 'scout', task: 'look' }, parentCtx(writeParentSession()));
    expect(result.details?.isError).toBe(false);
  });

  test('forks when the disable switch is off', async () => {
    vi.stubEnv(FORK_DISABLED, '0');
    const result = await fork(parentCtx(writeParentSession()));
    expect(result.details?.isError).toBe(false);
  });
});
