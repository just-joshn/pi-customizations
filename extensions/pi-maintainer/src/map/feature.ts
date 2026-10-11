import { readFile } from 'node:fs/promises';

import type { Feature, RepositoryContext } from '../feature.ts';
import { mapCommands } from './commands.ts';
import { createRepositoryContext, type MapRefresh } from './context.ts';
import { mapOptionList, mapOptions } from './options.ts';

function asRefresh(value: string | null): MapRefresh {
  if (value === 'always' || value === 'files' || value === 'manual' || value === 'auto') return value;
  return 'auto';
}

/** The map SAR: `RepositoryContext` over Host/fs with Aider's map options. */
export const mapFeature: Feature<RepositoryContext> & { readonly name: 'map' } = {
  name: 'map',
  options: mapOptionList,
  commands: mapCommands,
  create({ settings, cwd, gitRoot }) {
    const root = gitRoot ?? cwd;
    const mapTokens = settings.value(mapOptions.mapTokens);
    return createRepositoryContext({
      root,
      mapTokens,
      // Model-name wiring lands with install-time policy; explicit tokens still enable the port.
      useRepoMap: mapTokens !== null ? mapTokens > 0 : false,
      maxInputTokens: null,
      maxContextWindow: null,
      mapMulNoFiles: settings.value(mapOptions.mapMultiplierNoFiles) ?? 2,
      mapRefresh: asRefresh(settings.value(mapOptions.mapRefresh)),
      repoContentPrefix: 'Here are summaries of some {other}files present in my git repository.\n\n',
      readText: async (absPath) => {
        try {
          return await readFile(absPath, 'utf8');
        } catch {
          return null;
        }
      },
    });
  },
};

export { createRepositoryContext } from './context.ts';
export { mapOptionList, mapOptions } from './options.ts';
