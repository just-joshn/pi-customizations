import { relative, resolve } from 'node:path';

import { sortedUnique } from '../support/pybuiltins.ts';

/**
 * Ports of the `Coder` path methods in `aider/coders/base_coder.py` that the edit formats call.
 * `root` and every chat path must already be canonical (symlinks resolved), because Aider
 * resolves them with `Path.resolve()` when files join the chat and these ports do not.
 */
export interface ChatFiles {
  readonly root: string;
  /** Aider's `abs_fnames`: the absolute paths of the editable chat files. */
  readonly absFnames: ReadonlySet<string>;
}

/** `Coder.abs_root_path`. */
export const absRootPath = (root: string, path: string): string => resolve(root, path);

/** `Coder.get_rel_fname`: `os.path.relpath`, which spells the root itself as `.`. */
export const getRelFname = (root: string, fname: string): string => relative(root, fname) || '.';

/** `Coder.get_inchat_relative_files`. */
export const getInchatRelativeFiles = ({ root, absFnames }: ChatFiles): string[] => sortedUnique([...absFnames].map((fname) => getRelFname(root, fname)));
