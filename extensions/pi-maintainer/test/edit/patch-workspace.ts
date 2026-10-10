import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { onTestFinished } from 'vitest';
import type { PatchContext } from '../../src/edit/patch.ts';
import { createWorkingTree, type Notices, type WorkingTree } from '../../src/edit/working-tree.ts';

const sandboxPath = (root: string, path: string): string => resolve(root, path);

export type Notice = readonly [kind: keyof Notices, message: string];

export interface WorkspaceOptions {
  readonly files?: Readonly<Record<string, string>> | undefined;
  readonly dirs?: readonly string[] | undefined;
  readonly dryRun?: boolean | undefined;
  readonly encoding?: string | undefined;
}

export interface Workspace {
  readonly root: string;
  readonly ctx: PatchContext;
  /** The whole working tree, for steps outside the patch format such as authorization's touch. */
  readonly workingTree: WorkingTree;
  /** Every notice so far, with the workspace directory written as `<root>`, as the oracle records them. */
  notices(): Notice[];
  /** Files with their contents and directories with a trailing slash, keyed by relative path. */
  snapshot(): Promise<Record<string, string | null>>;
}

/** Notices that keep every message, in order, with its kind. */
export function recordingNotices(): { readonly io: Notices; readonly recorded: readonly Notice[] } {
  const recorded: Notice[] = [];
  const io: Notices = {
    output: (message) => recorded.push(['output', message]),
    warning: (message) => recorded.push(['warning', message]),
    error: (message) => recorded.push(['error', message]),
  };
  return { io, recorded };
}

async function snapshot(root: string): Promise<Record<string, string | null>> {
  const tree: Record<string, string | null> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const key = relative(root, path).split(sep).join('/');
    if (entry.isDirectory()) tree[`${key}/`] = null;
    else tree[key] = await readFile(path, 'utf8');
  }
  return tree;
}

/** A temporary project directory driven through a real working tree, removed after the test. */
export async function workspace({ files = {}, dirs = [], dryRun = false, encoding = 'utf-8' }: WorkspaceOptions = {}): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-patch-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  for (const dir of dirs) await mkdir(sandboxPath(root, dir), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const full = sandboxPath(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  const { io, recorded } = recordingNotices();
  const workingTree = createWorkingTree({ notices: io, dryRun, encoding });
  return {
    root,
    ctx: { absRootPath: (path) => sandboxPath(root, path), io, tree: workingTree },
    workingTree,
    notices: () => recorded.map(([kind, message]) => [kind, message.replaceAll(root, '<root>')]),
    snapshot: () => snapshot(root),
  };
}
