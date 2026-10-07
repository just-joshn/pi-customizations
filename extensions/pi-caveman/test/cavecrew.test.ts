import { describe, expect, test } from 'vitest';
import { accumulate, agentPrompt, crewArgs, crewModel, runCrew } from '../src/cavecrew.ts';

const freshRun = () => ({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: 0, output: '' });

describe('crewModel', () => {
  test('an env override beats the parent model', () => {
    expect(crewModel('reviewer', { CAVECREW_REVIEWER_MODEL: ' anthropic/claude-haiku-4-5 ' }, 'openai/gpt-5')).toBe('anthropic/claude-haiku-4-5');
  });

  test('a control character in the override is rejected', () => {
    expect(crewModel('builder', { CAVECREW_BUILDER_MODEL: 'bad\nmodel' }, 'openai/gpt-5')).toBe('openai/gpt-5');
  });

  test('no parent model and no override leaves Pi to choose', () => {
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

  test('the builder may edit and write', () => {
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
  test('sums assistant usage and keeps the last text', () => {
    const end = (text: string, output: number) =>
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], usage: { input: 10, output, cacheRead: 1, cacheWrite: 0, totalTokens: 10 + output, cost: { total: 0.5 } } } });
    const lines = [end('first', 3), JSON.stringify({ type: 'message_end', message: { role: 'user' } }), 'not json', end('Defs:\n- a.ts:1', 4)];
    expect(lines.reduce(accumulate, freshRun())).toStrictEqual({
      usage: { input: 20, output: 7, cacheRead: 2, cacheWrite: 0, totalTokens: 27, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 } },
      turns: 2,
      output: 'Defs:\n- a.ts:1',
    });
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
    await expect(runCrew({ role: 'investigator', task: 't', cwd: process.cwd(), model: null, signal: controller.signal })).rejects.toThrow('cavecrew-investigator aborted');
  });
});
