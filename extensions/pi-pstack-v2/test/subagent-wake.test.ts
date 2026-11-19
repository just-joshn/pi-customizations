import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import subagentExtension from '../src/subagent/index.ts';
import { type ProcessOutcome, runPiInTmux } from '../src/subagent/run-in-tmux.ts';

vi.mock('../src/subagent/run-in-tmux.ts', () => ({ runPiInTmux: vi.fn() }));

type TmuxOptions = Parameters<typeof runPiInTmux>[0];
type ToolResult = { content: { type: string; text: string }[] };
type Tool = { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<ToolResult> };
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Sent = { message: { customType: string; content: string; display: boolean }; options: unknown };
type Settled = { entries: { type: string; customType: string; content: string }[]; continue: boolean } | undefined;

const REPORT = 'the worker report';
const ABORTED: ProcessOutcome = { code: null, signal: 'SIGTERM' };
const OK: ProcessOutcome = { code: 0, signal: null };

const reportLine = JSON.stringify({
  type: 'message_end',
  message: { role: 'assistant', content: [{ type: 'text', text: REPORT }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { total: 1 } }, model: 'm' },
});

let project = '';
let release: () => void = () => undefined;

/** A worker that runs until the test releases it, or until its signal aborts. */
const heldWorker = (options: TmuxOptions): Promise<ProcessOutcome> =>
  new Promise((done) => {
    options.signal?.addEventListener('abort', () => done(ABORTED));
    release = () => {
      options.onStdoutChunk(`${reportLine}\n`);
      done(OK);
    };
  });

function load() {
  let tool: Tool | undefined;
  let handlers: Record<string, Handler> = {};
  let sent: Sent[] = [];
  const api = {
    on: (event: string, handler: Handler) => {
      handlers = { ...handlers, [event]: handler };
    },
    registerTool: (registered: Tool) => {
      tool = registered;
    },
    sendMessage: (message: Sent['message'], options: unknown) => {
      sent = [...sent, { message, options }];
    },
  };
  subagentExtension(api as unknown as ExtensionAPI);
  const execute = (params: unknown, ctx: unknown) => (tool as Tool).execute('id', params, undefined, undefined, ctx);
  return { execute, handlers, sent: () => sent };
}

const ctxFor = (mode: string) => ({ cwd: project, hasUI: false, mode, model: undefined, thinkingLevel: undefined, isProjectTrusted: () => true });
const textOf = (result: ToolResult): string => result.content[0]?.text ?? '';
const jobIdOf = (text: string): string => /subagent job (\S+?)\./.exec(text)?.[1] ?? '';
const workerStarted = () => vi.waitFor(() => expect(runPiInTmux).toHaveBeenCalled());

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-wake-')));
  project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'));
  vi.mocked(runPiInTmux).mockReset();
  vi.mocked(runPiInTmux).mockImplementation(heldWorker);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test('a call with wake returns a job id at once, then wakes the session with the message and the report', async () => {
  const { execute, sent } = load();
  const started = textOf(await execute({ agent: 'scout', task: 'look', wake: 'scout finished' }, ctxFor('tui')));
  const id = jobIdOf(started);
  expect(id).not.toBe('');
  expect(started).toContain(`Started subagent job ${id}.`);
  expect(sent()).toEqual([]);
  await workerStarted();
  release();
  await vi.waitFor(() => expect(sent()).toHaveLength(1));
  const [woken] = sent();
  expect(woken?.message.customType).toBe('pstack-subagent');
  expect(woken?.message.content).toContain('scout finished');
  expect(woken?.message.content).toContain(id);
  expect(woken?.message.content).toContain(REPORT);
  expect(woken?.options).toEqual({ triggerTurn: true, deliverAs: 'steer' });
});

test('stop aborts a running wake job, which still wakes the session to say so', async () => {
  const { execute, sent } = load();
  const id = jobIdOf(textOf(await execute({ agent: 'scout', task: 'look', wake: 'scout finished' }, ctxFor('tui'))));
  await workerStarted();
  expect(textOf(await execute({ stop: id }, ctxFor('tui')))).toBe(`Stopped subagent job ${id}.`);
  await vi.waitFor(() => expect(sent()).toHaveLength(1));
  expect(sent()[0]?.message.content).toMatch(/aborted/i);
  expect(textOf(await execute({ stop: id }, ctxFor('tui')))).toBe(`No running subagent job ${id}.`);
});

test('a print-mode Pi waits for its wake jobs before it settles and continues with their reports', async () => {
  const { execute, handlers, sent } = load();
  const ctx = ctxFor('print');
  const id = jobIdOf(textOf(await execute({ agent: 'scout', task: 'look', wake: 'scout finished' }, ctx)));
  const settling = handlers['agent_before_settle']?.({ entries: [] }, ctx) as Promise<Settled>;
  await workerStarted();
  release();
  const settled = await settling;
  expect(settled?.continue).toBe(true);
  expect(settled?.entries).toHaveLength(1);
  expect(settled?.entries[0]?.customType).toBe('pstack-subagent');
  expect(settled?.entries[0]?.content).toContain(id);
  expect(settled?.entries[0]?.content).toContain(REPORT);
  expect(sent()).toEqual([]);
  expect(await handlers['agent_before_settle']?.({ entries: [] }, ctx)).toBeUndefined();
});

test('session shutdown aborts every running wake job', async () => {
  const { execute, handlers } = load();
  await execute({ agent: 'scout', task: 'look', wake: 'scout finished' }, ctxFor('tui'));
  await workerStarted();
  const outcome = vi.mocked(runPiInTmux).mock.results[0]?.value as Promise<ProcessOutcome>;
  await handlers['session_shutdown']?.({}, ctxFor('tui'));
  expect(await outcome).toEqual(ABORTED);
});
