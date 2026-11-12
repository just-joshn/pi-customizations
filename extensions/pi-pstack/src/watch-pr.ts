import { existsSync } from 'node:fs';

export type {
  PullRequestFacts, Check, ReviewThread, RawReviewThread, PrContext, PrNumber,
} from './vendor-types/watch-pr/types.js';

type Watcher = {
  github: typeof import('./vendor-types/watch-pr/github.js');
  types: typeof import('./vendor-types/watch-pr/types.js');
};
let watcher: Promise<Watcher> | undefined;

export function loadWatcher(): Promise<Watcher> {
  return watcher ??= (async () => {
    const built = new URL('../dist/watch-pr/', import.meta.url);
    const directory = existsSync(new URL('github.js', built)) && existsSync(new URL('types.js', built))
      ? built : new URL('../skills/poteto-mode/scripts/watch-pr/', import.meta.url);
    const extension = directory === built ? 'js' : 'ts';
    const [github, types] = await Promise.all([
      import(new URL(`github.${extension}`, directory).href),
      import(new URL(`types.${extension}`, directory).href),
    ]);
    return { github, types };
  })();
}
