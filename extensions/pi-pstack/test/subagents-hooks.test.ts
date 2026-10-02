import { expect, test } from 'vitest';
import { combineContexts, type HookInput, type HookRunner, hookOutputLimit, parseSubagentHooks, runHooks } from '../src/subagents/subagent-hooks.ts';

const input: HookInput = { agentId: 'a1', agentType: 'explore', sessionId: 's1', cwd: '/repo', timestamp: '2026-01-01T00:00:00.000Z' };

test('hooks are read from the settings hooks section as strings or objects with a timeout', () => {
  expect(parseSubagentHooks({ hooks: { subagentStart: ['echo hi', { command: 'slow', timeoutSec: 5 }], subagentStop: [{ command: 'bye' }] } })).toEqual({
    start: [
      { command: 'echo hi', timeoutMs: 30000 },
      { command: 'slow', timeoutMs: 5000 },
    ],
    stop: [{ command: 'bye', timeoutMs: 30000 }],
  });
});

test.for([undefined, null, {}, { hooks: 7 }, { hooks: { subagentStart: 'echo' } }])('settings %j define no hooks', (settings) => {
  expect(parseSubagentHooks(settings)).toEqual({ start: [], stop: [] });
});

test('each hook receives the event as JSON on stdin and its context is combined', async () => {
  const calls: string[] = [];
  const run: HookRunner = async (command, payload) => {
    calls.push(`${command}:${payload}`);
    return { code: 0, stdout: command === 'json' ? '{"additionalContext":"from json"}' : 'plain context', stderr: '' };
  };
  const report = await runHooks(
    [
      { command: 'json', timeoutMs: 1 },
      { command: 'text', timeoutMs: 1 },
    ],
    input,
    run,
  );
  expect(report).toEqual({ context: 'from json\n\nplain context', failures: [] });
  expect(JSON.parse(calls[0]?.slice('json:'.length) ?? '{}')).toEqual(input);
});

test('a failing hook is reported and never blocks the spawn', async () => {
  const run: HookRunner = async (command) => ({ code: command === 'bad' ? 3 : 0, stdout: 'kept', stderr: command === 'bad' ? 'boom\n' : '' });
  const report = await runHooks(
    [
      { command: 'bad', timeoutMs: 1 },
      { command: 'good', timeoutMs: 1 },
    ],
    input,
    run,
  );
  expect(report).toEqual({ context: 'kept', failures: ['bad exited 3: boom'] });
});

test('the stop hook input carries the transcript path', async () => {
  let seen = '';
  await runHooks([{ command: 'stop', timeoutMs: 1 }], { ...input, transcriptPath: '/t.jsonl' }, async (_command, payload) => {
    seen = payload;
    return { code: 0, stdout: '', stderr: '' };
  });
  expect(JSON.parse(seen)).toMatchObject({ transcriptPath: '/t.jsonl' });
});

test('combined context is cut at the output limit with a marker', () => {
  const combined = combineContexts(['a'.repeat(hookOutputLimit), 'b'.repeat(10)]);
  expect(combined.endsWith(`\n[hook output truncated at ${hookOutputLimit} characters]`)).toBe(true);
  expect(combined.length).toBe(hookOutputLimit + `\n[hook output truncated at ${hookOutputLimit} characters]`.length);
  expect(combineContexts(['', 'x'])).toBe('x');
});

test('plain text that looks like broken json is kept as context', async () => {
  const report = await runHooks([{ command: 'x', timeoutMs: 1 }], input, async () => ({ code: 0, stdout: '{not json', stderr: '' }));
  expect(report.context).toBe('{not json');
});
