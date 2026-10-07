import { describe, expect, test } from 'vitest';
import { accumulate, agentPrompt, crewArgs, crewModel, runCrew } from '../src/cavecrew.ts';

const line = (text: string, output: number) =>
  JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], usage: { input: 10, output, cacheRead: 1, cacheWrite: 0, totalTokens: 10 + output, cost: { total: 0.5 } } } });

const freshRun = () => ({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: 0, output: '' });

describe('crewModel', () => {
  test('an env override beats the parent model', () => {
    expect(crewModel('reviewer', { CAVECREW_REVIEWER_MODEL: ' anthropic/claude-haiku-4-5 ' }, 'openai/gpt-5')).toBe('anthropic/claude-haiku-4-5');
  });

  test('a control character in the override is rejected', () => {
    expect(crewModel('builder', { CAVECREW_BUILDER_MODEL: 'bad\nmodel' }, 'openai/gpt-5')).toBe('openai/gpt-5');
  });

  test('without a parent model or override Pi chooses', () => {
    expect(crewModel('investigator', {}, null)).toBe(null);
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
