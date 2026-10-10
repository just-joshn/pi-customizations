import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { requestRepoMap } from '../../src/core/repo-map.ts';
import { disabledGitPolicy, type MapRequest } from '../../src/feature.ts';
import { effectiveMapBudget, getRepoMapTokens, resolveMapEnablement } from '../../src/map/budget.ts';
import { createRepositoryContext } from '../../src/map/context.ts';
import { mapFeature } from '../../src/map/feature.ts';
import { resolveUseRepoMap } from '../../src/map/mapping-policy.ts';
import { mapOptions } from '../../src/map/options.ts';
import { filenameOnlyEntries } from '../../src/map/rank.ts';
import { renderFilenameMap, truncateMapLines } from '../../src/map/render.ts';
import { lexicalReferenceTags, type Tag } from '../../src/map/tag.ts';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pm-map-'));
  roots.push(root);
  return root;
}

test('repository mapping defaults off unless packaged settings or heuristics enable it', () => {
  expect(resolveUseRepoMap('gpt-3.5-turbo')).toBe(false);
  expect(resolveUseRepoMap('unknown-local-model')).toBe(false);
  expect(resolveUseRepoMap('gpt-4o')).toBe(true);
  expect(resolveUseRepoMap('openai/gpt-4.1')).toBe(true);
  expect(resolveUseRepoMap('provider/custom-diff-model')).toBe(false);
  expect(resolveUseRepoMap('openai/o3-mini')).toBe(true);
});

test('default map budget is one eighth of capacity clamped to 1024 through 4096', () => {
  expect(getRepoMapTokens(null)).toBe(1024);
  expect(getRepoMapTokens(undefined)).toBe(1024);
  expect(getRepoMapTokens(4_000)).toBe(1024);
  expect(getRepoMapTokens(16_384)).toBe(2048);
  expect(getRepoMapTokens(100_000)).toBe(4096);
});

test('positive explicit map budget enables mapping when model policy would disable it', () => {
  expect(resolveMapEnablement({ explicit: 2048, useRepoMap: false, maxInputTokens: null })).toEqual({ enabled: true, tokens: 2048 });
  expect(resolveMapEnablement({ explicit: 0, useRepoMap: true, maxInputTokens: 16_384 })).toEqual({ enabled: false, tokens: 0 });
  expect(resolveMapEnablement({ explicit: null, useRepoMap: false, maxInputTokens: 16_384 })).toEqual({ enabled: false, tokens: 2048 });
  expect(resolveMapEnablement({ explicit: null, useRepoMap: true, maxInputTokens: 16_384 })).toEqual({ enabled: true, tokens: 2048 });
});

test('without chat files the configured multiplier expands the map budget subject to context capacity minus 4096', () => {
  expect(
    effectiveMapBudget({
      maxMapTokens: 1024,
      mapMulNoFiles: 8,
      maxContextWindow: 32_768,
      chatFilesEmpty: true,
      expandNoFilesBudget: false,
    }),
  ).toBe(8192);
  expect(
    effectiveMapBudget({
      maxMapTokens: 1024,
      mapMulNoFiles: 8,
      maxContextWindow: 10_000,
      chatFilesEmpty: true,
      expandNoFilesBudget: false,
    }),
  ).toBe(5904);
  expect(
    effectiveMapBudget({
      maxMapTokens: 1024,
      mapMulNoFiles: 8,
      maxContextWindow: null,
      chatFilesEmpty: true,
      expandNoFilesBudget: false,
    }),
  ).toBe(1024);
  expect(
    effectiveMapBudget({
      maxMapTokens: 1024,
      mapMulNoFiles: 8,
      maxContextWindow: 32_768,
      chatFilesEmpty: false,
      expandNoFilesBudget: true,
    }),
  ).toBe(8192);
});

test('lexical fallback emits reference tags at line minus one when definitions lack references', () => {
  const defs: Tag[] = [{ relFname: 'a.py', fname: '/repo/a.py', name: 'Helper', kind: 'def', line: 0 }];
  const refs = lexicalReferenceTags({
    relFname: 'a.py',
    fname: '/repo/a.py',
    code: 'class Helper:\n    def run(self):\n        return Helper()\n',
    names: ['Helper', 'run', 'self', 'return'],
  });
  expect(refs.every((tag) => tag.kind === 'ref' && tag.line === -1)).toBe(true);
  expect(refs.map((tag) => tag.name)).toEqual(['Helper', 'run', 'self', 'return']);
  expect(defs[0]?.kind).toBe('def');
});

test('filename-only rank and render list other files truncated to 100 characters', () => {
  const ranked = filenameOnlyEntries(['z.py', 'a.py']);
  expect(ranked).toEqual([{ relFname: 'a.py' }, { relFname: 'z.py' }]);
  const long = `${'x'.repeat(120)}.py`;
  const text = renderFilenameMap([long, 'short.py']);
  expect(text).toContain('short.py');
  expect(truncateMapLines(`${'y'.repeat(150)}\n`).split('\n')[0]?.length).toBe(100);
});

test('repository context returns null when disabled by tokens or missing other files', async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'other.py'), 'x = 1\n');
  const disabled = createRepositoryContext({
    root,
    mapTokens: 0,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'auto',
    repoContentPrefix: null,
    readText: async () => 'x = 1\n',
  });
  const request: MapRequest = {
    chatFiles: new Set(),
    otherFiles: new Set([join(root, 'other.py')]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  };
  expect(await disabled.repoMap(request)).toBe(null);

  const emptyOther = createRepositoryContext({
    root,
    mapTokens: 1024,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'auto',
    repoContentPrefix: null,
    readText: async () => 'x = 1\n',
  });
  expect(await emptyOther.repoMap({ ...request, otherFiles: new Set() })).toBe(null);
});

test('repository context expands no-files budget and returns a filename map', async () => {
  const root = await tempRoot();
  await mkdir(join(root, 'pkg'));
  await writeFile(join(root, 'pkg', 'mod.py'), 'def hello():\n    return 1\n');
  await writeFile(join(root, 'util.py'), 'VALUE = 2\n');
  const map = createRepositoryContext({
    root,
    mapTokens: 1024,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'auto',
    repoContentPrefix: 'Here are summaries of some files present in my git repository.\n\n',
    readText: async (path) => {
      const { readFile } = await import('node:fs/promises');
      return readFile(path, 'utf8');
    },
  });
  const text = await map.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([join(root, 'pkg', 'mod.py'), join(root, 'util.py')]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
    expandNoFilesBudget: false,
  });
  expect(text).toContain('Here are summaries of some files present in my git repository.');
  expect(text).toContain('pkg/mod.py');
  expect(text).toContain('util.py');
});

test('disabled map policy never calls the repository-context port', async () => {
  let called = 0;
  const map = {
    repoMap: async () => {
      called += 1;
      return 'MAP';
    },
  };
  expect(
    await requestRepoMap({
      root: '/repo',
      files: { editable: new Set(['/repo/a.py']), readOnly: new Set() },
      git: disabledGitPolicy,
      map,
      curMessageText: 'x\n',
      policy: { disabled: true },
    }),
  ).toBe(null);
  expect(called).toBe(0);
});

test('map feature exposes Aider map options and builds a port', () => {
  expect(mapFeature.name).toBe('map');
  expect(mapFeature.options).toEqual(expect.arrayContaining([mapOptions.mapTokens, mapOptions.mapRefresh, mapOptions.mapMultiplierNoFiles]));
  const port = mapFeature.create({
    settings: {
      value: (option) => option.defaultValue,
      source: () => 'default',
    },
    host: { output: () => {}, warning: () => {}, error: () => {}, confirm: async () => false, select: async () => undefined, exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }) },
    cwd: '/tmp',
    gitRoot: '/tmp',
  });
  expect(port.repoMap).toBeTypeOf('function');
});
