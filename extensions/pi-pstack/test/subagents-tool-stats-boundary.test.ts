import type { JsonObject, JsonValue } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { countToolStats } from '../src/subagents/tool-stats.ts';

const counts = { readCount: 2, searchCount: 0, bashCount: 1, editFileCount: 1, otherToolCount: 0, linesAdded: 3, linesRemoved: 1 };
function result(toolStats: JsonValue) {
  return { role: 'toolResult' as const, toolCallId: 'nested', toolName: 'Agent', content: [], isError: false, timestamp: 0, details: { toolStats } };
}

test.each([null, {}, { ...counts, readCount: -1 }, { ...counts, readCount: 1.5 }, { ...counts, readCount: '2' }])('invalid nested statistics do not corrupt counters %j', (incoming) => {
  expect(countToolStats([result(incoming)])).toEqual({ totalToolUseCount: 0 });
});

test('[G1-20] reported nested statistics survive error results from non-delegation tools', () => {
  expect(countToolStats([{ ...result(counts), toolName: 'skill_fork', isError: true }])).toEqual({ totalToolUseCount: 0, toolStats: counts });
});

test('[G1-20] optional nested frame count is retained without inventing a frame producer', () => {
  expect(countToolStats([result({ ...counts, frameCount: 3 })])).toEqual({ totalToolUseCount: 0, toolStats: { ...counts, frameCount: 3 } });
});

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function assistant(...calls: ReadonlyArray<{ name: string; arguments?: JsonObject }>) {
  return {
    role: 'assistant' as const,
    content: calls.map((call, index) => ({ type: 'toolCall' as const, id: `call-${index}`, name: call.name, arguments: call.arguments ?? {} })),
    api: 'openai-completions' as const,
    provider: 'test',
    model: 'test',
    usage,
    stopReason: 'toolUse' as const,
    timestamp: 0,
  };
}

test('[G1-20] assistant tool calls are categorized case-insensitively', () => {
  const stats = countToolStats([assistant({ name: 'Read' }, { name: 'grep' }, { name: 'Glob' }, { name: 'find' }, { name: 'Bash' }, { name: 'edit' }, { name: 'write' }, { name: 'multiedit' }, { name: 'webfetch' })]);
  expect(stats).toEqual({
    totalToolUseCount: 9,
    toolStats: { readCount: 1, searchCount: 3, bashCount: 1, editFileCount: 3, otherToolCount: 1, linesAdded: 0, linesRemoved: 0 },
  });
});

test('[G1-20] delegation tool calls count as tool uses but not in the statistics', () => {
  expect(countToolStats([assistant({ name: 'task' }, { name: 'Agent' })])).toEqual({ totalToolUseCount: 2 });
});

test('[G1-20] text blocks and empty transcripts add no tool uses', () => {
  const message = assistant({ name: 'read' });
  const withText = { ...message, content: [{ type: 'text' as const, text: 'thinking out loud' }, ...message.content] };
  expect(countToolStats([withText])).toMatchObject({ totalToolUseCount: 1, toolStats: { readCount: 1 } });
  expect(countToolStats([])).toEqual({ totalToolUseCount: 0 });
});

test('[G1-20] write content and edit replacements contribute added and removed lines', () => {
  const stats = countToolStats([
    assistant({ name: 'write', arguments: { content: 'a\nb\nc' } }),
    assistant({
      name: 'edit',
      arguments: {
        edits: [
          { oldText: 'a\nb', newText: 'a\nb\nc\nd' },
          { old_string: 'x', new_string: 'y\nz' },
        ],
      },
    }),
  ]);
  expect(stats).toEqual({
    totalToolUseCount: 2,
    toolStats: { readCount: 0, searchCount: 0, bashCount: 0, editFileCount: 2, otherToolCount: 0, linesAdded: 9, linesRemoved: 3 },
  });
});

test('[G1-20] a single edit without an edits array and malformed entries still count what they can', () => {
  const single = countToolStats([assistant({ name: 'edit', arguments: { oldText: 'one', newText: 'one\ntwo' } })]);
  expect(single.toolStats).toMatchObject({ editFileCount: 1, linesAdded: 2, linesRemoved: 1 });
  const mixed = countToolStats([assistant({ name: 'multiedit', arguments: { edits: [null, 'skip', { newText: 'a' }] } })]);
  expect(mixed.toolStats).toMatchObject({ editFileCount: 1, linesAdded: 1, linesRemoved: 0 });
  expect(countToolStats([assistant({ name: 'edit', arguments: { oldText: '', newText: '' } })])).toMatchObject({ totalToolUseCount: 1, toolStats: { editFileCount: 1, linesAdded: 0, linesRemoved: 0 } });
});

test('[G1-20] nested child statistics accumulate with the assistant counts', () => {
  expect(countToolStats([assistant({ name: 'read' }), result({ ...counts, frameCount: 2 })])).toEqual({
    totalToolUseCount: 1,
    toolStats: { readCount: 3, searchCount: 0, bashCount: 1, editFileCount: 1, otherToolCount: 0, linesAdded: 3, linesRemoved: 1, frameCount: 2 },
  });
});
