import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Roots for Aider-shaped tags query assets (`aider/repomap.py:805-829`). */
export interface QueryAssetRoots {
  readonly languagePackDir: string;
  readonly languagesDir: string;
}

const queriesDir = join(dirname(fileURLToPath(import.meta.url)), 'queries');

/** Packaged copies of `aider/queries/{tree-sitter-language-pack,tree-sitter-languages}`. */
export function packagedQueryAssetRoots(): QueryAssetRoots {
  return {
    languagePackDir: join(queriesDir, 'tree-sitter-language-pack'),
    languagesDir: join(queriesDir, 'tree-sitter-languages'),
  };
}

/**
 * Prefer language-pack `{lang}-tags.scm`, then tree-sitter-languages.
 * Missing assets yield null (no semantic tags for that language).
 */
export function selectTagsQueryPath(lang: string, roots: QueryAssetRoots): string | null {
  const packPath = join(roots.languagePackDir, `${lang}-tags.scm`);
  if (existsSync(packPath)) return packPath;
  const langsPath = join(roots.languagesDir, `${lang}-tags.scm`);
  if (existsSync(langsPath)) return langsPath;
  return null;
}

/** Read the selected tags query text, or null when no asset exists. */
export function readTagsQuery(lang: string, roots: QueryAssetRoots): string | null {
  const path = selectTagsQueryPath(lang, roots);
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
