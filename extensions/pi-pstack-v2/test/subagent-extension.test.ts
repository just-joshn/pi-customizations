import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { beforeEach, expect, test, vi } from 'vitest';
import { runChain } from '../src/subagent/dispatch-chain.ts';
import { runParallel } from '../src/subagent/dispatch-parallel.ts';
import subagentExtension from '../src/subagent/index.ts';
import { createUnstartedResult, makeDetails } from '../src/subagent/results.ts';
import { runPiInTmux } from '../src/subagent/run-in-tmux.ts';
import { runSingleAgent } from '../src/subagent/run-single.ts';

vi.mock('../src/subagent/run-in-tmux.ts', () => ({ runPiInTmux: vi.fn() }));
vi.mock('../src/subagent/run-single.ts', () => ({ runSingleAgent: vi.fn() }));

type Tool = {
  name: string;
  description: string;
  execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: { type: string; text: string }[] }>;
  renderCall: (args: unknown, theme: unknown) => unknown;
  renderResult: (result: unknown, options: { expanded: boolean }, theme: unknown) => unknown;
};
type ResultHook = (event: { toolName: string; details?: unknown }) => unknown;

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

let tool: Tool | undefined;
let hook: ResultHook | undefined;

beforeEach(() => {
  vi.mocked(runPiInTmux).mockReset();
  const api = {
    on: (event: string, handler: ResultHook) => {
      hook = event === 'tool_result' ? handler : hook;
    },
    registerTool: (registered: Tool) => {
      tool = registered;
    },
  };
  subagentExtension(api as unknown as ExtensionAPI);
});

test('registers a subagent tool that describes its modes', () => {
  expect(tool?.name).toBe('subagent');
  expect(tool?.description).toContain('single (agent + task), parallel (tasks array), chain');
  expect(tool?.description).toContain('agentScope: "both"');
});

test('tool_result hook marks subagent error details as errors', () => {
  expect(hook?.({ toolName: 'subagent', details: { isError: true } })).toEqual({ isError: true });
});

test('tool_result hook leaves other results alone', () => {
  expect(hook?.({ toolName: 'bash', details: { isError: true } })).toBeUndefined();
  expect(hook?.({ toolName: 'subagent', details: { isError: false } })).toBeUndefined();
  expect(hook?.({ toolName: 'subagent' })).toBeUndefined();
});

test('execute validates params and dispatches without touching tmux for invalid calls', async () => {
  const ctx = { cwd: process.cwd(), hasUI: false };
  const result = await tool?.execute('id', {}, undefined, undefined, ctx);
  expect(result?.content[0]?.text).toContain('Invalid parameters');
  expect(runPiInTmux).not.toHaveBeenCalled();
});

test('execute rejects params of the wrong shape', () => {
  expect(() => tool?.execute('id', { agent: 5 }, undefined, undefined, { cwd: process.cwd() })).toThrow();
});

test('renderCall and renderResult delegate to the subagent renderers', () => {
  const call = tool?.renderCall({ agent: 'scout', task: 'look around' }, theme);
  expect(call).toBeDefined();
  const result = { content: [{ type: 'text', text: 'hi' }], details: { mode: 'single', results: [], isError: false } };
  expect(tool?.renderResult(result, { expanded: false }, theme)).toBeDefined();
});

const resolvedAgent = { agent: undefined, available: [], cwd: process.cwd() };
const emptyDetails = makeDetails('single')([]);
const silentRun = { defaults: {}, signal: undefined, onUpdate: undefined };

test('runChain with no steps reports no output', async () => {
  const result = await runChain(silentRun, [], []);
  expect(result.content).toEqual([{ type: 'text', text: '(no output)' }]);
});

test('chain and parallel ignore child updates that carry no result', async () => {
  const onUpdate = vi.fn();
  const finished = createUnstartedResult('a', 't', undefined, 'failed', 'x');
  vi.mocked(runSingleAgent).mockImplementation(async (_d, _r, _n, _t, _s, _sig, update) => {
    update?.({ content: [], details: emptyDetails });
    return finished;
  });
  const run = { ...silentRun, onUpdate };
  await runChain(run, [{ agent: 'a', task: 't' }], [resolvedAgent]);
  await runParallel(run, [{ agent: 'a', task: 't' }], [resolvedAgent]);
  const progress = onUpdate.mock.calls.map(([update]) => update.content[0]?.text);
  expect(progress).toEqual(['Parallel: 1/1 done, 0 running, 0 pending...']);
});
