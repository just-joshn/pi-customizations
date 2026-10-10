import type { EditIntent } from '../feature.ts';
import { splitlines, strip } from '../support/pystr.ts';
import { DiffError, ValueError } from './errors.ts';
import { parsePatchText } from './patch-parse.ts';
import { identifyFilesNeeded, norm } from './patch-sections.ts';
import type { Notices, WorkingTree } from './working-tree.ts';

export { applyEdits } from './patch-apply.ts';

/** The values of Aider's `ActionType` enum. */
export type ActionType = 'Add' | 'Delete' | 'Update';

export interface Chunk {
  /** Index into the original file's lines, not into the progressively edited result. */
  readonly origIndex: number;
  readonly delLines: readonly string[];
  readonly insLines: readonly string[];
}

export type PatchAction =
  | { readonly type: 'Add'; readonly path: string; readonly newContent: string }
  | { readonly type: 'Delete'; readonly path: string }
  | { readonly type: 'Update'; readonly path: string; readonly chunks: readonly Chunk[]; readonly movePath: string | null };

/** Common preparation authorizes the first element; the action carries the payload. */
export type EditResult = readonly [path: string, action: PatchAction];

/** Authorization unit for a parsed patch action, including both MOVE endpoints. */
export function editIntent([, action]: EditResult): EditIntent {
  switch (action.type) {
    case 'Add':
      return { kind: 'add', path: action.path };
    case 'Delete':
      return { kind: 'delete', path: action.path };
    case 'Update':
      return action.movePath === null ? { kind: 'update', path: action.path } : { kind: 'move', source: action.path, destination: action.movePath };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export interface Patch {
  readonly actions: ReadonlyMap<string, PatchAction>;
  readonly fuzz: number;
}

/** The `PatchCoder` attributes the patch methods read. */
export interface PatchContext {
  readonly absRootPath: (path: string) => string;
  /** `io.tool_output` and `io.tool_warning`. */
  readonly io: Pick<Notices, 'output' | 'warning'>;
  /** `io.read_text`, `io.write_text`, and the `pathlib` calls, each suppressed by a dry run. */
  readonly tree: Pick<WorkingTree, 'exists' | 'read' | 'write' | 'remove' | 'mkdir'>;
}

const PATCH_LIKE = ['@@', '*** Update File:', '*** Add File:', '*** Delete File:'];

function patchStart(lines: readonly string[], io: PatchContext['io']): number | null {
  if (lines.length >= 2 && norm(lines[0] ?? '').startsWith('*** Begin Patch')) return 1;
  if (!lines.some((line) => PATCH_LIKE.some((prefix) => norm(line).startsWith(prefix)))) {
    io.warning('Response does not appear to be in patch format.');
    return null;
  }
  io.warning("Patch format warning: Missing '*** Begin Patch'/'*** End Patch' sentinels.");
  return 0;
}

async function readCurrentFiles(content: string, { absRootPath, tree }: PatchContext): Promise<ReadonlyMap<string, string>> {
  const currentFiles = new Map<string, string>();
  for (const relPath of identifyFilesNeeded(content)) {
    const fileContent = await tree.read(absRootPath(relPath));
    if (fileContent === null) throw new DiffError(`File referenced in patch not found or could not be read: ${relPath}`);
    currentFiles.set(relPath, fileContent);
  }
  return currentFiles;
}

export async function getEdits(reply: string, ctx: PatchContext): Promise<EditResult[]> {
  if (!strip(reply)) return [];
  const lines = splitlines(reply);
  const startIndex = patchStart(lines, ctx.io);
  if (startIndex === null) return [];
  const currentFiles = await readCurrentFiles(reply, ctx);
  try {
    return [...parsePatchText(lines, startIndex, currentFiles, ctx.io).actions];
  } catch (error) {
    if (error instanceof DiffError) throw new ValueError(`Error parsing patch content: ${error.message}`);
    throw new ValueError(`Unexpected error parsing patch: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `Coder.apply_edits_dry_run`, which `PatchCoder` does not override. */
export function applyEditsDryRun(edits: readonly EditResult[], _context: PatchContext): EditResult[] {
  return [...edits];
}
