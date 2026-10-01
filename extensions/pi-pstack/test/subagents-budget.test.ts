import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { maxBudgetUsd, sessionCostUsd } from '../src/subagents/budget.ts';
import { workerFixture } from './worker-fixture.ts';

const cost = (total: number) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total } });
const entry = (data: object) => ({ id: 'e', parentId: null, timestamp: '', ...data }) as unknown as SessionEntry;

test('session cost sums assistant, tool-result, usage and summary entries', () => {
  const entries = [
    entry({ type: 'message', message: { role: 'assistant', usage: cost(0.25) } }),
    entry({ type: 'message', message: { role: 'toolResult', usage: cost(0.5) } }),
    entry({ type: 'message', message: { role: 'toolResult' } }),
    entry({ type: 'message', message: { role: 'user' } }),
    entry({ type: 'usage', usage: cost(0.125) }),
    entry({ type: 'compaction', usage: cost(0.0625) }),
    entry({ type: 'custom', customType: 'x', data: { usage: cost(9) } }),
  ];
  expect(sessionCostUsd(entries)).toBe(0.9375);
});

test.for([
  { flag: '5', expected: 5 },
  { flag: '0.25', expected: 0.25 },
  { flag: '0', expected: undefined },
  { flag: '-1', expected: undefined },
  { flag: 'lots', expected: undefined },
  { flag: undefined, expected: undefined },
  { flag: true, expected: undefined },
])('--max-budget-usd $flag parses to $expected', ({ flag, expected }) => {
  expect(maxBudgetUsd(flag)).toBe(expected);
});

test('an exhausted --max-budget-usd refuses new agents with the recovered message', async () => {
  const fixture = await workerFixture({ flags: { 'max-budget-usd': '0.01' } });
  try {
    await fixture.session.prompt('COSTS_ONE_CENT');
    await expect(fixture.call('Agent', { description: 'over budget', prompt: 'p' })).rejects.toMatchObject({
      name: 'AgentPreconditionError',
      code: 'subagent_budget_exhausted',
      message: 'Budget limit reached ($0.01 spent of the $0.01 maximum). New agents cannot be started. Complete the remaining work directly with your tools, or wrap up with the results you already have.',
    });
    expect(fixture.subagentStats.at(-1)).toMatchObject({ refused: { budget: 1 } });
  } finally {
    await fixture.close();
  }
});

test('spending below --max-budget-usd admits new agents', async () => {
  const fixture = await workerFixture({ flags: { 'max-budget-usd': '1' } });
  try {
    await fixture.session.prompt('COSTS_ONE_CENT');
    expect((await fixture.call('Agent', { description: 'within budget', prompt: 'hello', run_in_background: false })).details).toMatchObject({ status: 'completed' });
  } finally {
    await fixture.close();
  }
});
