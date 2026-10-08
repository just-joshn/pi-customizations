export const SOURCE_PREFIX = 'pstack/';

const legacyLowercase = new Set(['automations/benny/FOR_AGENTS.md', 'automations/benny/README.md']);

export const relativeSourcePath = (path) => path.slice(SOURCE_PREFIX.length).replace('.cursor-plugin/', 'plugin-metadata/');

export function normalizeSource(relative, source) {
  const text = source.toString('utf8');
  if (!Buffer.from(text).equals(source)) return source;
  const generic = text.replaceAll('Cursor', 'Reference').replaceAll('cursor-team-kit', 'team-kit').replaceAll('.cursor', '.upstream').replaceAll('@cursor-skill', '@upstream-skill');
  const legacy = legacyLowercase.has(relative) ? generic.replace(/\bcursor\b/g, 'reference') : generic;
  const corrected = relative.startsWith('skills/poteto-mode/scripts/watch-pr/') ? legacy.replaceAll('endReference', 'endCursor') : legacy;
  return Buffer.from(corrected);
}
