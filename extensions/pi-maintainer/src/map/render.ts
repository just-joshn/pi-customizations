import type { RankedEntry } from './rank.ts';
import { isTagEntry } from './rank.ts';

/** Truncate each rendered line to 100 characters (`aider/repomap.py:781-782`). */
export function truncateMapLines(text: string): string {
  return `${text
    .split('\n')
    .map((line) => line.slice(0, 100))
    .join('\n')}\n`;
}

/** Filename-only map body when structural TreeContext is unavailable. */
export function renderFilenameMap(relFnames: readonly string[]): string {
  let output = '';
  for (const fname of relFnames) {
    output += `\n${fname}\n`;
  }
  return truncateMapLines(output);
}

/** Render ranked entries; Tag lines of interest are reserved for structural context. */
export function renderRankedMap(entries: readonly RankedEntry[], chatRelFnames: ReadonlySet<string>): string {
  const names: string[] = [];
  for (const entry of entries) {
    const rel = isTagEntry(entry) ? entry.relFname : entry.relFname;
    if (chatRelFnames.has(rel)) continue;
    if (!names.includes(rel)) names.push(rel);
  }
  return renderFilenameMap(names);
}

/**
 * Structural map excerpt for one file. Source lines pass through with no secret redaction;
 * truncation matches Aider's 100-character line cap (`aider/repomap.py:781-782`).
 */
export function formatMapExcerpt(relFname: string, sourceLines: readonly string[]): string {
  const body = sourceLines.map((line) => line.slice(0, 100)).join('\n');
  return truncateMapLines(`\n${relFname}:\n${body}\n`);
}
