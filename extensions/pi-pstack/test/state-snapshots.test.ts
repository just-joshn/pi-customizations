import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createState, registerStateTools } from '../src/state.ts';

test('TodoWrite publishes independent todos rather than caller-owned records', async () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (tool: ToolDefinition) => { tools.push(tool); } } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus() {}, setWidget() {} } } as unknown as ExtensionContext;
  const store = createState(pi);
  registerStateTools(pi, store);
  const tool = tools.find(tool => tool.name === 'TodoWrite');
  assert.ok(tool);
  const todo = Object.freeze({ id: 'one', content: 'First', status: 'pending' });
  const params = Object.freeze({ todos: Object.freeze([todo]) });
  const result = await tool.execute('one', params, undefined, undefined, ctx);
  const todos = result.details as typeof params.todos;
  assert.deepEqual(todos, [{ id: 'one', content: 'First', status: 'pending' }]);
  assert.notEqual(todos, params.todos);
  assert.notEqual(todos[0], params.todos[0]);
  await tool.execute('two', { todos: [{ id: 'one', content: 'Second', status: 'completed' }] }, undefined, undefined, ctx);
  assert.equal(todos[0]?.content, 'First');
  assert.equal(store.read().todos[0]?.content, 'Second');
});

test('state snapshots never alias caller input, published entries, or previous reads', () => {
  const published: unknown[] = [];
  const pi = { appendEntry: (_type: string, data: unknown) => { published.push(data); } } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus: () => {}, setWidget: () => {} } } as unknown as ExtensionContext;
  const store = createState(pi);
  const input = { enabled: true, todos: [{ id: 'one', content: 'First', status: 'pending' as const }] };
  store.update(input, ctx);
  const snapshot = store.read();
  assert.deepEqual(snapshot, input);
  assert.notEqual(snapshot, input);
  assert.notEqual(snapshot.todos[0], input.todos[0]);
  assert.notEqual(snapshot, published[0]);
  assert.notEqual(store.read().todos, snapshot.todos);
  store.toggle(false, ctx);
  assert.equal(snapshot.enabled, true);
  assert.equal(store.read().enabled, false);
});
