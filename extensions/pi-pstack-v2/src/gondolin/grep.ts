import * as path from 'node:path';

import type { VM } from '@earendil-works/gondolin';
import { DEFAULT_MAX_BYTES, formatSize, type GrepToolDetails, type GrepToolInput, truncateHead, truncateLine } from '@earendil-works/pi-coding-agent';
import { toGuestPath } from './paths.ts';
import { type GuestFile, matchesToolGlob, signalOption, throwIfAborted, walkGuestFiles } from './search.ts';

const DEFAULT_GREP_LIMIT = 100;
const MIN_GREP_LIMIT = 1;

type TextToolResult<TDetails> = { content: Array<{ type: 'text'; text: string }>; details: TDetails | undefined };
/** One match's output lines, with its context, and whether any of them was cut for length. */
type GrepBlock = { lines: readonly string[]; truncated: boolean };
type GrepSearch = { glob: string | undefined; matcher: (line: string) => boolean; contextLines: number; rootIsDirectory: boolean };

function createLineMatcher(pattern: string, literal: boolean | undefined, ignoreCase: boolean | undefined): (line: string) => boolean {
  if (literal) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
  const regex = new RegExp(pattern, ignoreCase ? 'i' : undefined);
  return (line) => regex.test(line);
}

const splitLines = (content: string): string[] => content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

function grepBlock(lines: readonly string[], displayPath: string, lineIndex: number, contextLines: number): GrepBlock {
  const start = contextLines > 0 ? Math.max(0, lineIndex - contextLines) : lineIndex;
  const end = contextLines > 0 ? Math.min(lines.length - 1, lineIndex + contextLines) : lineIndex;
  const rendered = Array.from({ length: end - start + 1 }, (_, offset) => {
    const index = start + offset;
    const { text, wasTruncated } = truncateLine((lines[index] ?? '').replace(/\r/g, ''));
    const separator = index === lineIndex ? ':' : '-';
    return { line: `${displayPath}${separator}${index + 1}${separator} ${text}`, wasTruncated };
  });
  return { lines: rendered.map((entry) => entry.line), truncated: rendered.some((entry) => entry.wasTruncated) };
}

function* matchingLineIndexes(lines: readonly string[], matcher: (line: string) => boolean, signal: AbortSignal | undefined): Generator<number> {
  for (let index = 0; index < lines.length; index++) {
    throwIfAborted(signal);
    if (matcher(lines[index] ?? '')) yield index;
  }
}

async function* grepBlocks(vm: VM, files: AsyncIterable<GuestFile>, search: GrepSearch, signal: AbortSignal | undefined): AsyncGenerator<GrepBlock> {
  for await (const file of files) {
    if (search.glob && !matchesToolGlob(file.relativePath, search.glob)) continue;
    // A file that cannot be read as text, or vanished, is skipped like the built-in grep skips it.
    const content = await vm.fs.readFile(file.guestPath, { encoding: 'utf8', ...signalOption(signal) }).catch(() => undefined);
    if (content === undefined) continue;
    const lines = splitLines(content);
    const displayPath = search.rootIsDirectory ? file.relativePath : path.posix.basename(file.guestPath);
    for (const index of matchingLineIndexes(lines, search.matcher, signal)) yield grepBlock(lines, displayPath, index, search.contextLines);
  }
}

/** Collects the first `limit` blocks and then stops the source, so the walk ends at the last match it needs. */
async function firstBlocks(blocks: AsyncIterable<GrepBlock>, limit: number): Promise<readonly GrepBlock[]> {
  let taken: readonly GrepBlock[] = [];
  for await (const block of blocks) {
    taken = [...taken, block];
    if (taken.length >= limit) break;
  }
  return taken;
}

function formatGrep(blocks: readonly GrepBlock[], limit: number): TextToolResult<GrepToolDetails> {
  const truncation = truncateHead(blocks.flatMap((block) => block.lines).join('\n'), { maxLines: Number.MAX_SAFE_INTEGER });
  const limitReached = blocks.length >= limit;
  const linesTruncated = blocks.some((block) => block.truncated);
  const details: GrepToolDetails = {
    ...(limitReached ? { matchLimitReached: limit } : {}),
    ...(linesTruncated ? { linesTruncated: true } : {}),
    ...(truncation.truncated ? { truncation } : {}),
  };
  const notices = [limitReached ? `${limit} matches limit reached` : '', linesTruncated ? 'long lines truncated' : '', truncation.truncated ? `${formatSize(DEFAULT_MAX_BYTES)} limit reached` : ''].filter(Boolean);
  const output = notices.length > 0 ? `${truncation.content}\n\n[${notices.join('. ')}]` : truncation.content;
  return { content: [{ type: 'text', text: output }], details: Object.keys(details).length > 0 ? details : undefined };
}

/** Runs grep over guest files through the VM filesystem, matching the built-in grep's output format and limits. */
export async function executeGondolinGrep(vm: VM, localCwd: string, params: GrepToolInput, signal?: AbortSignal): Promise<TextToolResult<GrepToolDetails>> {
  const root = toGuestPath(localCwd, params.path ?? '.');
  const rootStat = await vm.fs.stat(root, signalOption(signal));
  const search: GrepSearch = {
    glob: params.glob,
    rootIsDirectory: rootStat.isDirectory(),
    matcher: createLineMatcher(params.pattern, params.literal, params.ignoreCase),
    contextLines: params.context && params.context > 0 ? params.context : 0,
  };
  const limit = Math.max(MIN_GREP_LIMIT, params.limit ?? DEFAULT_GREP_LIMIT);
  const blocks = await firstBlocks(grepBlocks(vm, walkGuestFiles(vm, root, signal), search, signal), limit);
  if (blocks.length === 0) return { content: [{ type: 'text', text: 'No matches found' }], details: undefined };
  return formatGrep(blocks, limit);
}
