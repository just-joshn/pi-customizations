import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSessionEntries, type SessionEntry } from '@earendil-works/pi-coding-agent';

export function workerReport(sessionDir: string | undefined, since: string): { path: string; answers: string[] } | undefined {
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
      // A resume that fails before appending its prompt must not replay the previous invocation's report.
      if (prompt >= 0 && Date.parse(branch[prompt]?.timestamp ?? '') >= Date.parse(since)) {
        for (const entry of branch.slice(prompt + 1)) {
          if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;
          const message = entry.message;
          if (message.stopReason !== 'stop' && message.stopReason !== 'length') continue;
          const text = message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
          if (text.trim()) answers.push(text);
        }
      }
      return { path, answers };
    }
  } catch {
    // Startup failures and removed or unreadable sessions still have their ordinary stdout/stderr report.
  }
  return undefined;
}
