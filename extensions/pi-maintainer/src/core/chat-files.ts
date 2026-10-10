import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

import type { Notices, WorkingTree } from '../edit/working-tree.ts';
import { pythonSorted } from '../support/python-sort.ts';

/** Aider's two chat-file sets, `abs_fnames` and `abs_read_only_fnames`, as absolute paths in insertion order. */
export interface ChatFiles {
  readonly editable: ReadonlySet<string>;
  readonly readOnly: ReadonlySet<string>;
}

export const emptyChatFiles: ChatFiles = { editable: new Set(), readOnly: new Set() };

export const withEditable = (files: ChatFiles, path: string): ChatFiles => ({ editable: new Set([...files.editable, path]), readOnly: files.readOnly });

export const withoutEditable = (files: ChatFiles, path: string): ChatFiles => ({ editable: new Set([...files.editable].filter((file) => file !== path)), readOnly: files.readOnly });

/** `utils.safe_abs_path`: Python's non-strict `Path.resolve()`, following symlinks in the existing prefix. */
export function safeAbsPath(path: string): string {
  const absolute = isAbsolute(path) ? path : `${process.cwd()}/${path}`;
  try {
    return realpathSync.native(absolute);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') throw error;
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(safeAbsPath(parent), basename(absolute));
  }
}

/** `Coder.abs_root_path`. */
export const absRootPath = (root: string, path: string): string => safeAbsPath(isAbsolute(path) ? path : `${root}/${path}`);

/** `Coder.get_rel_fname`: `os.path.relpath(fname, root)`. */
export function getRelFname(root: string, fname: string): string {
  const relativePath = relative(root, fname);
  return relativePath === '' ? '.' : relativePath;
}

/** `Coder.get_inchat_relative_files`: sorted unique relative paths of the editable files. */
export const inchatRelativeFiles = (root: string, files: ChatFiles): string[] => pythonSorted(new Set([...files.editable].map((file) => getRelFname(root, file))));

/** `utils.find_common_root`. */
export function findCommonRoot(absFnames: readonly string[], cwd: string): string {
  const [only] = absFnames;
  if (absFnames.length === 1 && only !== undefined) return safeAbsPath(dirname(only));
  if (absFnames.length > 1) return safeAbsPath(commonPath(absFnames));
  return safeAbsPath(cwd);
}

/** `os.path.commonpath` for absolute POSIX paths. */
function commonPath(paths: readonly string[]): string {
  const split = paths.map((path) => path.split('/').filter((part) => part !== '' && part !== '.'));
  const shortest = Math.min(...split.map((parts) => parts.length));
  const common: string[] = [];
  for (let index = 0; index < shortest; index += 1) {
    const part = split[0]?.[index];
    if (part === undefined || split.some((parts) => parts[index] !== part)) break;
    common.push(part);
  }
  return `/${common.join('/')}`;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.pdf'];

/** `utils.is_image_file`. */
export const isImageFile = (name: string): boolean => IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension));

const STRERROR: Record<string, readonly [errno: number, text: string]> = {
  ENOENT: [2, 'No such file or directory'],
  EACCES: [13, 'Permission denied'],
  EISDIR: [21, 'Is a directory'],
  ENOTDIR: [20, 'Not a directory'],
};

/** Python's `str(OSError)` for a failed `open(filename)`. */
function osErrorText(error: unknown, filename: string): string {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const known = STRERROR[code];
  if (known === undefined) return error instanceof Error ? error.message : String(error);
  return `[Errno ${known[0]}] ${known[1]}: '${filename}'`;
}

/** `InputOutput.read_image`: base64 text. Its OSError branch precedes the narrower ones, so it reports every failure. */
async function readImage(filename: string, notices: Notices): Promise<string | null> {
  try {
    return (await readFile(filename)).toString('base64');
  } catch (error) {
    notices.error(`${filename}: unable to read: ${osErrorText(error, filename)}`);
    return null;
  }
}

/** `InputOutput.read_text`: images as base64, other files through the working tree. */
export const readText = (filename: string, tree: Pick<WorkingTree, 'read'>, notices: Notices): Promise<string | null> => (isImageFile(filename) ? readImage(filename, notices) : tree.read(filename));
