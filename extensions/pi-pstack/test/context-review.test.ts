import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ExtensionAPI, type ExtensionContext, type ExtensionToolContext, SessionManager, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { registerContext, registerStatus } from '../src/context.ts';
import { createState } from '../src/state.ts';
import { expectDefined } from './support/expect-defined.ts';

type Evidence = { entries: unknown[]; models: string[]; tools: unknown[]; history: unknown[]; omitted: Record<string, number>; historyDiscovery: { mode: string; completeness: string } };

async function call(manager: SessionManager, options: { history?: boolean; models?: { provider: string; id: string }[]; tools?: { name: string; description: string }[] } = {}) {
  let tool: ToolDefinition | undefined;
  const pi = {
    registerTool: (value: ToolDefinition) => {
      tool = value;
    },
    getAllTools: () => options.tools ?? [],
  } as unknown as ExtensionAPI;
  registerContext(pi);
  expect(tool).toBeDefined();
  const ctx = { cwd: manager.getCwd(), sessionManager: manager, modelRegistry: { getAvailable: () => options.models ?? [] } } as unknown as ExtensionToolContext;
  const result = await tool?.execute('context-review', { history: options.history }, undefined, undefined, ctx);
  if (!result) throw new Error('missing context result');
  return result.details as Evidence;
}

test.each([
  ['ASCII', 'a'.repeat(8186)],
  ['multibyte', `${'🙂'.repeat(2046)}ab`],
])('context accepts the exact serialized byte budget for %s models', async (_label, id) => {
  const manager = SessionManager.inMemory('/tmp/context-review');
  const exact = await call(manager, { models: [{ provider: 'p', id }] });
  expect(exact.models).toEqual([`p/${id}`]);
  expect(Buffer.byteLength(JSON.stringify(exact.models))).toBe(8192);
  expect(exact.omitted['models']).toBe(0);
  const oversized = await call(manager, { models: [{ provider: 'p', id: `${id}a` }] });
  expect(oversized.models).toEqual([]);
  expect(oversized.omitted['models']).toBe(1);
});

test('context counts separators at the exact multibyte list boundary', async () => {
  const manager = SessionManager.inMemory('/tmp/context-review');
  const models = [
    { provider: 'p', id: 'a' },
    { provider: 'p', id: '🙂'.repeat(2045) },
    { provider: 'p', id: 'omitted' },
  ];
  const result = await call(manager, { models });
  expect(result.models).toEqual(['p/a', `p/${'🙂'.repeat(2045)}`]);
  expect(Buffer.byteLength(JSON.stringify(result.models))).toBe(8192);
  expect(result.omitted['models']).toBe(1);
});

async function historyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pstack-context-review-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
  const close = async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  };
  try {
    const manager = SessionManager.create(root);
    return { root, manager, directory: manager.getSessionDir(), close };
  } catch (error) {
    await close();
    throw error;
  }
}

test('history uses the active custom session directory without crossing workspace scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-context-custom-'));
  const directory = join(root, 'custom-sessions');
  const cwd = join(root, 'workspace');
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'));
  try {
    await mkdir(directory, { recursive: true });
    const own = join(directory, 'own.jsonl');
    const other = join(directory, 'other.jsonl');
    for (const [path, id, workspace] of [
      [own, 'own-session', cwd],
      [other, 'other-session', join(root, 'other-workspace')],
    ]) {
      await writeFile(expectDefined(path), `${JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-01T00:00:00.000Z', cwd: workspace })}\n`);
    }
    const manager = SessionManager.open(own, directory);
    const result = await call(manager, { history: true });
    expect(result.history).toEqual([{ id: 'own-session', path: own, name: undefined }]);
    expect(result.historyDiscovery).toEqual({ mode: 'best-effort', completeness: 'unknown' });
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test.each(['directory', 'session'])('real SDK %s read failures retain unknown history completeness', async (failure) => {
  const f = await historyFixture();
  try {
    if (failure === 'directory') {
      await rm(f.directory, { recursive: true });
      await writeFile(f.directory, 'not a directory');
      await expect(readdir(f.directory)).rejects.toThrow(/ENOTDIR/);
    } else {
      const unreadable = join(f.directory, 'broken.jsonl');
      await mkdir(unreadable);
      await expect(readFile(unreadable)).rejects.toThrow(/EISDIR/);
    }
    expect(await SessionManager.list(f.root)).toEqual([]);
    const result = await call(f.manager, { history: true });
    expect(result.history).toEqual([]);
    expect(result.omitted['history']).toBe(0);
    expect(result.historyDiscovery).toEqual({ mode: 'best-effort', completeness: 'unknown' });
  } finally {
    await f.close();
  }
});

test('context reports budget omissions for every list without claiming history completeness', async () => {
  const f = await historyFixture();
  try {
    for (let index = 0; index < 100; index++) {
      f.manager.appendCustomEntry('large-history', { index });
      const header = { type: 'session', version: 3, id: `history-${index}`, cwd: f.root, timestamp: new Date(0).toISOString() };
      await writeFile(join(f.directory, `${index}.jsonl`), `${JSON.stringify(header)}\n`);
    }
    const tools = Array.from({ length: 100 }, (_, index) => ({ name: `tool-${index}`, description: '🙂'.repeat(160) }));
    const models = Array.from({ length: 100 }, (_, index) => ({ provider: 'provider', id: `${index}-${'m'.repeat(100)}` }));
    const result = await call(f.manager, { history: true, tools, models });
    for (const key of ['entries', 'tools', 'models', 'history'] as const) {
      expect(result[key].length > 0).toBe(true);
      const omittedCount = result.omitted[key] ?? 0;
      expect(omittedCount > 0).toBe(true);
      expect(result[key].length + omittedCount).toBe(100);
      expect(Buffer.byteLength(JSON.stringify(result[key])) <= 8192).toBe(true);
    }
    expect(result.historyDiscovery).toEqual({ mode: 'best-effort', completeness: 'unknown' });
    const empty = await call(SessionManager.inMemory(f.root));
    expect(empty.omitted).toEqual({ entries: 0, tools: 0, models: 0, history: 0 });
    expect(empty.historyDiscovery).toEqual({ mode: 'not-requested', completeness: 'unknown' });
  } finally {
    await f.close();
  }
});

test('registerStatus formats pstack status, argument completions, and todo details', async () => {
  let command: { getArgumentCompletions?: (prefix: string) => unknown[]; handler: (args: string, ctx: ExtensionContext) => Promise<void> } | undefined;
  const messages: unknown[] = [];
  const pi = {
    registerCommand: (_name: string, options: typeof command) => {
      command = options;
    },
    on() {},
    sendMessage: (msg: unknown) => {
      messages.push(msg);
    },
  } as unknown as ExtensionAPI;
  const store = createState({ appendEntry() {} } as unknown as ExtensionAPI);
  const ctx = { ui: { setStatus: () => {}, setWidget: () => {} } } as unknown as ExtensionContext;
  registerStatus(pi, store);
  expect(command).toBeDefined();
  const completions = command?.getArgumentCompletions?.('to') as Array<{ value: string }>;
  expect(completions).toEqual([{ value: 'todos', label: 'todos', description: 'Show current todos and progress' }]);
  await command?.handler('status', ctx);
  const initial = messages.at(-1) as { content: string };
  expect(initial.content).toMatch(/Poteto mode off/);
  expect(initial.content.includes('Todos:')).toBe(false);
  store.update(
    {
      enabled: true,
      todos: [
        { id: '1', content: 'Step 1', status: 'completed' },
        { id: '2', content: 'Step 2', status: 'in_progress' },
      ],
    },
    ctx,
  );
  await command?.handler('status', ctx);
  const withTodos = messages.at(-1) as { content: string };
  expect(withTodos.content).toMatch(/Todos: 1\/2 completed/);
  await command?.handler('todos', ctx);
  const todosList = messages.at(-1) as { content: string };
  expect(todosList.content).toMatch(/Todos:\n\[x\] Step 1 \(completed\)\n\[>\] Step 2 \(in_progress\)/);
});

test('/pstack todos reports an empty list and an unknown argument shows usage instead of status', async () => {
  let command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> } | undefined;
  const messages: Array<{ content: string }> = [];
  const notices: Array<[string, string]> = [];
  const pi = {
    registerCommand: (_name: string, options: typeof command) => {
      command = options;
    },
    on() {},
    sendMessage: (msg: { content: string }) => {
      messages.push(msg);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    ui: {
      setStatus: () => {},
      setWidget: () => {},
      notify: (m: string, l: string) => {
        notices.push([m, l]);
      },
    },
  } as unknown as ExtensionContext;
  registerStatus(pi, createState({ appendEntry() {} } as unknown as ExtensionAPI));
  expect(command).toBeDefined();
  await command?.handler('todos', ctx);
  expect(messages.at(-1)?.content).toMatch(/\n\nTodos: none\.$/);
  await command?.handler('bogus', ctx);
  expect(messages.length).toBe(1);
  expect(notices).toEqual([['Unknown /pstack argument "bogus". Use /pstack, /pstack status, or /pstack todos.', 'error']]);
});

test('/pstack todos marks cancelled and pending todos distinctly', async () => {
  let command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> } | undefined;
  const messages: Array<{ content: string }> = [];
  const pi = {
    registerCommand: (_name: string, options: typeof command) => {
      command = options;
    },
    on() {},
    sendMessage: (msg: { content: string }) => {
      messages.push(msg);
    },
  } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus: () => {}, setWidget: () => {} } } as unknown as ExtensionContext;
  const store = createState({ appendEntry() {} } as unknown as ExtensionAPI);
  store.update(
    {
      enabled: false,
      todos: [
        { id: '1', content: 'Dropped', status: 'cancelled' },
        { id: '2', content: 'Later', status: 'pending' },
      ],
    },
    ctx,
  );
  registerStatus(pi, store);
  await command?.handler('todos', ctx);
  expect(messages.at(-1)?.content).toContain('[-] Dropped (cancelled)');
  expect(messages.at(-1)?.content).toContain('[ ] Later (pending)');
});

test('context summarizes custom entries and named sessions in history', async () => {
  const f = await historyFixture();
  try {
    const header = { type: 'session', version: 3, id: 'named-1', cwd: f.root, timestamp: new Date(0).toISOString() };
    const sessionInfo = { type: 'session_info', name: 'My named session', id: 's1', timestamp: new Date(0).toISOString() };
    await writeFile(join(f.directory, 'named.jsonl'), `${JSON.stringify(header)}\n${JSON.stringify(sessionInfo)}\n`);
    f.manager.appendCustomEntry('custom-entry', { val: 1 });
    f.manager.appendMessage({ role: 'user', content: 'plain user text' } as never);
    f.manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'my assistant text' }] } as never);
    f.manager.appendMessage({ role: 'toolResult', toolName: 'my-tool', content: [] } as never);
    const result = await call(f.manager, { history: true });
    expect(result.entries.some((h: unknown) => (h as { summary?: string }).summary === 'plain user text')).toBe(true);
    expect(result.history.some((h: unknown) => (h as { name?: string }).name === 'My named session')).toBe(true);
    expect(result.entries.some((e: unknown) => (e as { type?: string }).type === 'custom')).toBe(true);
    expect(result.entries.some((e: unknown) => (e as { toolName?: string }).toolName === 'my-tool')).toBe(true);
  } finally {
    await f.close();
  }
});
