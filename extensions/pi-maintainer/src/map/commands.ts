import { chatFilesOf } from '../core/branch.ts';
import type { CommandEnv, CommandSpec } from '../core/command.ts';
import { requestRepoMap } from '../core/repo-map.ts';

async function wrapperMap(env: CommandEnv, forceRefresh: boolean): Promise<string | null> {
  return requestRepoMap({
    root: env.snapshot.root,
    files: chatFilesOf(env.snapshot),
    git: env.git,
    map: env.map,
    curMessageText: '',
    policy: { forceRefresh },
  });
}

/** Slash commands owned by the map SAR (`/map`, `/map-refresh`). */
export const mapCommands: readonly CommandSpec[] = [
  {
    name: 'map',
    description: 'Print out the current repository map',
    async run(_args, env) {
      const repoMap = await wrapperMap(env, false);
      env.host.output(repoMap ?? 'No repository map available.');
    },
  },
  {
    name: 'map-refresh',
    description: 'Force a refresh of the repository map',
    async run(_args, env) {
      const repoMap = await wrapperMap(env, true);
      if (repoMap) env.host.output('The repo map has been refreshed, use /map to view it.');
    },
  },
];
