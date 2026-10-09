import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ToolRendererResolver, type ToolRenderers } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { test as base, expect, vi } from 'vitest';
import { registerToolRenderers } from '../src/tools/register-tool-renderers.ts';
import { createThemeFixture } from './theme-fixture.ts';

const test = base.extend<{ directory: string; loader: DefaultResourceLoader }>({
  directory: async ({ task: _task }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'skin-renderers-'));
    try {
      await use(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  loader: async ({ directory }, use) => {
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: SettingsManager.inMemory(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [registerToolRenderers],
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    await use(loader);
  },
});

test.for([[], ['read'], ['grep', 'find', 'ls']])('Pi preserves the selected tool set %j', async (tools, { loader, directory }) => {
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, 'auth.json'), modelsPath: null, modelsStorePath: join(directory, 'models-cache.json'), refreshOnCreate: false });
  const { session } = await createAgentSession({ cwd: directory, agentDir: directory, modelRuntime, resourceLoader: loader, sessionManager: SessionManager.inMemory(directory), settingsManager: SettingsManager.inMemory(), tools });
  try {
    await session.bindExtensions({ mode: 'print' });
    expect([...session.getActiveToolNames()].sort()).toEqual([...tools].sort());
  } finally {
    session.dispose();
  }
});

function resolver(loader: DefaultResourceLoader): ToolRendererResolver {
  const resolvers = loader.getExtensions().extensions.flatMap((extension) => extension.toolRenderers ?? []);
  expect(resolvers).toHaveLength(1);
  const result = resolvers[0];
  if (!result) throw new Error('No native renderer resolver registered');
  return result;
}

test('styling registers no tool definitions or activation overrides', ({ loader }) => {
  expect(loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()])).toEqual([]);
  expect(resolver(loader)).toBeTypeOf('function');
});

test.for(['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls'])('%s renders its own shell without replacing execution', (name, { loader }) => {
  const next = vi.fn(() => undefined);
  const renderers = resolver(loader)(name, next);

  expect(renderers).toMatchObject({ renderShell: 'self', renderCall: expect.any(Function), renderResult: expect.any(Function) });
  expect(next).not.toHaveBeenCalled();
});

test.for(['', 'unknown', 'mcp__offline__read', 'Read', '__proto__', 'constructor'])('unowned tool %s delegates to later renderers', (name, { loader }) => {
  const downstream = { renderShell: 'default' } as const;
  const next = vi.fn(() => downstream);

  expect(resolver(loader)(name, next)).toBe(downstream);
  expect(next).toHaveBeenCalledOnce();
});

test('unowned tool without a later renderer remains unstyled', ({ loader }) => {
  expect(resolver(loader)('unknown', () => undefined)).toBeUndefined();
});

const rows = [
  { name: 'read', args: { path: 'README.md' }, row: '◇ Read README.md' },
  { name: 'bash', args: { command: 'echo hi' }, row: '◇ Bash echo hi' },
  { name: 'powershell', args: { command: 'Get-ChildItem' }, row: '◇ PowerShell Get-ChildItem' },
  { name: 'edit', args: { path: 'note.txt' }, row: '◇ Edit note.txt' },
  { name: 'write', args: { path: 'note.txt', content: 'one line\n' }, row: '◇ Write note.txt (1 line)' },
  { name: 'grep', args: { pattern: 'TUI_SKIN' }, row: '◇ Search "TUI_SKIN"' },
  { name: 'find', args: { pattern: '*.ts' }, row: '◇ Find "*.ts"' },
  { name: 'ls', args: { path: 'src' }, row: '◇ List src' },
];

const theme = createThemeFixture();

function context(args: unknown): Parameters<NonNullable<ToolRenderers['renderCall']>>[2] {
  return {
    args,
    toolCallId: 'row',
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: '/tmp',
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
    durationMs: undefined,
    outputPad: 0,
  };
}

test.for(rows)('$name resolves its own call row', ({ name, args, row }, { loader }) => {
  const lines = resolver(loader)(name, () => undefined)
    ?.renderCall?.(args, theme, context(args))
    .render(80);
  expect(lines?.map((line) => stripTerminalSequences(line).trimEnd())).toEqual([row]);
});

test.for(rows)('$name resolves its result body', ({ name, args }, { loader }) => {
  const result = { content: [{ type: 'text', text: 'row body' }], details: undefined } as const;
  const lines = resolver(loader)(name, () => undefined)
    ?.renderResult?.({ ...result, content: [...result.content] }, { expanded: true, isPartial: false }, theme, context(args))
    .render(80);
  expect(lines?.map((line) => stripTerminalSequences(line).trimEnd())).toEqual(['row body']);
});
