import { validateToolArguments } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import subagentExtension from '../src/subagent/index.ts';
import { createWorld, type Host, loadPstack, type World } from './core-host.ts';

const SOME_NUMBER = 5;
const SOME_NUMBER_TEXT = '5';

type Case = { tool: 'tmux_run' | 'tmux_jobs' | 'subagent'; args: Record<string, unknown> };

const tmuxRunCases = [
  { name: 'n', command: 'true' },
  { name: 'n', command: 'true', cwd: 'sub', wake: 'w', repeat: true },
  { name: 'n', command: 'true', extra: 1 },
  { command: 'true' },
  { name: 'n', command: 'true', repeat: 1 },
  { name: 'n', command: 'true', wake: null, cwd: null, repeat: null },
  { name: SOME_NUMBER, command: 'true' },
  { name: 'n', command: 'true', repeat: 'true' },
];
const tmuxJobsCases = [
  { action: 'list' },
  { action: 'output', ids: ['a'] },
  { action: 'wait', timeout_seconds: SOME_NUMBER },
  { action: 'stop', ids: ['a'], extra: 1 },
  { action: 'nope' },
  { action: 'output', ids: 'abc' },
  { action: 'output', ids: null, lines: SOME_NUMBER_TEXT, timeout_seconds: null },
  { ids: ['a'] },
];
const subagentCases = [
  {},
  { agent: 'a', task: 't' },
  { tasks: [{ agent: 'a', task: 't', extra: 1 }], agentScope: 'both' },
  { chain: [{ agent: 'a', task: 't', cwd: 'sub' }], confirmProjectAgents: false },
  { agentScope: 'nope' },
  { chain: [{ agent: 'a' }] },
  { agent: null, cwd: null, future: 1 },
  { confirmProjectAgents: 'true' },
  { agent: 'a', task: 't', model: 'p/m', thinking: 'high' },
  { tasks: [{ agent: 'a', task: 't', model: 'p/m', thinking: 'off' }] },
  { chain: [{ agent: 'a', task: 't', thinking: 'loud' }] },
  { agent: 'a', task: 't', model: SOME_NUMBER },
];
const cases: Case[] = [...tmuxRunCases.map((args) => ({ tool: 'tmux_run' as const, args })), ...tmuxJobsCases.map((args) => ({ tool: 'tmux_jobs' as const, args })), ...subagentCases.map((args) => ({ tool: 'subagent' as const, args }))];

let world: World;
let pstack: Host;
let subagent: Host;

beforeEach(() => {
  world = createWorld();
  pstack = loadPstack(world);
  subagent = loadPstack(world, {}, subagentExtension);
});

afterEach(() => {
  world.dispose();
});

const hostOf = (tool: Case['tool']): Host => (tool === 'subagent' ? subagent : pstack);

type Run = { refused: true } | { refused: false; failure: Error | undefined };

/** What Pi does with a tool call: check its arguments against the tool's schema, then run the tool with the result. */
async function pi({ tool, args }: Case): Promise<Run> {
  const host = hostOf(tool);
  const definition = { name: tool, description: '', parameters: host.tool(tool).parameters };
  const checked = await Promise.resolve()
    .then(() => validateToolArguments(definition as never, { type: 'toolCall', id: 'call', name: tool, arguments: args } as never))
    .then(
      (accepted) => ({ accepted: accepted as Record<string, unknown> }),
      () => undefined,
    );
  if (!checked) return { refused: true };
  const failure = await host.call(tool, checked.accepted).then(
    () => undefined,
    (error: unknown) => error as Error,
  );
  return { refused: false, failure };
}

describe('a call Pi lets through is never rejected by the tool for its arguments', () => {
  test.for(cases.map((c) => [c.tool, JSON.stringify(c.args), c] as const))('%s accepts whatever Pi passes on for %s', async ([, , c]) => {
    const run = await pi(c);
    expect(run.refused ? undefined : run.failure?.name).not.toBe('ZodError');
  });

  test('Pi refuses some of these calls and lets others through, so the cases cover both sides', async () => {
    const runs = await Promise.all(cases.map(pi));
    expect(runs.filter((run) => run.refused).length).toBeGreaterThan(0);
    expect(runs.filter((run) => !run.refused).length).toBeGreaterThan(0);
  });
});

describe('arguments the tools were not told about', () => {
  test('tmux_jobs ignores extra keys', async () => {
    expect(await pstack.text('tmux_jobs', { action: 'list', future: 1 })).toBe('No jobs in this session.');
    expect(await pstack.text('tmux_jobs', { action: 'wait', future: 1 })).toBe('No jobs to wait on.');
  });

  test('tmux_run ignores extra keys', async () => {
    await expect(pstack.call('tmux_run', { name: 'n', command: 'true', cwd: 'missing-dir', extra: 1 })).rejects.toThrow(/is not a directory/);
  });
});
