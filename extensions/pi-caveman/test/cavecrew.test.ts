import { describe, expect, test } from 'vitest';
import { accumulate, agentModelHint, agentPrompt, crewArgs, crewModel, runCrew } from '../src/cavecrew.ts';

const line = (text: string, output: number) =>
  JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], usage: { input: 10, output, cacheRead: 1, cacheWrite: 0, totalTokens: 10 + output, cost: { total: 0.5 } } } });

const freshRun = () => ({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: 0, output: '' });

const haiku = { provider: 'anthropic', id: 'claude-haiku-4-5' };
const pick = (overrides: Partial<Parameters<typeof crewModel>[0]>) => crewModel({ role: 'reviewer', env: {}, parentModel: 'openai/gpt-5', hint: 'haiku', available: [{ provider: 'openai', id: 'gpt-5' }, haiku], ...overrides });

describe('crewModel', () => {
  test('an env override beats every other source', () => {
    expect(pick({ env: { CAVECREW_REVIEWER_MODEL: ' x/custom ' } })).toBe('x/custom');
  });

  test('a control character in the override is rejected', () => {
    expect(pick({ role: 'builder', hint: null, env: { CAVECREW_BUILDER_MODEL: 'bad\nmodel' } })).toBe('openai/gpt-5');
  });

  test('the upstream haiku hint picks a matching Pi model', () => {
    expect(pick({})).toBe('anthropic/claude-haiku-4-5');
  });

  test('an unmatched hint falls back to the parent model', () => {
    expect(pick({ available: [{ provider: 'openai', id: 'gpt-5' }] })).toBe('openai/gpt-5');
  });

  test('without a parent model or a match Pi chooses', () => {
    expect(pick({ parentModel: null, available: [] })).toBe(null);
  });
});

describe('agentModelHint', () => {
  test.for([
    { role: 'investigator', expected: 'haiku' },
    { role: 'reviewer', expected: 'haiku' },
    { role: 'builder', expected: null },
  ] as const)('$role → $expected', ({ role, expected }) => {
    expect(agentModelHint(role)).toBe(expected);
  });
});

describe('crewArgs', () => {
  test('read-only roles get only read-only tools', () => {
    expect(crewArgs({ role: 'investigator', model: 'p/m', promptFile: '/tmp/p.md', task: 'find X' })).toStrictEqual([
      '--mode',
      'json',
      '-p',
      '--no-session',
      '--tools',
      'read,grep,find,ls,bash',
      '--model',
      'p/m',
      '--append-system-prompt',
      '/tmp/p.md',
      'Task: find X',
    ]);
  });

  test('the builder gets edit tools', () => {
    expect(crewArgs({ role: 'builder', model: null, promptFile: '/tmp/b.md', task: 't' })).toStrictEqual([
      '--mode',
      'json',
      '-p',
      '--no-session',
      '--tools',
      'read,edit,write,bash,grep,find,ls',
      '--append-system-prompt',
      '/tmp/b.md',
      'Task: t',
    ]);
  });
});

describe('accumulate', () => {
  test('sums usage over assistant messages', () => {
    const lines = [line('first', 3), JSON.stringify({ type: 'message_end', message: { role: 'user' } }), 'not json', line('Defs:\n- a.ts:1', 4)];
    expect(lines.reduce(accumulate, freshRun()).usage).toStrictEqual({ input: 20, output: 7, cacheRead: 2, cacheWrite: 0, totalTokens: 27, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 } });
  });

  test('keeps the last assistant text', () => {
    expect([line('first', 3), 'not json', line('Defs:\n- a.ts:1', 4)].reduce(accumulate, freshRun()).output).toBe('Defs:\n- a.ts:1');
  });

  test('counts only assistant turns', () => {
    expect([line('a', 1), JSON.stringify({ type: 'message_end', message: { role: 'user' } })].reduce(accumulate, freshRun()).turns).toBe(1);
  });
});

describe('agentPrompt', () => {
  test('strips frontmatter from the shipped agent definition', () => {
    expect(agentPrompt('investigator').startsWith('Ultracave voice.')).toBe(true);
  });
});

describe('runCrew', () => {
  test('an already aborted signal never spawns a subagent', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runCrew({ role: 'investigator', task: 't', cwd: '/nonexistent-cavecrew-cwd', model: null, signal: controller.signal })).rejects.toThrow('cavecrew-investigator aborted');
  });
});
