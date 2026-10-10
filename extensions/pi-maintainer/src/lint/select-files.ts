import type { Host } from '../core/host.ts';

/** Aider `cmd_lint` file choice: explicit args, else chat files, else dirty staged∪unstaged. */
export function selectLintRelativeFiles(input: {
  readonly explicit: readonly string[];
  readonly chatFiles: readonly string[];
  readonly dirtyFiles: readonly string[];
}): readonly string[] {
  if (input.explicit.length) return [...input.explicit];
  if (input.chatFiles.length) return [...input.chatFiles];
  return [...input.dirtyFiles];
}

/** `GitRepo.get_dirty_files`: `git diff --name-only --cached` ∪ `git diff --name-only`. */
export async function listDirtyRelativeFiles(host: Host, root: string, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  const staged = await host.exec({
    command: 'git',
    args: ['diff', '--name-only', '--cached'],
    cwd: root,
    ...(signal ? { signal } : {}),
  });
  const unstaged = await host.exec({
    command: 'git',
    args: ['diff', '--name-only'],
    cwd: root,
    ...(signal ? { signal } : {}),
  });
  const files = new Set<string>();
  for (const line of `${staged.stdout}\n${unstaged.stdout}`.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) files.add(trimmed);
  }
  return [...files];
}
