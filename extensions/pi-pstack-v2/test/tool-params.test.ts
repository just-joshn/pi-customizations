import { validateToolArguments } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import subagentExtension from '../src/subagent/index.ts';
import { createWorld, type Host, loadPstack, type World } from './core-host.ts';

const SOME_NUMBER = 5;
const SOME_NUMBER_TEXT = '5';

const REFUSED = 'refused';
const STARTED = /^Started \S+-[0-9a-f]{6} {2}running/;
const NEEDS_WAKE = /repeat needs a wake message/;
const NO_JOB_A = /No job a in this session/;
const UNKNOWN_AGENT = /Unknown agent: "a"/;
const NO_MODE = /^Invalid parameters\. Provide exactly one mode\./;

/** What Pi shows for a call: it refuses the arguments, or the tool runs and answers with this text or fails with this error. */
type Outcome = typeof REFUSED | { text: RegExp | string } | { error: RegExp };
type Case = { tool: 'tmux_run' | 'tmux_jobs' | 'subagent'; args: Record<string, unknown>; outcome: Outcome };

const tmuxRunCases: [Record<string, unknown>, Outcome][] = [
  [{ name: 'n', command: 'true' }, { text: STARTED }],
  [{ name: 'n', command: 'true', cwd: 'sub', wake: 'w', repeat: true }, { error: /is not a directory/ }],
  [{ name: 'n', command: 'true', extra: 1 }, { text: STARTED }],
  [{ command: 'true' }, REFUSED],
  [{ name: 'n', command: 'true', repeat: 1 }, { error: NEEDS_WAKE }],
  [{ name: 'n', command: 'true', wake: null, cwd: null, repeat: null }, { text: STARTED }],
  [{ name: SOME_NUMBER, command: 'true' }, { text: /^Started 5-[0-9a-f]{6} {2}running/ }],
  [{ name: 'n', command: 'true', repeat: 'true' }, { error: NEEDS_WAKE }],
];
const tmuxJobsCases: [Record<string, unknown>, Outcome][] = [
  [{ action: 'list' }, { text: 'No jobs in this session.' }],
  [{ action: 'output', ids: ['a'] }, { error: NO_JOB_A }],
  [{ action: 'wait', timeout_seconds: SOME_NUMBER }, { text: 'No jobs to wait on.' }],
  [{ action: 'stop', ids: ['a'], extra: 1 }, { error: NO_JOB_A }],
  [{ action: 'nope' }, REFUSED],
  [{ action: 'output', ids: 'abc' }, { error: /No job abc in this session/ }],
  [{ action: 'output', ids: null, lines: SOME_NUMBER_TEXT, timeout_seconds: null }, { error: /output needs ids/ }],
  [{ ids: ['a'] }, REFUSED],
];
const subagentCases: [Record<string, unknown>, Outcome][] = [
  [{}, { text: NO_MODE }],
  [{ agent: 'a', task: 't' }, { text: UNKNOWN_AGENT }],
  [{ tasks: [{ agent: 'a', task: 't', extra: 1 }], agentScope: 'both' }, { text: /^Parallel: 0\/1 succeeded/ }],
  [{ chain: [{ agent: 'a', task: 't', cwd: 'sub' }], confirmProjectAgents: false }, { text: /^Chain stopped at step 1 \(a\)/ }],
  [{ agentScope: 'nope' }, REFUSED],
  [{ chain: [{ agent: 'a' }] }, REFUSED],
  [{ agent: null, cwd: null, future: 1 }, { text: NO_MODE }],
  [{ confirmProjectAgents: 'true' }, { text: NO_MODE }],
  [{ agent: 'a', task: 't', model: 'p/m', thinking: 'high' }, { text: UNKNOWN_AGENT }],
  [{ tasks: [{ agent: 'a', task: 't', model: 'p/m', thinking: 'off' }] }, { text: /^Parallel: 0\/1 succeeded/ }],
  [{ chain: [{ agent: 'a', task: 't', thinking: 'loud' }] }, REFUSED],
  [{ agent: 'a', task: 't', model: SOME_NUMBER }, { text: UNKNOWN_AGENT }],
];
const cases: Case[] = [
  ...tmuxRunCases.map(([args, outcome]) => ({ tool: 'tmux_run' as const, args, outcome })),
  ...tmuxJobsCases.map(([args, outcome]) => ({ tool: 'tmux_jobs' as const, args, outcome })),
  ...subagentCases.map(([args, outcome]) => ({ tool: 'subagent' as const, args, outcome })),
];

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

type Shown = 'refused' | { text: string } | { error: string };

/** What Pi does with a tool call: check its arguments against the tool's schema, then run the tool with the result. */
async function pi({ tool, args }: Case): Promise<Shown> {
  const host = hostOf(tool);
  const definition = { name: tool, description: '', parameters: host.tool(tool).parameters };
  const checked = await Promise.resolve()
    .then(() => validateToolArguments(definition as never, { type: 'toolCall', id: 'call', name: tool, arguments: args } as never))
    .then(
      (accepted) => ({ accepted: accepted as Record<string, unknown> }),
      () => undefined,
    );
  if (!checked) return REFUSED;
  return host.call(tool, checked.accepted).then(
    (result) => ({ text: result.content[0]?.text ?? '' }),
    (error: unknown) => ({ error: (error as Error).message }),
  );
}

const expectedShown = (outcome: Outcome) => {
  if (outcome === REFUSED) return REFUSED;
  if ('error' in outcome) return { error: expect.stringMatching(outcome.error) };
  return { text: typeof outcome.text === 'string' ? outcome.text : expect.stringMatching(outcome.text) };
};

describe('what Pi shows for the arguments a model passes', () => {
  test.for(cases.map((c) => [c.tool, JSON.stringify(c.args), c] as const))('%s with %s', async ([, , c]) => {
    expect(await pi(c)).toEqual(expectedShown(c.outcome));
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
