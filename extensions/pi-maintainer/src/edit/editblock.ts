/**
 * Aider's SEARCH/REPLACE edit format (`diff`, and `diff-fenced`, which differs only in its
 * prompts), ported from `aider/coders/editblock_coder.py` with its function boundaries.
 */
import { basename } from 'node:path';

import { AttributeError, pyIndex } from '../support/pybuiltins.ts';
import { splitlines, strip } from '../support/pystr.ts';
import { type ChatFiles, getInchatRelativeFiles, getRelFname } from './coder-paths.ts';
import { findSimilarLines, replaceMostSimilarChunk } from './editblock-match.ts';
import { DEFAULT_FENCE, type EditBlock, type Fence, findOriginalUpdateBlocks, type ParsedBlock, type ShellBlock } from './editblock-parse.ts';
import { ValueError } from './errors.ts';
import type { WorkingTree } from './working-tree.ts';

export { DEFAULT_FENCE, type EditBlock, type Fence, type ParsedBlock, type ShellBlock } from './editblock-parse.ts';

const isShellBlock = (edit: ParsedBlock): edit is ShellBlock => edit[0] === null;
const isFileEdit = (edit: ParsedBlock): edit is EditBlock => edit[0] !== null;

/** File edits plus shell fences as `PathEdit` with `path: null` for the edit pipeline. */
export function pathEditsFromReply(reply: string, ctx: Pick<EditBlockContext, 'fence' | 'root' | 'absFnames'>): ParsedBlock[] {
  const { edits, shellCommands } = getEdits(reply, ctx);
  return [...edits, ...shellCommands.map((command): ShellBlock => [null, command])];
}

/** The `EditBlockCoder` attributes that its methods read. */
export interface EditBlockContext extends ChatFiles {
  readonly fence: Fence;
  /** `Coder.abs_root_path`. Supplied by the host so symlink policy stays outside this module. */
  readonly absRootPath: (path: string) => string;
  /** Aider's `io`. A dry-run tree makes `write_text` and `touch` no-ops, as `--dry-run` does. */
  readonly tree: Pick<WorkingTree, 'read' | 'write' | 'exists' | 'touch'>;
}

export interface ParsedEdits {
  readonly edits: EditBlock[];
  /** Commands from shell-language fences, which Aider appends to `shell_commands`. */
  readonly shellCommands: string[];
}

const isEditBlock = (block: ParsedBlock): block is EditBlock => block[0] !== null;

/** `EditBlockCoder.get_edits`. Throws `ValueError` for a malformed SEARCH/REPLACE block. */
export function getEdits(reply: string, ctx: Pick<EditBlockContext, 'fence' | 'root' | 'absFnames'>): ParsedEdits {
  const blocks = findOriginalUpdateBlocks(reply, ctx.fence, getInchatRelativeFiles(ctx));
  return { edits: blocks.filter(isEditBlock), shellCommands: blocks.flatMap((block) => (block[0] === null ? [block[1]] : [])) };
}

/**
 * Given an input string which may have extra "wrapping" around it, remove the wrapping: a first
 * line that ends with the file's name, and an opening and closing fence.
 */
export function stripQuotedWrapping(res: string, fname: string | null = null, fence: Fence = DEFAULT_FENCE): string {
  if (!res) return res;
  let lines = splitlines(res);
  if (fname && strip(pyIndex(lines, 0)).endsWith(basename(fname))) lines = lines.slice(1);
  if (pyIndex(lines, 0).startsWith(fence[0]) && pyIndex(lines, -1).startsWith(fence[1])) lines = lines.slice(1, -1);
  const text = lines.join('\n');
  return text && !text.endsWith('\n') ? `${text}\n` : text;
}

/** Applies one block to `content`. An empty SEARCH appends, creating `fname` when it is missing. */
export async function doReplace(fname: string, content: string | null, beforeText: string, afterText: string, fence: Fence, tree: Pick<WorkingTree, 'exists' | 'touch'>): Promise<string | null> {
  const before = stripQuotedWrapping(beforeText, fname, fence);
  const after = stripQuotedWrapping(afterText, fname, fence);
  let current = content;
  if (!(await tree.exists(fname)) && !strip(before)) {
    await tree.touch(fname);
    current = '';
  }
  if (current === null) return null;
  if (!strip(before)) return current + after;
  return replaceMostSimilarChunk(current, before, after);
}

interface Resolution {
  readonly path: string;
  readonly fullPath: string;
  readonly newContent: string | null;
}

/** Reads earlier blocks' results first so preflight targets match sequential application. */
function withVirtualResults(tree: EditBlockContext['tree'], dryRun: boolean): EditBlockContext['tree'] {
  const virtual = new Map<string, string>();
  return {
    read: async (path) => {
      const hit = virtual.get(path);
      return hit === undefined ? tree.read(path) : hit;
    },
    write: async (path, content) => {
      virtual.set(path, content);
      if (!dryRun) await tree.write(path, content);
    },
    exists: async (path) => virtual.has(path) || tree.exists(path),
    touch: async (path) => {
      if (!virtual.has(path)) virtual.set(path, '');
      return tree.touch(path);
    },
  };
}

async function replaceInChatFiles([, original, updated]: EditBlock, ctx: EditBlockContext): Promise<Resolution | null> {
  for (const fullPath of ctx.absFnames) {
    const newContent = await doReplace(fullPath, await ctx.tree.read(fullPath), original, updated, ctx.fence, ctx.tree);
    // Aider's `if new_content:` treats "" as no match.
    if (newContent) return { path: getRelFname(ctx.root, fullPath), fullPath, newContent };
  }
  return null;
}

/** Tries the named file, then, unless SEARCH is blank, every editable chat file in turn. */
async function resolveEdit(edit: EditBlock, ctx: EditBlockContext): Promise<Resolution> {
  const [path, original, updated] = edit;
  const fullPath = ctx.absRootPath(path);
  let newContent: string | null = null;
  if (await ctx.tree.exists(fullPath)) {
    newContent = await doReplace(fullPath, await ctx.tree.read(fullPath), original, updated, ctx.fence, ctx.tree);
  }
  if (!newContent && strip(original)) {
    const elsewhere = await replaceInChatFiles(edit, ctx);
    if (elsewhere) return elsewhere;
  }
  return { path, fullPath, newContent };
}

interface Outcome {
  readonly updatedEdits: EditBlock[];
  readonly passed: EditBlock[];
  readonly failed: EditBlock[];
}

async function resolveEdits(edits: readonly EditBlock[], ctx: EditBlockContext, dryRun: boolean): Promise<Outcome> {
  const resolving = { ...ctx, tree: withVirtualResults(ctx.tree, dryRun) };
  const updatedEdits: EditBlock[] = [];
  const passed: EditBlock[] = [];
  const failed: EditBlock[] = [];
  for (const edit of edits) {
    const { path, fullPath, newContent } = await resolveEdit(edit, resolving);
    updatedEdits.push([path, edit[1], edit[2]]);
    if (newContent) {
      await resolving.tree.write(fullPath, newContent);
      passed.push(edit);
    } else {
      failed.push(edit);
    }
  }
  return { updatedEdits, passed, failed };
}

function failedBlockReport([path, original, updated]: EditBlock, content: string | null, fence: Fence): string {
  let res = `\n## SearchReplaceNoExactMatch: This SEARCH block failed to exactly match lines in ${path}\n<<<<<<< SEARCH\n${original}=======\n${updated}>>>>>>> REPLACE\n\n`;
  // Aider passes an unreadable file's None content to find_similar_lines, which raises this.
  if (content === null) throw new AttributeError("'NoneType' object has no attribute 'splitlines'");
  const didYouMean = findSimilarLines(original, content);
  if (didYouMean) res += `Did you mean to match some of these actual lines from ${path}?\n\n${fence[0]}\n${didYouMean}\n${fence[1]}\n\n`;
  if (content.includes(updated) && updated) res += `Are you sure you need this SEARCH/REPLACE block?\nThe REPLACE lines are already in ${path}!\n\n`;
  return res;
}

async function failureReport(failed: readonly EditBlock[], passed: readonly EditBlock[], ctx: EditBlockContext): Promise<string> {
  const blocks = failed.length === 1 ? 'block' : 'blocks';
  let res = `# ${failed.length} SEARCH/REPLACE ${blocks} failed to match!\n`;
  for (const edit of failed) {
    const content = await ctx.tree.read(ctx.absRootPath(edit[0]));
    res += failedBlockReport(edit, content, ctx.fence);
  }
  res += 'The SEARCH section must exactly match an existing block of lines including all white space, comments, indentation, docstrings, etc\n';
  if (passed.length > 0) {
    const pblocks = passed.length === 1 ? 'block' : 'blocks';
    res += `\n# The other ${passed.length} SEARCH/REPLACE ${pblocks} were applied successfully.\nDon't re-send them.\nJust reply with fixed versions of the ${blocks} above that failed to match.\n`;
  }
  return res;
}

/**
 * `EditBlockCoder.apply_edits_dry_run`: resolves each edit against cumulative virtual results of
 * earlier blocks without writing, and returns the edits with the path the cross-file fallback chose.
 * Shell blocks pass through unchanged and are never written.
 */
export async function applyEditsDryRun(edits: readonly ParsedBlock[], ctx: EditBlockContext): Promise<ParsedBlock[]> {
  const shells = edits.filter(isShellBlock);
  const files = edits.filter(isFileEdit);
  return [...(await resolveEdits(files, ctx, true)).updatedEdits, ...shells];
}

/**
 * `EditBlockCoder.apply_edits`: writes each matching edit in order, then throws `ValueError`
 * with Aider's failure report when any block failed. Edits that matched stay written.
 * Shell blocks are ignored (forwarded later via the validation port).
 */
export async function applyEdits(edits: readonly ParsedBlock[], ctx: EditBlockContext): Promise<void> {
  const files = edits.filter(isFileEdit);
  const { passed, failed } = await resolveEdits(files, ctx, false);
  if (failed.length === 0) return;
  throw new ValueError(await failureReport(failed, passed, ctx));
}
