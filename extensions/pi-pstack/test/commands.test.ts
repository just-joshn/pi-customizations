import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerCommands, registerNativeInput } from '../src/commands.ts';
import { createState } from '../src/state.ts';

test('/poteto-mode off and /skill:poteto-mode off give the same confirmation', async () => {
  const path = '/pkg/skills/poteto-mode/SKILL.md';
  const skills = new Map([['poteto-mode', { path, body: 'Body', description: 'Mode' }]]);
  const handlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
  let input: ((event: { text: string }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
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
