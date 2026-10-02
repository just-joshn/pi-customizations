import { join } from 'node:path';

import { expect, test } from 'vitest';
import { applyBoardAction, boardPath, contextBoardTool, readBoard } from '../src/subagents/context-board.ts';
import { scratchDir } from './support/scratch.ts';

test('the board path is stable per working directory and distinct across directories', () => {
  expect(boardPath('/agent', '/repo')).toBe(boardPath('/agent', '/repo'));
  expect(boardPath('/agent', '/repo')).not.toBe(boardPath('/agent', '/other'));
});

test('actions write, delete and read without mutating the previous board', () => {
  const empty = {};
  const written = applyBoardAction(empty, { action: 'write', key: 'stack', value: 'bun' });
  expect({ empty, written }).toEqual({ empty: {}, written: { stack: 'bun' } });
  expect(applyBoardAction(written, { action: 'delete', key: 'stack' })).toEqual({});
  expect(applyBoardAction(written, { action: 'read' })).toBe(written);
});

test('write needs a key and a value and delete needs a key', () => {
  expect(() => applyBoardAction({}, { action: 'write', value: 'x' })).toThrow('context_board write needs a key.');
  expect(() => applyBoardAction({}, { action: 'write', key: 'k' })).toThrow('context_board write needs a value.');
  expect(() => applyBoardAction({}, { action: 'delete' })).toThrow('context_board delete needs a key.');
});

test('the tool persists the board between calls and reports it as text', async () => {
  const dir = scratchDir('pstack-board-');
  const tool = contextBoardTool((cwd) => join(dir, `${cwd.replaceAll('/', '_')}.json`));
  const context = { cwd: '/repo' } as Parameters<typeof tool.execute>[4];
  await tool.execute('1', { action: 'write', key: 'owner', value: 'josh' }, undefined, undefined, context);
  const read = await tool.execute('2', { action: 'read' }, undefined, undefined, context);
  expect(read.content[0]).toEqual({ type: 'text', text: 'owner: josh' });
  expect(read.details).toEqual({ board: { owner: 'josh' } });
  expect((await tool.execute('3', { action: 'delete', key: 'owner' }, undefined, undefined, context)).content[0]).toEqual({ type: 'text', text: 'The context board is empty.' });
});

test('a missing or malformed board file reads as empty and non-string values are dropped', () => {
  const dir = scratchDir('pstack-board-');
  expect(readBoard(join(dir, 'missing.json'))).toEqual({});
});
