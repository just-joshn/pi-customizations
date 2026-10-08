import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { registerCommands, registerNativeInput } from '../src/commands.ts';
import { createState } from '../src/state.ts';

test('/poteto-mode off and /skill:poteto-mode off give the same confirmation', async () => {
  const path = '/pkg/skills/poteto-mode/SKILL.md';
  const skills = new Map([['poteto-mode', { path, body: 'Body', description: 'Mode' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  let input: ((event: { text: string; images?: unknown[] }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
      handlers[name] = options.handler;
    },
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [{ source: 'skill', name: 'skill:poteto-mode', sourceInfo: { path } }],
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerCommands(pi, skills, store);
  registerNativeInput(pi, skills, store);
  const notices: string[] = [];
  const ctx = {
    hasUI: true,
    ui: {
      setStatus() {},
      setWidget() {},
      notify: (message: string) => {
        notices.push(message);
      },
    },
  } as unknown as ExtensionContext;
  store.toggle(true, ctx);
  await handlers['poteto-mode']?.('off', ctx);
  store.toggle(true, ctx);
  expect(await input?.({ text: '/skill:poteto-mode off' }, ctx)).toEqual({ action: 'handled' });
  expect(store.read().enabled).toBe(false);
  expect(notices).toEqual(['Poteto mode is off.', 'Poteto mode is off.']);
});

test('/poteto-mode with task and /skill:poteto-mode transform input', async () => {
  const path = '/pkg/skills/poteto-mode/SKILL.md';
  const skills = new Map([['poteto-mode', { path, body: 'Body text', description: 'Mode' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  let input: ((event: { text: string; images?: unknown[] }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const sent: Array<{ text: string; options: unknown }> = [];
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
      handlers[name] = options.handler;
    },
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [{ source: 'skill', name: 'skill:poteto-mode', sourceInfo: { path } }],
    sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerCommands(pi, skills, store);
  registerNativeInput(pi, skills, store);
  const ctx = { mode: 'tui', hasUI: true, ui: { setStatus() {}, setWidget() {}, notify() {} } } as unknown as ExtensionContext;

  await handlers['poteto-mode']?.('my task', ctx);
  expect(store.read().enabled).toBe(true);
  expect(sent.length).toBe(1);
  expect(sent[0]?.text).toMatch(/my task/);

  const transformed = (await input?.({ text: '/skill:poteto-mode investigate', images: [] }, ctx)) as { action: string; text: string };
  expect(transformed.action).toBe('transform');
  expect(transformed.text).toMatch(/investigate/);

  const bare = (await input?.({ text: '/skill:poteto-mode' }, ctx)) as { action: string; text: string };
  expect(bare.text).toMatch(/Body text\n<\/skill>$/);
});

test('owned prompt aliases preserve attached images on transformed input', async () => {
  const promptPath = join(process.cwd(), 'prompts/how.md');
  let input: ((event: { text: string; images?: unknown[] }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [{ source: 'prompt', name: 'how', sourceInfo: { path: promptPath } }],
  } as unknown as ExtensionAPI;
  registerNativeInput(pi, new Map(), createState(pi));
  const ctx = { hasUI: true, ui: { notify() {} } } as unknown as ExtensionContext;

  expect(await input?.({ text: '/how describe this image', images: [{ type: 'image', data: 'abc' }] }, ctx)).toMatchObject({
    action: 'transform',
    images: [{ type: 'image', data: 'abc' }],
  });
});

test('aliases require a native prompt and preserve standalone /bro', async () => {
  let input: ((event: { text: string }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [
      { source: 'extension', name: 'how', sourceInfo: { path: join(process.cwd(), 'prompts/how.md') } },
      { source: 'prompt', name: 'bro', sourceInfo: { path: join(process.cwd(), 'prompts/bro.md') } },
    ],
  } as unknown as ExtensionAPI;
  registerNativeInput(pi, new Map(), createState(pi));
  const ctx = { hasUI: true, ui: { notify() {} } } as unknown as ExtensionContext;
  expect(await input?.({ text: '/how keep' }, ctx)).toEqual({ action: 'continue' });
  expect(await input?.({ text: '/bro keep' }, ctx)).toEqual({ action: 'transform', text: "/bro 'keep'" });
});

test('/how with arguments delivers the skill body inline like the one-message reference attachment', async () => {
  const path = '/pkg/skills/how/SKILL.md';
  const skills = new Map([['how', { path, body: 'How workflow with Step 2b', description: 'How' }]]);
  let input: ((event: { text: string }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [{ source: 'prompt', name: 'how', sourceInfo: { path: join(process.cwd(), 'prompts/how.md') } }],
  } as unknown as ExtensionAPI;
  registerNativeInput(pi, skills, createState(pi));
  const ctx = { hasUI: true, ui: { notify() {} } } as unknown as ExtensionContext;
  const transformed = (await input?.({ text: '/how what makes the budget change behavior' }, ctx)) as { action: string; text: string };
  expect(transformed.action).toBe('transform');
  expect(transformed.text).toContain('How workflow with Step 2b');
  expect(transformed.text).toContain('what makes the budget change behavior');
  expect(transformed.text).not.toContain('Read how/SKILL.md in full');
});

test('a same-name user prompt is not rewritten', async () => {
  let input: ((event: { text: string }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [{ source: 'prompt', name: 'how', sourceInfo: { path: '/user/prompts/how.md' } }],
  } as unknown as ExtensionAPI;
  registerNativeInput(pi, new Map(), createState(pi));
  const ctx = { hasUI: true, ui: { notify() {} } } as unknown as ExtensionContext;

  expect(await input?.({ text: '/how "keep me"' }, ctx)).toEqual({ action: 'continue' });
});

test('/setup-pstack and /skill:setup-pstack deliver the skill like any other pstack skill', async () => {
  const path = '/pkg/skills/setup-pstack/SKILL.md';
  const skills = new Map([['setup-pstack', { path, body: 'Setup body', description: 'Setup' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  let input: ((event: { text: string; images?: unknown[] }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const sent: Array<{ text: string; options: unknown }> = [];
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
      handlers[name] = options.handler;
    },
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [{ source: 'skill', name: 'skill:setup-pstack', sourceInfo: { path } }],
    sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerCommands(pi, skills, store);
  registerNativeInput(pi, skills, store);
  const ctx = { mode: 'tui', hasUI: true, ui: { setStatus() {}, setWidget() {}, notify() {} } } as unknown as ExtensionContext;

  await handlers['setup-pstack']?.('keep budgets', ctx);
  expect(sent.length).toBe(1);
  expect(sent[0]?.text).toContain('Setup body');
  expect(sent[0]?.text).toMatch(/keep budgets/);

  const res = await input?.({ text: '/skill:setup-pstack' }, ctx);
  expect(res).toEqual({ action: 'transform', text: expect.stringContaining('Setup body') });
});

test('native input ignores unrelated input or mismatched skill path', async () => {
  const path = '/pkg/skills/poteto-mode/SKILL.md';
  const skills = new Map([['poteto-mode', { path, body: 'Body', description: 'Mode' }]]);
  let input: ((event: { text: string; images?: unknown[] }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    registerCommand() {},
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [{ source: 'skill', name: 'skill:poteto-mode', sourceInfo: { path: '/wrong/path' } }],
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerNativeInput(pi, skills, store);
  const ctx = { mode: 'tui', hasUI: true, ui: { setStatus() {}, setWidget() {}, notify() {} } } as unknown as ExtensionContext;

  const res1 = await input?.({ text: 'just a normal message' }, ctx);
  expect(res1).toEqual({ action: 'continue' });

  const res2 = await input?.({ text: '/skill:poteto-mode' }, ctx);
  expect(res2).toEqual({ action: 'continue' });
});

test('registered command handles other skills and expands them', async () => {
  const path = '/pkg/skills/how/SKILL.md';
  const skills = new Map([['how', { path, body: 'How body', description: 'Explore' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  const sent: Array<{ text: string; options: unknown }> = [];
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
      handlers[name] = options.handler;
    },
    on() {},
    sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
  } as unknown as ExtensionAPI;
  registerCommands(pi, skills, createState(pi));
  const ctx = { mode: 'tui', hasUI: true, ui: { setStatus() {}, setWidget() {}, notify() {} } } as unknown as ExtensionContext;
  await handlers['how']?.('explore auth', ctx);
  expect(sent.length).toBe(1);
  expect(sent[0]?.text).toMatch(/How body/);
  expect(sent[0]?.text).toMatch(/explore auth/);
});

type GenericListener = (...args: unknown[]) => unknown;

test('pstack index entry point wires extension hooks and registers all tools', async () => {
  const pstackModule = await import('../src/index.ts');
  const listeners: Record<string, GenericListener[]> = {};
  const tools: string[] = [];
  const commands: string[] = [];
  const pi = {
    registerCommand: (name: string) => commands.push(name),
    registerFlag: () => {},
    registerTool: (t: { name: string }) => tools.push(t.name),
    events: {
      emit() {},
      on() {
        return () => {};
      },
    },
    on: (event: string, handler: GenericListener) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    appendEntry() {},
    getSettings: () => ({}),
    getCommands: () => [],
    getAllTools: () => [],
    getActiveTools: () => [],
  } as unknown as ExtensionAPI;
  await pstackModule.default(pi);
  expect(commands).toContain('poteto-mode');
  expect(commands).toContain('setup-pstack');
  expect(tools).toContain('TodoWrite');
  expect(tools).toContain('pstack_mode');
  expect(tools).toContain('Task');

  const ctx = {
    cwd: '/test/cwd',
    sessionManager: { getBranch: () => [], getEntries: () => [], getSessionDir: () => '/tmp', getSessionFile: () => '/tmp/f.jsonl', getSessionId: () => 'index-hook-session' },
    ui: { setStatus() {}, setWidget() {} },
  } as unknown as ExtensionContext;

  for (const fn of listeners['session_start'] ?? []) await fn({}, ctx);
  for (const fn of listeners['session_tree'] ?? []) await fn({}, ctx);

  const event1 = { systemPromptOptions: { sections: {} as Record<string, string> } };
  for (const fn of listeners['before_agent_start'] ?? []) await fn(event1, ctx);
  expect(event1.systemPromptOptions.sections['pstack_host']).toContain('pstack pi host contract');
  expect(event1.systemPromptOptions.sections).not.toHaveProperty('pstack_mode');
  expect(event1.systemPromptOptions.sections).not.toHaveProperty('pstack_todos');
});

test('input originating from an extension bypasses native skill rewriting', async () => {
  let input: ((event: { text: string; source?: string }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    on: (_event: string, handler: typeof input) => {
      input = handler;
    },
    getCommands: () => [],
    appendEntry() {},
  } as unknown as ExtensionAPI;
  registerNativeInput(pi, new Map(), createState(pi));
  const ctx = { hasUI: true, ui: { notify() {} } } as unknown as ExtensionContext;
  expect(await input?.({ text: '/skill:poteto-mode off', source: 'extension' }, ctx)).toEqual({ action: 'continue' });
});
