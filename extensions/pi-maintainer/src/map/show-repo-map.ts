import type { ChatFiles } from '../core/chat-files.ts';
import { requestRepoMap } from '../core/repo-map.ts';
import type { GitPolicy, RepositoryContext } from '../feature.ts';

export type ShowRepoMapResult = { readonly kind: 'skipped' } | { readonly kind: 'exit' };

/**
 * `--show-repo-map`: build through the coder wrapper, print when present, then exit
 * (`aider/main.py:1075-1080`).
 */
export async function runShowRepoMap(input: {
  readonly enabled: boolean;
  readonly root: string;
  readonly files: ChatFiles;
  readonly git: GitPolicy;
  readonly map: RepositoryContext;
  readonly output: (text: string) => void;
  readonly signal?: AbortSignal;
}): Promise<ShowRepoMapResult> {
  if (!input.enabled) return { kind: 'skipped' };
  const text = await requestRepoMap({
    root: input.root,
    files: input.files,
    git: input.git,
    map: input.map,
    curMessageText: '',
    policy: {},
    signal: input.signal,
  });
  if (text) input.output(text);
  return { kind: 'exit' };
}
