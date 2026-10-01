import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test('[G1-20] real child counts reads, bash and native edit diff lines', async () => {
  const fixture = await workerFixture();
  try {
    await writeFile(join(fixture.dir, 'stats-file.txt'), 'remove\n');
    const result = await fixture.call('Agent', { description: 'tool statistics', prompt: 'TOOL_STATS', run_in_background: false });
    expect(result.details).toMatchObject({ totalToolUseCount: 4, toolStats: { readCount: 2, searchCount: 0, bashCount: 1, editFileCount: 1, otherToolCount: 0, linesAdded: 3, linesRemoved: 1 } });
  } finally {
    await fixture.close();
  }
});

test.each([
  ['TRAILING_LINES', 4, 2, 'first\nsecond\nthird\n'],
  ['UNMATCHED_LINES', 3, 1, 'remove\n'],
] as const)('[G1-20] %s counts requested edit lines rather than applied diff', async (flag, added, removed, contents) => {
  const fixture = await workerFixture();
  try {
    await writeFile(join(fixture.dir, 'stats-file.txt'), 'remove\n');
    const result = await fixture.call('Agent', { description: 'requested edit counts', prompt: `TOOL_STATS ${flag}`, run_in_background: false });
    expect(result.details).toMatchObject({ totalToolUseCount: 4, toolStats: { editFileCount: 1, linesAdded: added, linesRemoved: removed } });
    expect(await readFile(join(fixture.dir, 'stats-file.txt'), 'utf8')).toBe(contents);
  } finally {
    await fixture.close();
  }
});

test('[G1-20] three real tool calls contribute exactly three total uses', async () => {
  const fixture = await workerFixture();
  try {
    await writeFile(join(fixture.dir, 'stats-file.txt'), 'remove\n');
    const result = await fixture.call('Agent', { description: 'three calls', prompt: 'TOOL_COUNTS', run_in_background: false });
    expect(result.details).toMatchObject({ totalToolUseCount: 3, toolStats: { readCount: 2, bashCount: 1, editFileCount: 0, linesAdded: 0, linesRemoved: 0 } });
  } finally {
    await fixture.close();
  }
});

test('[G1-20] real nested statistics aggregate without counting the delegation as a category', async () => {
  const fixture = await workerFixture();
  try {
    await writeFile(join(fixture.dir, 'stats-file.txt'), 'remove\n');
    const result = await fixture.call('Agent', { description: 'nested statistics sum', prompt: 'NEST_TOOL_SUM', run_in_background: false });
    expect(result.details).toMatchObject({ status: 'completed', totalToolUseCount: 1, toolStats: { readCount: 2, searchCount: 0, bashCount: 1, editFileCount: 1, otherToolCount: 0, linesAdded: 3, linesRemoved: 1 } });
    expect(await readFile(join(fixture.dir, 'stats-file.txt'), 'utf8')).toBe('first\nsecond\nthird\n');
  } finally {
    await fixture.close();
  }
});

test('nested Agent calls contribute to total uses but not tool categories', async () => {
  const fixture = await workerFixture();
  try {
    const result = await fixture.call('Agent', { description: 'nested counts', prompt: 'SPAWN_AGENT', run_in_background: false });
    expect(result.details).toMatchObject({ status: 'completed', totalToolUseCount: 1 });
    expect(result.details).not.toHaveProperty('toolStats');
  } finally {
    await fixture.close();
  }
});

test('[G1-20] native grep find ls and write have exact categories and requested line counts', async () => {
  const fixture = await workerFixture();
  try {
    await writeFile(join(fixture.dir, 'stats-file.txt'), 'remove\n');
    const result = await fixture.call('Agent', { description: 'remaining categories', prompt: 'TOOL_CATEGORIES', run_in_background: false });
    expect(result.details).toMatchObject({ totalToolUseCount: 4, toolStats: { readCount: 0, searchCount: 2, bashCount: 0, editFileCount: 1, otherToolCount: 1, linesAdded: 3, linesRemoved: 0 } });
    expect(await readFile(join(fixture.dir, 'stats-written.txt'), 'utf8')).toBe('one\ntwo\n');
  } finally {
    await fixture.close();
  }
});

test('[G1-07] a child without tool calls omits toolStats', async () => {
  const fixture = await workerFixture();
  try {
    const result = await fixture.call('Agent', { description: 'no tool statistics', prompt: 'hello', run_in_background: false });
    expect(result.details).toMatchObject({ status: 'completed', totalToolUseCount: 0, totalTokens: 5 });
    expect(result.details).not.toHaveProperty('toolStats');
  } finally {
    await fixture.close();
  }
});
