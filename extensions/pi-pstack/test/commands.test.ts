import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.deepEqual(await input!({ text: '/skill:poteto-mode off' }, ctx), { action: 'handled' });
  assert.equal(store.read().enabled, false);
  assert.deepEqual(notices, ['Poteto mode is off.', 'Poteto mode is off.']);
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
  assert.equal(store.read().enabled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text, /my task/);

  const transformed = await input!({ text: '/skill:poteto-mode investigate', images: [] }, ctx) as { action: string; text: string };
  assert.equal(transformed.action, 'transform');
  assert.match(transformed.text, /investigate/);
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
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /\/setup-pstack requires Pi interactive or RPC dialog UI/);

  const res = await input!({ text: '/skill:setup-pstack' }, ctx);
  assert.deepEqual(res, { action: 'handled' });
  assert.equal(errors.length, 2);
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
  assert.deepEqual(res1, { action: 'continue' });

  const res2 = await input!({ text: '/skill:poteto-mode' }, ctx);
  assert.deepEqual(res2, { action: 'continue' });
});
