import { booleanOption, floatOption, intOption, stringOption } from '../settings/spec.ts';

/** The map SAR's options from `aider/args.py`, with Aider's defaults and help text. */
export const mapOptions = {
  mapTokens: intOption({
    name: 'map-tokens',
    defaultValue: null,
    help: 'Suggested number of tokens to use for repo map, use 0 to disable',
    sar: 'map',
  }),
  mapRefresh: stringOption({
    name: 'map-refresh',
    defaultValue: 'auto',
    choices: ['auto', 'always', 'files', 'manual'],
    help: 'Control how often the repo map is refreshed. Options: auto, always, files, manual (default: auto)',
    sar: 'map',
  }),
  cachePrompts: booleanOption({
    name: 'cache-prompts',
    defaultValue: false,
    negatable: true,
    help: 'Enable caching of prompts (default: False)',
    sar: 'map',
  }),
  mapMultiplierNoFiles: floatOption({
    name: 'map-multiplier-no-files',
    aliases: ['map-mul'],
    defaultValue: 2,
    help: 'Multiplier for map tokens when no files are specified (default: 2)',
    sar: 'map',
  }),
  showRepoMap: booleanOption({
    name: 'show-repo-map',
    defaultValue: false,
    negatable: false,
    help: 'Print the repo map and exit (debug)',
    sar: 'map',
  }),
} as const;

export const mapOptionList = Object.values(mapOptions);
