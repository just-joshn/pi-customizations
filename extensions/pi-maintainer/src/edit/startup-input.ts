import { lstat } from 'node:fs/promises';

import { absRootPath } from '../core/chat-files.ts';
import type { Notices, WorkingTree } from './working-tree.ts';

export interface AdmitInitialEditableOptions {
  readonly cwd: string;
  readonly tree: Pick<WorkingTree, 'exists' | 'touch'>;
  readonly host: Notices;
  readonly allowCreation: boolean;
  readonly isOrdinaryFile?: (path: string) => Promise<boolean>;
  /** Aider `self.repo.git_ignored_file`: skip explicitly named ignored files unless admitted. */
  readonly isGitIgnored?: (path: string) => Promise<boolean>;
  /** Aider `add_gitignore_files`, which lets an explicitly named ignored file join the chat. */
  readonly addGitignoreFiles?: boolean;
}

async function defaultIsOrdinaryFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

/** Admit `--file` paths the way Aider's `Coder.__init__` does for `fnames`. */
export async function admitInitialEditable(paths: readonly string[], options: AdmitInitialEditableOptions): Promise<string[]> {
  const isOrdinaryFile = options.isOrdinaryFile ?? defaultIsOrdinaryFile;
  const editable: string[] = [];
  for (const path of paths) {
    const full = absRootPath(options.cwd, path);
    if (options.isGitIgnored && !options.addGitignoreFiles && (await options.isGitIgnored(path))) {
      options.host.warning(`Skipping ${path} that matches gitignore spec.`);
      continue;
    }
    if (!(await options.tree.exists(full))) {
      if (!options.allowCreation) {
        options.host.warning(`Recovery refused startup creation of ${path}.`);
        continue;
      }
      if (!(await options.tree.touch(full))) {
        options.host.warning(`Can not create ${path}, skipping.`);
        continue;
      }
      options.host.output(`Creating empty file ${path}`);
    }
    if (!(await isOrdinaryFile(full))) {
      options.host.warning(`Skipping ${path} that is not a normal file.`);
      continue;
    }
    editable.push(full);
  }
  return editable;
}

/** Read `--message-file` text through the working tree encoding, or report and return null. */
export async function readMessageFile(path: string, tree: Pick<WorkingTree, 'exists' | 'read'>, host: Notices): Promise<string | null> {
  if (!(await tree.exists(path))) {
    host.error(`Message file not found: ${path}`);
    return null;
  }
  const text = await tree.read(path);
  if (text === null) {
    host.error(`Error reading message file: ${path}`);
    return null;
  }
  return text;
}
