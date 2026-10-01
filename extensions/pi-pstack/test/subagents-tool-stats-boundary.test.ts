import type { JsonValue } from '@earendil-works/pi-ai';
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
