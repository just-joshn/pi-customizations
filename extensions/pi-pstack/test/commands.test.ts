import { expect, test } from 'vitest';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerCommands, registerNativeInput } from '../src/commands.ts';
import { createState } from '../src/state.ts';

test('/poteto-mode off and /skill:poteto-mode off give the same confirmation', async () => {
  const path = '/pkg/skills/poteto-mode/SKILL.md';
  const skills = new Map([['poteto-mode', { path, body: 'Body', description: 'Mode' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  let input: ((event: { text: string; images?: unknown[] }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => { handlers[name] = options.handler; },
    on: (_event: string, handler: typeof input) => { input = handler; },
    getCommands: () => [{ source: 'skill', name: 'skill:poteto-mode', sourceInfo: { path } }],
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerCommands(pi, skills, store);
  registerNativeInput(pi, skills, store);
  const notices: string[] = [];
  const ctx = { ui: { setStatus() {}, setWidget() {}, notify: (message: string) => { notices.push(message); } } } as unknown as ExtensionContext;
  store.toggle(true, ctx);
  await handlers['poteto-mode']!('off', ctx);
  store.toggle(true, ctx);
  expect(await input!({ text: '/skill:poteto-mode off' }, ctx)).toEqual({ action: 'handled' });
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
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => { handlers[name] = options.handler; },
    on: (_event: string, handler: typeof input) => { input = handler; },
    getCommands: () => [{ source: 'skill', name: 'skill:poteto-mode', sourceInfo: { path } }],
    sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerCommands(pi, skills, store);
  registerNativeInput(pi, skills, store);
  const ctx = { ui: { setStatus() {}, setWidget() {}, notify() {} } } as unknown as ExtensionContext;

  await handlers['poteto-mode']!('my task', ctx);
  expect(store.read().enabled).toBe(true);
  expect(sent.length).toBe(1);
  expect(sent[0]!.text).toMatch(/my task/);

  const transformed = await input!({ text: '/skill:poteto-mode investigate', images: [] }, ctx) as { action: string; text: string };
  expect(transformed.action).toBe('transform');
  expect(transformed.text).toMatch(/investigate/);
});

test('/setup-pstack and /skill:setup-pstack handle errors without UI', async () => {
  const path = '/pkg/skills/setup-pstack/SKILL.md';
  const skills = new Map([['setup-pstack', { path, body: 'Body', description: 'Setup' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  let input: ((event: { text: string; images?: unknown[] }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const messages: unknown[] = [];
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => { handlers[name] = options.handler; },
    on: (_event: string, handler: typeof input) => { input = handler; },
    getCommands: () => [{ source: 'skill', name: 'skill:setup-pstack', sourceInfo: { path } }],
    sendMessage: (msg: unknown) => messages.push(msg),
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerCommands(pi, skills, store);
  registerNativeInput(pi, skills, store);
  const errors: string[] = [];
  const ctx = { hasUI: false, ui: { setStatus() {}, setWidget() {}, notify: (msg: string) => errors.push(msg) } } as unknown as ExtensionContext;

  await handlers['setup-pstack']!('', ctx);
  expect(errors.length).toBe(1);
  expect(errors[0]!).toMatch(/\/setup-pstack requires Pi interactive or RPC dialog UI/);

  const res = await input!({ text: '/skill:setup-pstack' }, ctx);
  expect(res).toEqual({ action: 'handled' });
  expect(errors.length).toBe(2);
});

test('native input ignores unrelated input or mismatched skill path', async () => {
  const path = '/pkg/skills/poteto-mode/SKILL.md';
  const skills = new Map([['poteto-mode', { path, body: 'Body', description: 'Mode' }]]);
  let input: ((event: { text: string; images?: unknown[] }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    registerCommand() {},
    on: (_event: string, handler: typeof input) => { input = handler; },
    getCommands: () => [{ source: 'skill', name: 'skill:poteto-mode', sourceInfo: { path: '/wrong/path' } }],
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerNativeInput(pi, skills, store);
  const ctx = { ui: { setStatus() {}, setWidget() {}, notify() {} } } as unknown as ExtensionContext;

  const res1 = await input!({ text: 'just a normal message' }, ctx);
  expect(res1).toEqual({ action: 'continue' });

  const res2 = await input!({ text: '/skill:poteto-mode' }, ctx);
  expect(res2).toEqual({ action: 'continue' });
});

test('registered command handles other skills and expands them', async () => {
  const path = '/pkg/skills/how/SKILL.md';
  const skills = new Map([['how', { path, body: 'How body', description: 'Explore' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  const sent: Array<{ text: string; options: unknown }> = [];
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => { handlers[name] = options.handler; },
    on() {},
    sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
  } as unknown as ExtensionAPI;
  registerCommands(pi, skills, createState(pi));
  const ctx = { ui: { setStatus() {}, setWidget() {}, notify() {} } } as unknown as ExtensionContext;
  await handlers['how']!('explore auth', ctx);
  expect(sent.length).toBe(1);
  expect(sent[0]!.text).toMatch(/How body/);
  expect(sent[0]!.text).toMatch(/explore auth/);
});

test('handleSetup handles non-Error exception and verification offered guard', async () => {
  const path = '/pkg/skills/setup-pstack/SKILL.md';
  const skills = new Map([['setup-pstack', { path, body: 'Body', description: 'Setup' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  const messages: unknown[] = [];
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => { handlers[name] = options.handler; },
    on() {},
    sendMessage: (msg: unknown) => messages.push(msg),
    sendUserMessage() {},
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerCommands(pi, skills, store);
  const errors: string[] = [];
  const ctx = {
    hasUI: true,
    ui: {
      setStatus() {}, setWidget() {}, notify: (msg: string) => errors.push(msg),
      select: () => { throw 'string rejection'; },
    },
  } as unknown as ExtensionContext;

  await handlers['setup-pstack']!('', ctx);
  expect(errors).toEqual(['string rejection']);
  expect(messages.length).toBe(1);
});

test('pstack index entry point wires extension hooks and registers all tools', async () => {
  const pstackModule = await import('../src/index.ts');
  const listeners: Record<string, Function[]> = {};
  const tools: string[] = [];
  const commands: string[] = [];
  const pi = {
    registerCommand: (name: string) => commands.push(name),
    registerTool: (t: { name: string }) => tools.push(t.name),
    on: (event: string, handler: Function) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    appendEntry() {},
    getCommands: () => [],
    getAllTools: () => [],
  } as unknown as ExtensionAPI;
  await pstackModule.default(pi);
  expect(commands.includes('poteto-mode')).toBe(true);
  expect(commands.includes('setup-pstack')).toBe(true);
  expect(tools.includes('TodoWrite')).toBe(true);
  expect(tools.includes('pstack_mode')).toBe(true);
  expect(tools.includes('Task')).toBe(true);

  const ctx = {
    cwd: '/test/cwd',
    sessionManager: { getBranch: () => [], getSessionDir: () => '/tmp', getSessionFile: () => '/tmp/f.jsonl' },
    ui: { setStatus() {}, setWidget() {} },
  } as unknown as ExtensionContext;

  for (const fn of listeners['session_start'] ?? []) fn({}, ctx);
  for (const fn of listeners['session_tree'] ?? []) fn({}, ctx);

  const event1 = { systemPromptOptions: { sections: {} as Record<string, string> } };
  for (const fn of listeners['before_agent_start'] ?? []) await fn(event1, ctx);
  expect(event1.systemPromptOptions.sections.pstack_host).toBeDefined();
  expect(event1.systemPromptOptions.sections.pstack_mode).toBeUndefined();
  expect(event1.systemPromptOptions.sections.pstack_todos).toBeUndefined();
});
