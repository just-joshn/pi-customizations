import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { plainScalarText } from './yaml-values.ts';

/** A config value as configargparse sees it: one string, or a list of strings. */
export type ConfigValue = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'items'; readonly items: readonly string[] };

export interface ConfigEntry {
  readonly key: string;
  readonly value: ConfigValue;
}

export type ParsedConfig = { readonly ok: true; readonly entries: readonly ConfigEntry[] } | { readonly ok: false; readonly error: string };

/** The Pi spelling of `.aider.conf.yml`. */
export const CONFIG_FILE_NAME = '.pi-maintainer.conf.yml';

function nodeText(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (!isScalar(node)) return String(node);
  const source = typeof node.value === 'string' ? node.value : String(node.value);
  return node.type === 'PLAIN' ? plainScalarText(source) : source;
}

function entryValue(node: unknown): ConfigValue | null {
  if (isSeq(node)) return { kind: 'items', items: node.items.map((item) => nodeText(item) ?? 'None') };
  if (isMap(node)) return { kind: 'text', text: String(node.toJSON()) };
  const text = nodeText(node);
  return text === null ? null : { kind: 'text', text };
}

/** configargparse's `YAMLConfigFileParser.parse`, with PyYAML's scalar typing. */
export function parseConfigYaml(text: string, path: string): ParsedConfig {
  const document = parseDocument(text, { schema: 'failsafe' });
  const [problem] = document.errors;
  if (problem) return { ok: false, error: `Couldn't parse config file: ${problem.message}` };
  if (!isMap(document.contents)) {
    const found = document.contents === null ? 'NoneType' : isSeq(document.contents) ? 'list' : 'str';
    return { ok: false, error: `The config file doesn't appear to contain 'key: value' pairs (aka. a YAML mapping). yaml.load('${path}') returned type '${found}' instead of 'dict'.` };
  }
  const entries: ConfigEntry[] = [];
  for (const pair of document.contents.items) {
    const value = entryValue(pair.value);
    if (value !== null) entries.push({ key: nodeText(pair.key) ?? 'None', value });
  }
  return { ok: true, entries };
}

/** The directory holding `.git` at or above `cwd`, as Aider's `get_git_root` finds the repository. */
export function findGitRoot(cwd: string): string | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Aider `main`'s default config files, lowest precedence first: home, Git root, then cwd. */
export function defaultConfigFiles(locations: { readonly home: string; readonly gitRoot: string | null; readonly cwd: string }): string[] {
  const searched = [join(resolve(locations.cwd), CONFIG_FILE_NAME)];
  if (locations.gitRoot) {
    const gitConf = join(locations.gitRoot, CONFIG_FILE_NAME);
    if (!searched.includes(gitConf)) searched.push(gitConf);
  }
  searched.push(join(locations.home, CONFIG_FILE_NAME));
  return searched.reverse();
}

/** Aider's `generate_search_path_list(".env", git_root, env_file)`: duplicates keep their last place. */
export function dotenvSearchPath(locations: { readonly home: string; readonly gitRoot: string | null; readonly cwd: string; readonly envFile: string | null }): string[] {
  const files = [join(locations.home, '.env')];
  if (locations.gitRoot) files.push(join(locations.gitRoot, '.env'));
  files.push(resolve(locations.cwd, '.env'));
  if (locations.envFile) files.push(resolve(locations.cwd, locations.envFile));
  return files.filter((file, index) => files.lastIndexOf(file) === index);
}
