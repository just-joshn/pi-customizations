import { readFile } from 'node:fs/promises';

import type { Feature, RepositoryContext } from '../feature.ts';
import { mapCommands } from './commands.ts';
import { createRepositoryContext, type MapRefresh } from './context.ts';
import { mapOptionList, mapOptions } from './options.ts';

function asRefresh(value: string | null): MapRefresh {
  if (value === 'always' || value === 'files' || value === 'manual' || value === 'auto') return value;
  return 'auto';
}

/** Aider `main.py:954`: `--cache-prompts` turns the automatic refresh policy into `files`. */
export function effectiveMapRefresh(refresh: MapRefresh, cachePrompts: boolean): MapRefresh {
  return cachePrompts && refresh === 'auto' ? 'files' : refresh;
}

/** The map SAR: `RepositoryContext` over Host/fs with Aider's map options. */
export const mapFeature: Feature<RepositoryContext> & { readonly name: 'map' } = {
  name: 'map',
  options: mapOptionList,
  commands: mapCommands,
  create({ settings, cwd, gitRoot }) {
    const root = gitRoot ?? cwd;
    const mapTokens = settings.value(mapOptions.mapTokens);
    const cachePrompts = settings.value(mapOptions.cachePrompts);
    const requestedRefresh = asRefresh(settings.value(mapOptions.mapRefresh));
    const mapRefresh = effectiveMapRefresh(requestedRefresh, cachePrompts);
    const cacheRefresh: 'files' | null = mapRefresh === requestedRefresh ? null : 'files';
    const context = createRepositoryContext({
      root,
      mapTokens,
      // Model-name wiring lands with install-time policy; explicit tokens still enable the port.
      useRepoMap: mapTokens !== null ? mapTokens > 0 : false,
      maxInputTokens: null,
      maxContextWindow: null,
      mapMulNoFiles: settings.value(mapOptions.mapMultiplierNoFiles) ?? 2,
      mapRefresh,
      repoContentPrefix: 'Here are summaries of some {other}files present in my git repository.\n\n',
      readText: async (absPath) => {
        try {
          return await readFile(absPath, 'utf8');
        } catch {
          return null;
        }
      },
    });
    return {
      repoMap: (request, signal) => context.repoMap(cacheRefresh !== null && (request.refresh ?? 'auto') === 'auto' ? { ...request, refresh: cacheRefresh } : request, signal),
    };
  },
};

export { createRepositoryContext } from './context.ts';
export { mapOptionList, mapOptions } from './options.ts';
