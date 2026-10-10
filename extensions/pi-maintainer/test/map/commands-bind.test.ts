import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { chatFilesOf } from '../../src/core/branch.ts';
import type { CommandEnv } from '../../src/core/command.ts';
import { disabledGitPolicy, type MapRequest, type RepositoryContext } from '../../src/feature.ts';
import { effectiveMapBudget } from '../../src/map/budget.ts';
import { mapCommands } from '../../src/map/commands.ts';
import { mapFeature } from '../../src/map/feature.ts';
import { mapOptions } from '../../src/map/options.ts';
import { formatMapExcerpt } from '../../src/map/render.ts';
import { runShowRepoMap } from '../../src/map/show-repo-map.ts';
import { formatRepositoryMapTokenLine, tokensRepoMapContent } from '../../src/map/tokens-map.ts';
import { resolveSettings } from '../../src/settings/resolve.ts';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pm-map-cmd-'));
  roots.push(root);
  return root;
}

function snapshot(root: string, files: { editable?: string[]; readOnly?: string[] }): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'whole',
    phase: { kind: 'main' },
    files: { editable: files.editable ?? [], readOnly: files.readOnly ?? [] },
    originalReadOnly: files.readOnly ?? [],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: null,
    historyThrough: null,
    physicalModel: null,
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'idle' },
  };
}

function commandEnv(options: {
  readonly snapshot: Snapshot;
  readonly map: RepositoryContext;
  readonly outputs?: string[];
}): CommandEnv {
  const outputs = options.outputs ?? [];
  return {
    host: {
      output: (text: string) => outputs.push(text),
      warning() {},
      error() {},
      confirm: async () => false,
      select: async () => undefined,
      exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    },
    snapshot: options.snapshot,
    save() {},
    tree: { dryRun: false, read: async () => null, write: async () => {}, exists: async () => true, touch: async () => true, remove: async () => {}, mkdir: async () => {}, mutate: async (_paths, operation) => operation({ dryRun: false, read: async () => null, write: async () => {}, exists: async () => true, touch: async () => true, remove: async () => {}, mkdir: async () => {}, mutate: async () => {
      throw new Error('nested mutate');
    } }) },
    git: disabledGitPolicy,
    map: options.map,
    autoCommits: true,
    supportsImages: true,
    sendUserMessage: async () => {},
    setPhysicalModel: async () => false,
    findPhysicalModel: () => null,
    defaultEditFormat: () => 'whole',
  };
}

test(
  '/map builds the repository map through the coder wrapper and prints the resulting map text',
  async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'other.py'), 'x = 1\n');
    const calls: MapRequest[] = [];
    const map: RepositoryContext = {
      repoMap: async (request) => {
        calls.push(request);
        return 'MAP BODY';
      },
    };
    const outputs: string[] = [];
    const run = mapCommands.find((command) => command.name === 'map');
    expect(run).toBeDefined();
    await run!.run('', commandEnv({ snapshot: snapshot(root, { editable: [] }), map, outputs }));
    expect(outputs).toEqual(['MAP BODY']);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.some((call) => call.forceRefresh === true)).toBe(false);
  },
);

test(
  '/map-refresh forces the first wrapper mapping attempt and reports success without printing the map',
  {
    meta: {
      aider: ['test_commands/TestCommands.test_cmd_map_refresh'],
      evidence: ['ev-map/probe/forced-map'],
    },
  },
  async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'other.py'), 'x = 1\n');
    const calls: MapRequest[] = [];
    const map: RepositoryContext = {
      repoMap: async (request) => {
        calls.push(request);
        return 'SECRET MAP';
      },
    };
    const outputs: string[] = [];
    const run = mapCommands.find((command) => command.name === 'map-refresh');
    await run!.run('', commandEnv({ snapshot: snapshot(root, {}), map, outputs }));
    expect(outputs).toEqual(['The repo map has been refreshed, use /map to view it.']);
    expect(outputs.join('\n')).not.toContain('SECRET MAP');
    expect(calls[0]?.forceRefresh).toBe(true);
  },
);

test(
  '/tokens calls RepoMap directly with editable files as chat, omitting repository read-only partitioning, mention hints, and global fallbacks',
  {
    meta: {
      aider: ['test_commands/TestCommands.test_cmd_tokens_output'],
    },
  },
  async () => {
    const root = '/repo';
    const editable = new Set([`${root}/a.py`]);
    const readOnly = `${root}/ro.py`;
    const all = [`${root}/a.py`, `${root}/b.py`, readOnly];
    const calls: MapRequest[] = [];
    const map: RepositoryContext = {
      repoMap: async (request) => {
        calls.push(request);
        return 'direct-map';
      },
    };
    const content = await tokensRepoMapContent({
      editable,
      allAbsFiles: all,
      map,
    });
    expect(content).toBe('direct-map');
    expect(calls).toHaveLength(1);
    expect([...calls[0]!.chatFiles]).toEqual([`${root}/a.py`]);
    expect([...calls[0]!.otherFiles].sort()).toEqual([`${root}/b.py`, readOnly].sort());
    expect(calls[0]!.mentionedFnames.size).toBe(0);
    expect(calls[0]!.mentionedIdents.size).toBe(0);
    const line = formatRepositoryMapTokenLine({ tokens: 42, labelWidth: 16 });
    expect(line).toContain('repository map');
    expect(line).toContain('use --map-tokens to resize');
    expect(line).toContain('42');
  },
);

test(
  '--show-repo-map builds the map through the coder wrapper, prints it, and exits',
  async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'lib.py'), 'def f():\n    return 1\n');
    const calls: MapRequest[] = [];
    const outputs: string[] = [];
    const result = await runShowRepoMap({
      enabled: true,
      root,
      files: chatFilesOf(snapshot(root, {})),
      git: disabledGitPolicy,
      map: {
        repoMap: async (request) => {
          calls.push(request);
          return 'SHOW MAP';
        },
      },
      output: (text) => outputs.push(text),
    });
    expect(result).toEqual({ kind: 'exit' });
    expect(outputs).toEqual(['SHOW MAP']);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(mapOptions.showRepoMap.name).toBe('show-repo-map');
    expect(mapOptions.showRepoMap.defaultValue).toBe(false);
  },
);

test(
  'the map no-files multiplier option configures how far an empty-chat map budget may expand subject to known context capacity minus 4096 tokens',
  {
    meta: {
      aider: ['test_main/TestMain.test_map_mul_option'],
    },
  },
  () => {
    expect(mapOptions.mapMultiplierNoFiles.aliases).toContain('map-mul');
    const resolved = resolveSettings([mapOptions.mapMultiplierNoFiles], {
      getFlag: (name) => (name === 'map-mul' ? '5' : undefined),
      environment: {},
      environmentPrefix: 'PI_MAINTAINER_',
      configs: [],
    });
    expect(resolved.settings.value(mapOptions.mapMultiplierNoFiles)).toBe(5);
    expect(
      effectiveMapBudget({
        maxMapTokens: 1024,
        mapMulNoFiles: resolved.settings.value(mapOptions.mapMultiplierNoFiles) ?? 2,
        maxContextWindow: 32_768,
        chatFilesEmpty: true,
        expandNoFilesBudget: false,
      }),
    ).toBe(5120);
    expect(mapFeature.options).toEqual(expect.arrayContaining([mapOptions.mapMultiplierNoFiles, mapOptions.showRepoMap]));
  },
);

test(
  'rendered map text can include filenames plus source excerpts with literals, comments, and configuration values, without secret redaction',
  {
    meta: {
      evidence: ['map/source-disclosure/p1'],
    },
  },
  () => {
    const excerpt = formatMapExcerpt('config.py', [
      'API_KEY = "sk-secret-value"',
      '# password=hunter2',
      'DEBUG = True',
    ]);
    expect(excerpt).toContain('config.py:');
    expect(excerpt).toContain('API_KEY = "sk-secret-value"');
    expect(excerpt).toContain('# password=hunter2');
    expect(excerpt).toContain('DEBUG = True');
    expect(excerpt.toLowerCase()).not.toContain('[redacted]');
  },
);

test('map feature registers /map and /map-refresh slash commands', () => {
  expect(mapFeature.commands.map((command) => command.name).sort()).toEqual(['map', 'map-refresh']);
});
