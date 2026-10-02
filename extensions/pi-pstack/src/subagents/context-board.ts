import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';

export type Board = Readonly<Record<string, string>>;

export function boardPath(agentDir: string, cwd: string): string {
  return join(agentDir, 'context-boards', `${createHash('sha1').update(cwd).digest('hex').slice(0, 16)}.json`);
}

export function readBoard(path: string): Board {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])));
  } catch {
    return {};
  }
}

function writeBoard(path: string, board: Board): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(board, null, 2));
}

export const ContextBoardSchema = Type.Object(
  {
    action: Type.Union([Type.Literal('read'), Type.Literal('write'), Type.Literal('delete')], { description: 'read the board, write a key, or delete a key' }),
    key: Type.Optional(Type.String({ minLength: 1 })),
    value: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
type BoardDetails = Readonly<{ board: Board }>;
const BoardDetailsSchema = Type.Object({ board: Type.Record(Type.String(), Type.String()) });

function render(board: Board): string {
  const entries = Object.entries(board);
  return entries.length === 0 ? 'The context board is empty.' : entries.map(([key, value]) => `${key}: ${value}`).join('\n');
}

export function applyBoardAction(board: Board, input: Static<typeof ContextBoardSchema>): Board {
  if (input.action === 'read') return board;
  if (input.key === undefined) throw new Error(`context_board ${input.action} needs a key.`);
  if (input.action === 'delete') return Object.fromEntries(Object.entries(board).filter(([key]) => key !== input.key));
  if (input.value === undefined) throw new Error('context_board write needs a value.');
  return { ...board, [input.key]: input.value };
}

export function contextBoardTool(path: (cwd: string) => string, onChange: (ctx: ExtensionContext) => void = () => {}): ToolDefinition<typeof ContextBoardSchema, BoardDetails> {
  return {
    name: 'context_board',
    label: 'Context board',
    description: 'Read or update the shared context board that holds durable facts about this project for later sessions and for the memory consolidation agent.',
    promptSnippet: 'Read or update the shared context board',
    parameters: ContextBoardSchema,
    outputSchema: BoardDetailsSchema,
    exposure: 'direct',
    annotations: { openWorldHint: false },
    execute: async (_id, params, _signal, _update, ctx) => {
      const file = path(ctx.cwd);
      const board = applyBoardAction(readBoard(file), params);
      if (params.action !== 'read') {
        writeBoard(file, board);
        onChange(ctx);
      }
      return { content: [{ type: 'text', text: render(board) }], details: { board } };
    },
  };
}
