import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Type } from 'typebox';
import { expect, onTestFinished, test } from 'vitest';
import { editOptionList } from '../../src/edit/options.ts';
import { CONFIG_FILE_NAME, dotenvSearchPath, parseConfigYaml } from '../../src/settings/config-files.ts';
import { applyDotenv } from '../../src/settings/dotenv.ts';
import { loadSettings } from '../../src/settings/load.ts';
import type { AnyOptionSpec } from '../../src/settings/spec.ts';
import { pyFloatText } from '../../src/settings/yaml-values.ts';
import { oracleCases, outcomeOf } from '../support/oracle.ts';

const strings = Type.Record(Type.String(), Type.String());
const resolveArgs = Type.Object({
  configs: Type.Optional(Type.Partial(Type.Object({ home: Type.String(), git: Type.String(), cwd: Type.String() }))),
  env: Type.Optional(strings),
  cli: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Literal(true)]))),
  subdir: Type.Optional(Type.String()),
});

async function layout(args: { readonly configs?: Partial<Record<'home' | 'git' | 'cwd', string>>; readonly subdir?: string }) {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-settings-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const places = { home: join(root, 'home'), git: join(root, 'repo'), cwd: join(root, 'repo', args.subdir ?? '') };
  for (const dir of [...Object.values(places), join(places.git, '.git')]) await mkdir(dir, { recursive: true });
  for (const [place, text] of Object.entries(args.configs ?? {})) {
    if (place === 'home' || place === 'git' || place === 'cwd') await writeFile(join(places[place], CONFIG_FILE_NAME), text);
  }
  return places;
}

test.for(oracleCases('settings', 'settings.resolve', resolveArgs))('resolves options like configargparse $id', async ({ args, expected }) => {
  const places = await layout(args);
  const environment = Object.fromEntries(Object.entries(args.env ?? {}).map(([key, value]) => [`PI_MAINTAINER_${key}`, value]));
  const cli = args.cli ?? {};
  const loaded = await loadSettings({ specs: editOptionList, getFlag: (name) => cli[name], processEnvironment: environment, cwd: places.cwd, home: places.home });
  if ('error' in expected) {
    expect(loaded.problems.filter((problem) => !problem.includes('unrecognized option')).length).toBeGreaterThan(0);
    return;
  }
  const specs: readonly AnyOptionSpec[] = editOptionList;
  const values = Object.fromEntries(specs.map((spec) => [spec.name.replace(/-/g, '_'), loaded.settings.value(spec)]));
  const expectedResult = expected.result as Record<string, unknown>;
  expect({ result: Object.fromEntries(Object.keys(expectedResult).map((key) => [key, values[key]])) }).toEqual(expected);
});

/** Python's `str()` of a JSON value from the oracle, as configargparse renders list items. */
function pyStr(value: unknown): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : pyFloatText(value);
  return String(value);
}

test.for(oracleCases('settings', 'settings.yaml_config', Type.Object({ text: Type.String() })))('types YAML values like PyYAML $id', async ({ args, expected }) => {
  const parsed = parseConfigYaml(args.text, 'stream');
  if ('error' in expected) {
    expect(parsed.ok).toBe(false);
    return;
  }
  if (!('result' in expected) || !Array.isArray(expected.result)) throw new Error('settings.yaml_config goldens hold entry lists');
  const rendered = expected.result.map((entry: unknown) => (Array.isArray(entry) ? [entry[0], Array.isArray(entry[1]) ? entry[1].map(pyStr) : entry[1]] : entry));
  expect(parsed.ok ? parsed.entries.map((entry) => [entry.key, entry.value.kind === 'text' ? entry.value.text : entry.value.items]) : parsed.error).toEqual(rendered);
});

test.for(oracleCases('settings', 'settings.dotenv', Type.Object({ text: Type.String(), environment: Type.Optional(strings) })))('loads .env text like python-dotenv $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => applyDotenv(args.text, args.environment ?? {}))).toEqual(expected);
});

const searchArgs = Type.Object({ subdir: Type.Optional(Type.String()), git: Type.Optional(Type.Boolean()), env_file: Type.Optional(Type.String()) });

test.for(oracleCases('settings', 'settings.dotenv_search_path', searchArgs))('orders .env files like Aider $id', async ({ args, expected }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-dotenv-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const cwd = join(repo, args.subdir ?? '');
  const gitRoot = args.git === false ? null : repo;
  const envFile = args.env_file ?? (gitRoot ? join(gitRoot, '.env') : '.env');
  const found = dotenvSearchPath({ home: join(root, 'home'), gitRoot, cwd, envFile });
  expect({ result: found.map((path) => path.replace(root, '<root>')) }).toEqual(expected);
});
