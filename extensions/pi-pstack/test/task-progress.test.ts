import { afterEach, expect, test, vi } from 'vitest';
import { createProgress, latestLine, progressText, stepLine } from '../src/task/progress.ts';

afterEach(() => vi.useRealTimers());

test('a tool start becomes one short step line', () => {
  expect(stepLine({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'npm test\n--watch' } })).toBe('· bash: npm test --watch');
  expect(stepLine({ type: 'tool_execution_start', toolName: 'read', args: { path: 'src/a.ts' } })).toBe('· read: src/a.ts');
  expect(stepLine({ type: 'tool_execution_start', toolName: 'edit', args: {} })).toBe('· edit');
  expect(stepLine({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'x'.repeat(200) } })?.length).toBe(88);
  expect(stepLine({ type: 'tool_execution_end', toolName: 'bash' })).toBeUndefined();
});

test('the latest assistant prose is its first non-empty line', () => {
  expect(latestLine({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '\nChecking the handler.\nmore' }] } })).toBe('Checking the handler.');
  expect(latestLine({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } })).toBeUndefined();
  expect(latestLine({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '   ' }] } })).toBeUndefined();
});

test('the running card counts steps and shows the latest prose', () => {
  expect(progressText({ steps: [] })).toBe('Running…');
  expect(progressText({ steps: ['· read: a', '· bash: b'], latest: 'Looking at it' })).toBe('Running: 2 steps\n· read: a\n· bash: b\n\nLooking at it');
});

test('the first event sends at once, later events coalesce, and stop drops a pending update', () => {
  vi.useFakeTimers();
  const sent: string[] = [];
  const handle = createProgress(
    (update) => sent.push(update.content[0]?.text ?? ''),
    () => ({ running: true }),
  );
  handle.onEvent({ type: 'tool_execution_start', toolName: 'read', args: { path: 'a.ts' } });
  expect(sent).toEqual(['Running: 1 step\n· read: a.ts']);
  handle.onEvent({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'b' } });
  handle.onEvent({ type: 'tool_execution_start', toolName: 'grep', args: { pattern: 'c' } });
  expect(sent).toHaveLength(1);
  vi.advanceTimersByTime(750);
  expect(sent.at(-1)).toBe('Running: 3 steps\n· read: a.ts\n· bash: b\n· grep: c');
  handle.onEvent({ type: 'tool_execution_start', toolName: 'find', args: { pattern: 'd' } });
  handle.stop();
  vi.advanceTimersByTime(1_000);
  expect(sent).toHaveLength(2);
});

test('only the last four steps are kept', () => {
  vi.useFakeTimers();
  const sent: string[] = [];
  const handle = createProgress(
    (update) => sent.push(update.content[0]?.text ?? ''),
    () => undefined,
    () => 10_000,
  );
  for (const name of ['a', 'b', 'c', 'd', 'e']) handle.onEvent({ type: 'tool_execution_start', toolName: name, args: {} });
  vi.advanceTimersByTime(750);
  handle.stop();
  expect(sent.at(-1)?.split('\n')).toEqual(['Running: 5 steps', '· b', '· c', '· d', '· e']);
});

test('the first tool step shows even when prose just sent an update', () => {
  vi.useFakeTimers();
  const sent: string[] = [];
  const handle = createProgress(
    (update) => sent.push(update.content[0]?.text ?? ''),
    () => undefined,
  );
  handle.onEvent({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Thinking about it' }] } });
  handle.onEvent({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'npm test' } });
  handle.stop();
  expect(sent).toEqual(['Running…\n\nThinking about it', 'Running: 1 step\n· bash: npm test\n\nThinking about it']);
});
