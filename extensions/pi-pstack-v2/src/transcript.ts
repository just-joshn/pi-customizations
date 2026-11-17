import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSessionEntries, type SessionEntry } from '@earendil-works/pi-coding-agent';

/** A worker's completed answers since its brief, and how many tool calls it made. */
export function workerReport(sessionDir: string | undefined, since: string): { path: string; answers: string[]; toolCalls: number } | undefined {
  if (!sessionDir) return undefined;
  try {
    if (!lstatSync(sessionDir).isDirectory()) return undefined;
    const files = readdirSync(sessionDir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => ({ path: join(sessionDir, name), stat: lstatSync(join(sessionDir, name)) }))
      .filter(({ stat }) => stat.isFile())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    for (const { path } of files) {
      const entries = parseSessionEntries(readFileSync(path, 'utf8'));
      if (entries[0]?.type !== 'session') continue;
      const turns = entries.filter((entry): entry is SessionEntry => entry.type !== 'session');
      const byId = new Map(turns.map((entry) => [entry.id, entry]));
      const branch: SessionEntry[] = [];
      const seen = new Set<string>();
      for (let entry = turns.at(-1); entry && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
        seen.add(entry.id);
        branch.push(entry);
      }
      branch.reverse();
      const prompt = branch.findLastIndex((entry) => entry.type === 'message' && entry.message.role === 'user');
      const answers: string[] = [];
      let toolCalls = 0;
      if (prompt >= 0 && Date.parse(branch[prompt]?.timestamp ?? '') >= Date.parse(since)) {
        toolCalls = branch.slice(prompt + 1).filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult').length;
        const turns = branch.slice(prompt + 1).filter((entry) => entry.type === 'message' && entry.message.role === 'assistant');
        for (const entry of turns) {
          if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;
          const message = entry.message;
          const text = message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
          switch (message.stopReason) {
            case 'stop':
              if (text.trim()) answers.push(text);
              break;
            case 'error':
            case 'aborted':
              // A failed turn the worker went on from was retried, so only the one it ended on is its answer.
              if (entry !== turns.at(-1)) break;
              answers.push([`[Worker answer ended with ${message.stopReason}]`, text, message.errorMessage].filter(Boolean).join('\n'));
              break;
            case 'length':
              answers.push([`[Worker answer ended with ${message.stopReason}]`, text, message.errorMessage].filter(Boolean).join('\n'));
              break;
            case 'toolUse':
            case 'pending':
            case 'deferred':
              break;
            default: {
              const unhandled: never = message.stopReason;
              throw new Error(`Unhandled worker stop reason: ${unhandled}`);
            }
          }
        }
      }
      return { path, answers, toolCalls };
    }
  } catch {}
  return undefined;
}
