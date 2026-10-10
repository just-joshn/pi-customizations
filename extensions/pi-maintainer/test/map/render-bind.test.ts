import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { requestRepoMap } from '../../src/core/repo-map.ts';
import { disabledGitPolicy } from '../../src/feature.ts';
import { getRepoMapTokens, resolveMapEnablement } from '../../src/map/budget.ts';
import { createRepositoryContext } from '../../src/map/context.ts';
import { addCacheControlHeaders, getRepoMessages } from '../../src/map/prompt-insertion.ts';
import { selectRankedPrefix, estimateMapTokens } from '../../src/map/sampled-prefix.ts';
import { createTagsCache, getCachedTags } from '../../src/map/tags-cache.ts';
import { tag, type Tag } from '../../src/map/tag.ts';
import { renderFilenameMap } from '../../src/map/render.ts';
import type { RankedEntry } from '../../src/map/rank.ts';

const BUDGET_META = {
  aider: [
    'test_models/TestModels.test_get_repo_map_tokens',
    'test_main/TestMain.test_yaml_config_file_loading',
    'test_main/TestMain.test_map_tokens_option',
    'test_main/TestMain.test_map_tokens_option_with_non_zero_value',
  ],
  evidence: ['ev-map/probe/zero-budget-disables-map'],
};

const RENDERED_META = {
  aider: ['test_repomap/TestRepoMap.test_repo_map_refresh_files', 'test_repomap/TestRepoMap.test_repo_map_refresh_auto'],
  evidence: [
    'ev-map/probe/refresh-files-stale-until-forced',
    'ev-map/probe/forced-map',
    'ev-map/boundary/manual-reuses-map-even-when-file-list-changes',
    'ev-map/boundary/auto-cache-key-includes-identifier-hints',
  ],
};

const SEED_META = {
  aider: ['test_repomap/MyClass.test_get_repo_map_all_files'],
  evidence: ['ev-map/probe/global-map'],
};

const RECURSION_META = {
  evidence: ['ev-map/boundary/recursion-error-disables-subsequent-maps'],
};

const MEMORY_META = {
  evidence: ['ev-map/boundary/sqlite-creation-failure-falls-back-to-memory-and-maps'],
};

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pm-map-render-'));
  roots.push(root);
  return root;
}

test('default map budget is one eighth of model input capacity clamped to 1024 through 4096', { meta: BUDGET_META }, () => {
  expect(getRepoMapTokens(null)).toBe(1024);
  expect(getRepoMapTokens(undefined)).toBe(1024);
  expect(getRepoMapTokens(4_000)).toBe(1024);
  expect(getRepoMapTokens(16_384)).toBe(2048);
  expect(getRepoMapTokens(100_000)).toBe(4096);
});

test('positive explicit map budget enables mapping when model policy would disable it', { meta: BUDGET_META }, () => {
  expect(resolveMapEnablement({ explicit: 2048, useRepoMap: false, maxInputTokens: null })).toEqual({ enabled: true, tokens: 2048 });
  expect(resolveMapEnablement({ explicit: 0, useRepoMap: true, maxInputTokens: 16_384 })).toEqual({ enabled: false, tokens: 0 });
  expect(resolveMapEnablement({ explicit: null, useRepoMap: true, maxInputTokens: 16_384 })).toEqual({ enabled: true, tokens: 2048 });
});

test('map selection uses sampled token estimates and binary search for a ranked prefix within fifteen percent of budget', () => {
  const ranked: RankedEntry[] = Array.from({ length: 40 }, (_, index) => ({ relFname: `f${String(index).padStart(2, '0')}.py` }));
  const tokenCount = (text: string) => Math.ceil(text.length / 4);
  const sampled = estimateMapTokens('a\n'.repeat(400), tokenCount);
  expect(sampled).toBeGreaterThan(0);
  const selected = selectRankedPrefix({
    ranked,
    maxMapTokens: 80,
    chatRelFnames: new Set(),
    tokenCount,
    render: (entries) => renderFilenameMap(entries.map((entry) => entry.relFname)),
  });
  const tokens = tokenCount(selected);
  expect(Math.abs(tokens - 80) / 80).toBeLessThan(0.15);
  expect(selected).toContain('f00.py');
});

test('tag cache entries are reused only for the same filename and mtime and are replaced after a miss', () => {
  const cache = createTagsCache({ openPersistent: () => new Map() });
  let loads = 0;
  const load = (): Tag[] => {
    loads += 1;
    return [tag({ relFname: 'a.py', fname: '/repo/a.py', name: 'A', kind: 'def', line: 0 })];
  };
  expect(getCachedTags(cache, '/repo/a.py', 10, load)).toHaveLength(1);
  expect(getCachedTags(cache, '/repo/a.py', 10, load)).toHaveLength(1);
  expect(loads).toBe(1);
  expect(getCachedTags(cache, '/repo/a.py', 11, load)).toHaveLength(1);
  expect(loads).toBe(2);
});

test('manual refresh reuses the last map, files refresh reuses file-set and budget keys, always recomputes, and auto reuses hint-sensitive keys when map processing exceeds one second', { meta: RENDERED_META }, async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'a.py'), 'A = 1\n');
  await writeFile(join(root, 'b.py'), 'B = 2\n');
  let builds = 0;
  const map = createRepositoryContext({
    root,
    mapTokens: 1024,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'manual',
    repoContentPrefix: null,
    readText: async (path) => {
      const { readFile } = await import('node:fs/promises');
      return readFile(path, 'utf8');
    },
    now: () => {
      builds += 1;
      return builds === 1 ? 0 : 2;
    },
  });
  const a = join(root, 'a.py');
  const b = join(root, 'b.py');
  const first = await map.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a, b]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  });
  const second = await map.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  });
  expect(second).toBe(first);

  const filesMap = createRepositoryContext({
    root,
    mapTokens: 1024,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'files',
    repoContentPrefix: null,
    readText: async () => 'x = 1\n',
    now: () => 0,
  });
  const filesFirst = await filesMap.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a, b]),
    mentionedFnames: new Set(['hint.py']),
    mentionedIdents: new Set(['hint']),
  });
  const filesReuse = await filesMap.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a, b]),
    mentionedFnames: new Set(['other.py']),
    mentionedIdents: new Set(['other']),
  });
  expect(filesReuse).toBe(filesFirst);
  const filesMiss = await filesMap.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  });
  expect(filesMiss).not.toBe(filesFirst);

  let alwaysBuilds = 0;
  const alwaysMap = createRepositoryContext({
    root,
    mapTokens: 1024,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'always',
    repoContentPrefix: null,
    readText: async () => 'x = 1\n',
    buildMap: async () => {
      alwaysBuilds += 1;
      return `map-${alwaysBuilds}\n`;
    },
  });
  const alwaysFirst = await alwaysMap.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  });
  const alwaysSecond = await alwaysMap.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  });
  expect(alwaysBuilds).toBe(2);
  expect(alwaysSecond).not.toBe(alwaysFirst);

  let autoClock = 0;
  let autoBuilds = 0;
  const autoMap = createRepositoryContext({
    root,
    mapTokens: 1024,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'auto',
    repoContentPrefix: null,
    readText: async () => 'x = 1\n',
    now: () => {
      autoClock += 1.1;
      return autoClock;
    },
    buildMap: async () => {
      autoBuilds += 1;
      return `auto-${autoBuilds}\n`;
    },
  });
  const autoFirst = await autoMap.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a, b]),
    mentionedFnames: new Set(['hint.py']),
    mentionedIdents: new Set(['ident']),
    refresh: 'auto',
  });
  const autoReuse = await autoMap.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a, b]),
    mentionedFnames: new Set(['hint.py']),
    mentionedIdents: new Set(['ident']),
    refresh: 'auto',
  });
  expect(autoReuse).toBe(autoFirst);
  expect(autoBuilds).toBe(1);
  const autoHintMiss = await autoMap.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([a, b]),
    mentionedFnames: new Set(['other.py']),
    mentionedIdents: new Set(['ident']),
    refresh: 'auto',
  });
  expect(autoBuilds).toBe(2);
  expect(autoHintMiss).toBe('auto-2\n');
});

test('context mode forces map refresh, multiplies the map budget by the no-file multiplier, and resets that multiplier to one', async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'a.py'), 'A = 1\n');
  const state = { mul: 0, tokens: 0 };
  const inspecting = createRepositoryContext({
    root,
    mapTokens: 100,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'auto',
    repoContentPrefix: null,
    readText: async () => 'A = 1\n',
    inspect: (snapshot) => {
      state.mul = snapshot.mapMulNoFiles;
      state.tokens = snapshot.maxMapTokens;
    },
  });
  await inspecting.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([join(root, 'a.py')]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
    expandNoFilesBudget: true,
    forceRefresh: true,
    refresh: 'always',
  });
  expect(state.tokens).toBe(800);
  expect(state.mul).toBe(1);
  await inspecting.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([join(root, 'a.py')]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  });
  expect(state.mul).toBe(1);
  expect(state.tokens).toBe(800);
});

test('repository mapping uses editable and in-root read-only seeds with conversation hints and retries an empty map with fewer hints or seeds', { meta: SEED_META }, async () => {
  const calls: unknown[] = [];
  const map = {
    repoMap: async (request: {
      chatFiles: ReadonlySet<string>;
      otherFiles: ReadonlySet<string>;
      mentionedFnames: ReadonlySet<string>;
      mentionedIdents: ReadonlySet<string>;
    }) => {
      calls.push({
        chat: [...request.chatFiles].sort(),
        other: [...request.otherFiles].sort(),
        fnames: [...request.mentionedFnames].sort(),
        idents: [...request.mentionedIdents].sort(),
      });
      if (calls.length < 3) return null;
      return 'MAP';
    },
  };
  const text = await requestRepoMap({
    root: '/repo',
    files: {
      editable: new Set(['/repo/alpha.py']),
      readOnly: new Set(['/repo/ro.py', '/tmp/external.py']),
    },
    git: { ...disabledGitPolicy, trackedFiles: async () => ['alpha.py', 'ro.py', 'helper_utils.py'] },
    map,
    curMessageText: 'Please inspect helper_utils for the change.\n',
    policy: {},
  });
  expect(text).toBe('MAP');
  expect(calls).toHaveLength(3);
  expect(calls[0]).toMatchObject({
    chat: ['/repo/alpha.py', '/repo/ro.py'],
    fnames: expect.arrayContaining(['helper_utils.py']),
  });
  expect(calls[1]).toMatchObject({ chat: [] });
  expect(calls[2]).toMatchObject({ fnames: [], idents: [] });
});

test('a nonpositive map token budget returns no map text from RepoMap', { meta: BUDGET_META }, async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'a.py'), 'A = 1\n');
  const map = createRepositoryContext({
    root,
    mapTokens: 0,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'auto',
    repoContentPrefix: null,
    readText: async () => 'A = 1\n',
  });
  expect(
    await map.repoMap({
      chatFiles: new Set(),
      otherFiles: new Set([join(root, 'a.py')]),
      mentionedFnames: new Set(),
      mentionedIdents: new Set(),
    }),
  ).toBe(null);
});

test('a RecursionError during map generation is reported and the map budget is set to zero so later maps stay disabled', { meta: RECURSION_META }, async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'a.py'), 'A = 1\n');
  const reports: string[] = [];
  const map = createRepositoryContext({
    root,
    mapTokens: 1024,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'always',
    repoContentPrefix: null,
    readText: async () => 'A = 1\n',
    reportError: (message) => {
      reports.push(message);
    },
    buildMap: async () => {
      const error = new Error('Disabling repo map, git repo too large?');
      error.name = 'RecursionError';
      throw error;
    },
  });
  expect(
    await map.repoMap({
      chatFiles: new Set(),
      otherFiles: new Set([join(root, 'a.py')]),
      mentionedFnames: new Set(),
      mentionedIdents: new Set(),
    }),
  ).toBe(null);
  expect(reports).toEqual(['Disabling repo map, git repo too large?']);
  expect(
    await map.repoMap({
      chatFiles: new Set(),
      otherFiles: new Set([join(root, 'a.py')]),
      mentionedFnames: new Set(),
      mentionedIdents: new Set(),
    }),
  ).toBe(null);
});

test('when persistent tag-cache creation fails, mapping recreates the cache or falls back to an in-memory dictionary and continues producing maps', { meta: MEMORY_META }, () => {
  let opens = 0;
  const cache = createTagsCache({
    openPersistent: () => {
      opens += 1;
      throw new Error('sqlite boom');
    },
    recreatePersistent: () => {
      opens += 1;
      throw new Error('sqlite boom again');
    },
  });
  expect(opens).toBe(2);
  let loads = 0;
  const tags = getCachedTags(cache, '/repo/a.py', 1, () => {
    loads += 1;
    return [tag({ relFname: 'a.py', fname: '/repo/a.py', name: 'A', kind: 'def', line: 0 })];
  });
  expect(tags).toHaveLength(1);
  expect(getCachedTags(cache, '/repo/a.py', 1, () => {
    loads += 1;
    return [];
  })).toHaveLength(1);
  expect(loads).toBe(1);
});

test('the coder inserts the prefixed repository map as a user message followed by an assistant acknowledgment, with optional cache marking after the map chunk', () => {
  const repo = getRepoMessages('Here are summaries of some files present in my git repository.\n\na.py\n');
  expect(repo).toEqual([
    { role: 'user', content: 'Here are summaries of some files present in my git repository.\n\na.py\n' },
    { role: 'assistant', content: "Ok, I won't try and edit those files without asking first." },
  ]);
  const marked = addCacheControlHeaders({
    system: [{ role: 'system', content: 'sys' }],
    examples: [],
    readonlyFiles: [],
    repo,
    done: [],
    chatFiles: [{ role: 'user', content: 'chat' }],
    cur: [],
    reminder: [],
  });
  const lastRepo = marked.repo.at(-1);
  expect(lastRepo?.content).toEqual([
    {
      type: 'text',
      text: "Ok, I won't try and edit those files without asking first.",
      cache_control: { type: 'ephemeral' },
    },
  ]);
});

test('filename-only map entries truncate each rendered line to 100 characters without claiming TreeContext parent slices', async () => {
  const root = await tempRoot();
  await mkdir(join(root, 'pkg'));
  const long = `${'x'.repeat(120)}.py`;
  await writeFile(join(root, long), 'X = 1\n');
  await writeFile(join(root, 'pkg', 'mod.py'), 'def hello():\n    return 1\n');
  const map = createRepositoryContext({
    root,
    mapTokens: 1024,
    useRepoMap: true,
    maxInputTokens: 16_384,
    maxContextWindow: 32_768,
    mapMulNoFiles: 8,
    mapRefresh: 'always',
    repoContentPrefix: 'Here are summaries of some files present in my git repository.\n\n',
    readText: async (path) => {
      const { readFile } = await import('node:fs/promises');
      return readFile(path, 'utf8');
    },
  });
  const text = await map.repoMap({
    chatFiles: new Set(),
    otherFiles: new Set([join(root, long), join(root, 'pkg', 'mod.py')]),
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  });
  expect(text).toContain('pkg/mod.py');
  expect(text?.split('\n').every((line) => line.length <= 100)).toBe(true);
  expect(text).not.toContain('│');
});
