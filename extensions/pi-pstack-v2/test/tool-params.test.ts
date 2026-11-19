import { validateToolArguments } from '@earendil-works/pi-ai';
import type { TSchema } from 'typebox';
import { describe, expect, test } from 'vitest';
import type { z } from 'zod';
import { TmuxJobsParamsSchema, TmuxRunParamsSchema, tmuxJobsParameters, tmuxRunParameters } from '../src/index.ts';
import { SubagentParams, SubagentParamsSchema } from '../src/subagent/schema.ts';

const SOME_NUMBER = 5;
const SOME_NUMBER_TEXT = '5';

type Case = { tool: string; parameters: TSchema; schema: z.ZodType; args: Record<string, unknown> };

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

const cases: Case[] = [
  ...tmuxRunCases.map((args) => ({ tool: 'tmux_run', parameters: tmuxRunParameters, schema: TmuxRunParamsSchema, args })),
  ...tmuxJobsCases.map((args) => ({ tool: 'tmux_jobs', parameters: tmuxJobsParameters, schema: TmuxJobsParamsSchema, args })),
  ...subagentCases.map((args) => ({ tool: 'subagent', parameters: SubagentParams, schema: SubagentParamsSchema, args })),
];

/** What Pi does with a tool call before the tool runs: its arguments after Pi's coercion and validation, or a refusal. */
const piChecks = async ({ tool, parameters, args }: Case): Promise<PromiseSettledResult<unknown>> => {
  const [outcome] = await Promise.allSettled([Promise.resolve().then(() => validateToolArguments({ name: tool, description: '', parameters } as never, { type: 'toolCall', id: 'call', name: tool, arguments: args } as never))]);
  return outcome as PromiseSettledResult<unknown>;
};

describe('the zod schemas of the tools', () => {
  test.each(cases.map((c) => [c.tool, JSON.stringify(c.args), c] as const))('%s accepts whatever Pi passes on for %s', async (_tool, _args, c) => {
    const outcome = await piChecks(c);
    const accepted = outcome.status === 'fulfilled' ? c.schema.safeParse(outcome.value).success : true;
    expect(accepted).toBe(true);
  });

  test('Pi refuses some of these calls, so the cases cover both sides', async () => {
    const outcomes = await Promise.all(cases.map(piChecks));
    expect(outcomes.filter((o) => o.status === 'rejected').length).toBeGreaterThan(0);
    expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBeGreaterThan(0);
  });
});
