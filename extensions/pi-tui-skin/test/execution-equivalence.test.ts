import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionToolContext, ExtensionUIContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { ModelRegistry, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { BuiltinName } from '../src/tools/builtins.ts';
import { getBuiltin } from '../src/tools/builtins.ts';
import { registerToolRenderers, TOOL_OVERRIDES_ENV } from '../src/tools/register-tool-renderers.ts';
import { createThemeFixture } from './theme-fixture.ts';

const theme = createThemeFixture();
let registry: Promise<ModelRegistry> | undefined;

function sharedRegistry(): Promise<ModelRegistry> {
  registry ??= ModelRuntime.create({ refreshOnCreate: false }).then((runtime) => new ModelRegistry(runtime));
  return registry;
}

const uiContext: ExtensionUIContext = {
  select: async () => undefined,
  confirm: async () => false,
  input: async () => undefined,
  notify: () => {},
  onTerminalInput: () => () => {},
  setStatus: () => {},
  setWorkingMessage: () => {},
  setWorkingVisible: () => {},
  setWorkingIndicator: () => {},
  setHiddenThinkingLabel: () => {},
  setWidget: () => {},
  setFooter: () => {},
  setHeader: () => {},
  setTitle: () => {},
  custom: () => Promise.reject(new Error('dialog UI is unavailable in tests')),
  pasteToEditor: () => {},
  setEditorText: () => {},
  getEditorText: () => '',
  editor: async () => undefined,
  addAutocompleteProvider: () => {},
  setEditorComponent: () => {},
  getEditorComponent: () => undefined,
  theme,
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: () => ({ success: false, error: 'theme switching is unavailable in tests' }),
  getToolsExpanded: () => false,
  setToolsExpanded: () => {},
};

/** The built-ins read `cwd` (all of them) plus `model`, `sessionManager`, and `thinkingLevel` (bash). */
async function makeContext(cwd: string): Promise<ExtensionToolContext> {
  return {
    ui: uiContext,
    mode: 'print',
    hasUI: false,
    cwd,
    sessionManager: SessionManager.inMemory(cwd),
    modelRegistry: await sharedRegistry(),
    model: undefined,
    scopedModels: [],
    isIdle: () => true,
    isProjectTrusted: () => false,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => '',
    tools: [],
    executeTool: async () => {
      throw new Error('executeTool not implemented in test');
    },
  };
}

function captureDefinitions(): Map<string, ToolDefinition> {
  const captured = new Map<string, ToolDefinition>();
  const fakePi = {
    registerTool: (definition: ToolDefinition) => {
      captured.set(definition.name, definition);
    },
  } as unknown as ExtensionAPI;
  vi.stubEnv(TOOL_OVERRIDES_ENV, 'grep,find,ls,powershell');
  try {
    registerToolRenderers(fakePi);
  } finally {
    vi.unstubAllEnvs();
  }
  return captured;
}

const definitions = captureDefinitions();

function captured(name: string): ToolDefinition {
  const definition = definitions.get(name);
  if (!definition) throw new Error(`no registered definition for ${name}`);
  return definition;
}

async function errorOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-tui-skin-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('built-in execution equivalence', () => {
  test('registered metadata matches the official definition', async () => {
    const directory = await tempDir();
    const names: BuiltinName[] = ['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls'];

    expect(definitions.size).toBe(8);
    for (const name of names) {
      const wrapped = captured(name);
      const original = getBuiltin(directory, name);

      expect(wrapped.label).toBe(original.label);
      expect(wrapped.description).toBe(original.description);
      expect(wrapped.promptSnippet).toBe(original.promptSnippet);
      expect(wrapped.promptGuidelines).toEqual(original.promptGuidelines);
      expect(wrapped.executionMode).toBe(original.executionMode);
      expect(typeof wrapped.prepareArguments).toBe(typeof original.prepareArguments);
      expect(JSON.parse(JSON.stringify(wrapped.parameters))).toEqual(JSON.parse(JSON.stringify(original.parameters)));
    }
  });

  test('read execution matches the built-in', async () => {
    const directory = await tempDir();
    await writeFile(join(directory, 'notes.txt'), 'alpha\nbeta\ngamma\n');
    const ctx = await makeContext(directory);
    const original = getBuiltin(directory, 'read');
    const wrapped = captured('read');

    const params = { path: 'notes.txt' };
    const expected = await original.execute('original-read', params, undefined, undefined, ctx);
    const actual = await wrapped.execute('wrapped-read', params, undefined, undefined, ctx);
    expect(actual.content).toEqual(expected.content);
    expect(actual.details).toEqual(expected.details);

    const originalError = await errorOf(() => original.execute('original-missing', { path: 'missing.txt' }, undefined, undefined, ctx));
    const wrappedError = await errorOf(() => wrapped.execute('wrapped-missing', { path: 'missing.txt' }, undefined, undefined, ctx));
    expect(wrappedError).toBe(originalError);
    expect(originalError).toContain('missing.txt');
  });

  test('bash execution matches the built-in', async () => {
    const directory = await tempDir();
    await writeFile(join(directory, 'seed.txt'), 'seed\n');
    const ctx = await makeContext(directory);
    const original = getBuiltin(directory, 'bash');
    const wrapped = captured('bash');

    const params = { command: 'cat seed.txt' };
    const expected = await original.execute('original-bash', params, undefined, undefined, ctx);
    const actual = await wrapped.execute('wrapped-bash', params, undefined, undefined, ctx);
    expect(actual.content).toEqual(expected.content);
    expect(actual.details).toEqual(expected.details);

    const originalResult = await original.execute('original-fail', { command: 'exit 3' }, undefined, undefined, ctx);
    const wrappedResult = await wrapped.execute('wrapped-fail', { command: 'exit 3' }, undefined, undefined, ctx);
    expect(wrappedResult.isError).toBe(true);
    expect(JSON.stringify(wrappedResult.content)).toContain('Command exited with code 3');
    expect(wrappedResult).toEqual(originalResult);
  });

  test('bash runs commands in the configured shell', async () => {
    const home = await tempDir();
    const shellLog = join(home, 'shell-invocations.log');
    const fakeShell = join(home, 'fakesh');
    await writeFile(fakeShell, `#!/bin/sh\necho invoked >> ${shellLog}\nexec /bin/bash "$@"\n`);
    await chmod(fakeShell, 0o755);
    await mkdir(join(home, '.pi', 'agent'), { recursive: true });
    await writeFile(join(home, '.pi', 'agent', 'settings.json'), `${JSON.stringify({ shellPath: fakeShell, shellCommandPrefix: 'export CUI_PREFIX=SET && ' })}\n`);

    const directory = await tempDir();
    vi.stubEnv('HOME', home);
    try {
      const ctx = await makeContext(directory);
      const result = await captured('bash').execute('settings-bash', { command: 'echo "CUI_PREFIX=[$CUI_PREFIX]"' }, undefined, undefined, ctx);
      const text = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      expect(text).toContain('CUI_PREFIX=[SET]');
      expect((await readFile(shellLog, 'utf8')).trim().split('\n')).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('edit execution matches the built-in', async () => {
    const directory = await tempDir();
    const file = join(directory, 'edit-me.txt');
    const initial = 'one\ntwo\nthree\n';
    await writeFile(file, initial);
    const ctx = await makeContext(directory);
    const original = getBuiltin(directory, 'edit');
    const wrapped = captured('edit');

    const params = { path: 'edit-me.txt', edits: [{ oldText: 'two', newText: 'TWO' }] };
    const expected = await original.execute('original-edit', params, undefined, undefined, ctx);
    await writeFile(file, initial);
    const actual = await wrapped.execute('wrapped-edit', params, undefined, undefined, ctx);
    expect(actual.content).toEqual(expected.content);
    expect(actual.details).toEqual(expected.details);

    const missingText = { path: 'edit-me.txt', edits: [{ oldText: 'absent', newText: 'x' }] };
    const originalError = await errorOf(() => original.execute('original-edit-fail', missingText, undefined, undefined, ctx));
    const wrappedError = await errorOf(() => wrapped.execute('wrapped-edit-fail', missingText, undefined, undefined, ctx));
    expect(wrappedError).toBe(originalError);
    expect(originalError).toContain('Could not find the exact text in edit-me.txt');
  });

  test('write execution matches the built-in', async () => {
    const directory = await tempDir();
    const ctx = await makeContext(directory);
    const original = getBuiltin(directory, 'write');
    const wrapped = captured('write');

    const params = { path: 'created.txt', content: 'hello\nworld\n' };
    const expected = await original.execute('original-write', params, undefined, undefined, ctx);
    const actual = await wrapped.execute('wrapped-write', params, undefined, undefined, ctx);
    expect(actual.content).toEqual(expected.content);
    expect(actual.details).toEqual(expected.details);
    expect(await readFile(join(directory, 'created.txt'), 'utf8')).toBe('hello\nworld\n');
  });

  test('grep execution matches the built-in', async () => {
    const directory = await tempDir();
    await writeFile(join(directory, 'greeting.txt'), 'hello world\nsecond line\n');
    const ctx = await makeContext(directory);
    const original = getBuiltin(directory, 'grep');
    const wrapped = captured('grep');

    const params = { pattern: 'hello', path: '.' };
    const expected = await original.execute('original-grep', params, undefined, undefined, ctx);
    const actual = await wrapped.execute('wrapped-grep', params, undefined, undefined, ctx);
    expect(actual.content).toEqual(expected.content);
    expect(actual.details).toEqual(expected.details);
    expect(JSON.stringify(actual.content)).toContain('hello world');
  });

  test('find execution matches the built-in', async () => {
    const directory = await tempDir();
    await writeFile(join(directory, 'alpha.txt'), 'a\n');
    await writeFile(join(directory, 'beta.txt'), 'b\n');
    const ctx = await makeContext(directory);
    const original = getBuiltin(directory, 'find');
    const wrapped = captured('find');

    const params = { pattern: '*.txt', path: '.' };
    const expected = await original.execute('original-find', params, undefined, undefined, ctx);
    const actual = await wrapped.execute('wrapped-find', params, undefined, undefined, ctx);
    expect(actual.content).toEqual(expected.content);
    expect(actual.details).toEqual(expected.details);
    expect(JSON.stringify(actual.content)).toContain('alpha.txt');
  });

  test('ls execution matches the built-in', async () => {
    const directory = await tempDir();
    await writeFile(join(directory, 'one.txt'), '1\n');
    await writeFile(join(directory, 'two.txt'), '2\n');
    const ctx = await makeContext(directory);
    const original = getBuiltin(directory, 'ls');
    const wrapped = captured('ls');

    const params = { path: '.' };
    const expected = await original.execute('original-ls', params, undefined, undefined, ctx);
    const actual = await wrapped.execute('wrapped-ls', params, undefined, undefined, ctx);
    expect(actual.content).toEqual(expected.content);
    expect(actual.details).toEqual(expected.details);
    expect(JSON.stringify(actual.content)).toContain('one.txt');
  });

  test.skipIf(process.platform === 'darwin')('powershell execution matches the built-in', async () => {
    const directory = await tempDir();
    const ctx = await makeContext(directory);
    const original = getBuiltin(directory, 'powershell');
    const wrapped = captured('powershell');

    const params = { command: 'Write-Output hello' };
    const expected = await original.execute('original-pwsh', params, undefined, undefined, ctx);
    const actual = await wrapped.execute('wrapped-pwsh', params, undefined, undefined, ctx);
    expect(actual.content).toEqual(expected.content);
    expect(actual.details).toEqual(expected.details);
  });
});
