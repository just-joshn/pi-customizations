import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSessionEntries, type SessionEntry } from '@earendil-works/pi-coding-agent';

type Report = { path: string; answers: string[]; toolCalls: number };
type Assistant = Extract<SessionEntry, { type: 'message' }>;

const isAssistant = (entry: SessionEntry): entry is Assistant => entry.type === 'message' && entry.message.role === 'assistant';

/** The entries from the last one back to the root, oldest first. A cycle in parent ids ends the walk. */
function branchOf(turns: SessionEntry[]): SessionEntry[] {
  const byId = new Map(turns.map((entry) => [entry.id, entry]));
  const walk = (entry: SessionEntry | undefined, seen: ReadonlySet<string>): SessionEntry[] => (entry && !seen.has(entry.id) ? [entry, ...walk(entry.parentId ? byId.get(entry.parentId) : undefined, new Set([...seen, entry.id]))] : []);
  return walk(turns.at(-1), new Set()).toReversed();
}

/** What one assistant turn contributes to the answers, or nothing. */
function answerOf(entry: Assistant, last: boolean): string[] {
  const message = entry.message;
  if (message.role !== 'assistant') return [];
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const ended = [`[Worker answer ended with ${message.stopReason}]`, text, message.errorMessage].filter(Boolean).join('\n');
  switch (message.stopReason) {
    case 'stop':
      return text.trim() ? [text] : [];
    case 'error':
    case 'aborted':
      // A failed turn the worker went on from was retried, so only the one it ended on is its answer.
      return last ? [ended] : [];
    case 'length':
      return [ended];
    case 'toolUse':
    case 'pending':
    case 'deferred':
      return [];
    default: {
      const unhandled: never = message.stopReason;
      throw new Error(`Unhandled worker stop reason: ${unhandled}`);
    }
  }
}

function reportOf(path: string, entries: ReturnType<typeof parseSessionEntries>, since: string): Report {
  const turns = entries.filter((entry): entry is SessionEntry => entry.type !== 'session');
  const branch = branchOf(turns);
  const prompt = branch.findLastIndex((entry) => entry.type === 'message' && entry.message.role === 'user');
  if (prompt < 0 || !(Date.parse(branch[prompt]?.timestamp ?? '') >= Date.parse(since))) return { path, answers: [], toolCalls: 0 };
  const after = branch.slice(prompt + 1);
  const assistants = after.filter(isAssistant);
  return {
    path,
    answers: assistants.flatMap((entry) => answerOf(entry, entry === assistants.at(-1))),
    toolCalls: after.filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult').length,
  };
}

/** A worker's completed answers since its brief, and how many tool calls it made. */
export function workerReport(sessionDir: string | undefined, since: string): Report | undefined {
  if (!sessionDir) return undefined;
  try {
    if (!lstatSync(sessionDir).isDirectory()) return undefined;
    const files = readdirSync(sessionDir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => ({ path: join(sessionDir, name), stat: lstatSync(join(sessionDir, name)) }))
      .filter(({ stat }) => stat.isFile())
      .toSorted((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    for (const { path } of files) {
      const entries = parseSessionEntries(readFileSync(path, 'utf8'));
      if (entries[0]?.type === 'session') return reportOf(path, entries, since);
    }
  } catch {
    return undefined;
  }
  return undefined;
}
