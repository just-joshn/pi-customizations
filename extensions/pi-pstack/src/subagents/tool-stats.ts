import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';

const count = Type.Integer({ minimum: 0 });
export const ToolStatsSchema = Type.Object({ readCount: count, searchCount: count, bashCount: count, editFileCount: count, otherToolCount: count, linesAdded: count, linesRemoved: count, frameCount: Type.Optional(count) });
export type ToolStats = Static<typeof ToolStatsSchema>;
type Message = AgentSession['messages'][number];
type Category = 'readCount' | 'searchCount' | 'bashCount' | 'editFileCount' | 'otherToolCount';
const categories: Readonly<Record<string, Category | undefined>> = {
  read: 'readCount',
  grep: 'searchCount',
  glob: 'searchCount',
  find: 'searchCount',
  bash: 'bashCount',
  edit: 'editFileCount',
  write: 'editFileCount',
  multiedit: 'editFileCount',
};

function nestedStats(message: Message, stats: ToolStats): ToolStats {
  if (message.role !== 'toolResult') return stats;
  const details: unknown = message.details;
  if (typeof details !== 'object' || details === null || !('toolStats' in details) || !Check(ToolStatsSchema, details.toolStats)) return stats;
  const nested = details.toolStats;
  return {
    readCount: stats.readCount + nested.readCount,
    searchCount: stats.searchCount + nested.searchCount,
    bashCount: stats.bashCount + nested.bashCount,
    editFileCount: stats.editFileCount + nested.editFileCount,
    otherToolCount: stats.otherToolCount + nested.otherToolCount,
    linesAdded: stats.linesAdded + nested.linesAdded,
    linesRemoved: stats.linesRemoved + nested.linesRemoved,
    ...(stats.frameCount || nested.frameCount ? { frameCount: (stats.frameCount ?? 0) + (nested.frameCount ?? 0) } : {}),
  };
}

function lineCount(value: unknown): number {
  return typeof value === 'string' && value.length > 0 ? value.split('\n').length : 0;
}

function requestedLines(name: string, input: Record<string, unknown>): { linesAdded: number; linesRemoved: number } {
  if (name === 'write') return { linesAdded: lineCount(input.content), linesRemoved: 0 };
  const edits = Array.isArray(input.edits) ? input.edits : [input];
  return edits.reduce(
    (counts, edit: unknown) => {
      if (typeof edit !== 'object' || edit === null) return counts;
      const added = 'newText' in edit ? edit.newText : 'new_string' in edit ? edit.new_string : undefined;
      const removed = 'oldText' in edit ? edit.oldText : 'old_string' in edit ? edit.old_string : undefined;
      return { linesAdded: counts.linesAdded + lineCount(added), linesRemoved: counts.linesRemoved + lineCount(removed) };
    },
    { linesAdded: 0, linesRemoved: 0 },
  );
}

export function countToolStats(messages: readonly Message[]): { totalToolUseCount: number; toolStats?: ToolStats } {
  let stats: ToolStats = { readCount: 0, searchCount: 0, bashCount: 0, editFileCount: 0, otherToolCount: 0, linesAdded: 0, linesRemoved: 0 };
  let totalToolUseCount = 0;
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type !== 'toolCall') continue;
        totalToolUseCount += 1;
        const name = block.name.toLowerCase();
        if (name === 'agent' || name === 'task') continue;
        const category = categories[name] ?? 'otherToolCount';
        const lines = category === 'editFileCount' ? requestedLines(name, block.arguments) : { linesAdded: 0, linesRemoved: 0 };
        stats = { ...stats, [category]: stats[category] + 1, linesAdded: stats.linesAdded + lines.linesAdded, linesRemoved: stats.linesRemoved + lines.linesRemoved };
      }
    }
    stats = nestedStats(message, stats);
  }
  return { totalToolUseCount, ...(Object.values(stats).some((value) => value !== 0) ? { toolStats: stats } : {}) };
}
