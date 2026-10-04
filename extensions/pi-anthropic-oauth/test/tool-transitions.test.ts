import type { Context, Tool } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import { assistantTurn, readTool, user } from './support/context.ts';
import { test } from './support/fixtures.ts';
import { sseReply } from './support/messages-server.ts';
import { isRecord, messagesOf, soleRequest } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';
import { toolUseMessage } from './support/sse.ts';

const task: Tool = { name: 'task', description: 'first active task', parameters: { type: 'object', properties: { first: { type: 'string' } } } };
const collision: Tool = { ...task, name: 'Task', description: 'shadowed Task', parameters: { type: 'object', properties: { second: { type: 'number' } } } };
const redefined: Tool = { ...task, description: 'updated task' };

function transcript(initial: Tool[], added: Tool[], removed: string[] = []): Context {
  return {
    messages: [
      { role: 'system', content: 'test prompt', toolsAdded: initial, timestamp: 1 },
      user('first'),
      assistantTurn({ content: [{ type: 'text', text: 'ok' }] }),
      { role: 'system', content: '', toolsAdded: added, toolsRemoved: removed.map((name) => ({ name })), timestamp: 3 },
      user('next'),
    ],
  };
}

function changes(body: unknown): Record<string, unknown>[] {
  return messagesOf(body).flatMap((message) => {
    if (!isRecord(message) || !Array.isArray(message['content'])) return [];
    return message['content'].filter(isRecord).filter((block) => block['type'] === 'tool_addition' || block['type'] === 'tool_removal');
  });
}

function taskDeclaration(body: unknown): unknown {
  const initial = isRecord(body) && Array.isArray(body['tools']) ? body['tools'] : [];
  return changes(body).reduce<unknown>(
    (current, block) => {
      if (!isRecord(block['tool'])) return current;
      if (block['type'] === 'tool_removal' && block['tool']['name'] === 'Task') return undefined;
      const definition = block['tool']['definition'];
      return isRecord(definition) && definition['name'] === 'Task' ? definition : current;
    },
    initial.find((tool) => isRecord(tool) && tool['name'] === 'Task'),
  );
}

const cases = [
  { name: 'first definition in a colliding addition batch wins', initial: [readTool], added: [task, collision], removed: [], expected: task },
  { name: 'a later case-colliding tool does not redefine the first active tool', initial: [readTool, task], added: [collision], removed: [], expected: task },
  { name: 'same-name redefinition keeps its new definition', initial: [readTool, task], added: [redefined], removed: [], expected: redefined },
  { name: 'removing the first tool promotes the previously shadowed definition', initial: [readTool, task, collision], added: [], removed: ['task'], expected: collision },
  { name: 'removing a shadow does not withdraw the first active tool', initial: [readTool, task, collision], added: [], removed: ['Task'], expected: task },
  { name: 'removing and readding a winner preserves native active ordering', initial: [readTool, task, collision], added: [task], removed: ['task'], expected: collision },
  { name: 'exact duplicates in a delta retain the native last definition', initial: [readTool], added: [task, redefined], removed: [], expected: redefined },
];
const methods: readonly ('stream' | 'streamSimple')[] = ['stream', 'streamSimple'];

test.for(cases.flatMap((spec) => methods.map((method) => ({ ...spec, method }))))('$name via $method', async ({ initial, added, removed, expected, method }, { models, model, server }) => {
  const context = transcript(initial, added, removed);
  const before = structuredClone(context);
  const routed = { ...model, compat: { ...model.compat, supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } };
  const modelBefore = structuredClone(routed);
  server.respond(sseReply(toolUseMessage('transition-call', 'Task', ['{}'])));
  const run = await collect(models[method](routed, context));

  expect(taskDeclaration(soleRequest(server).body)).toMatchObject({ name: 'Task', description: expected.description, input_schema: expected.parameters });
  expect(run.message.content).toEqual([expect.objectContaining({ type: 'toolCall', name: expected.name })]);
  expect(context).toEqual(before);
  expect(routed).toEqual(modelBefore);
});

test('case-folded custom names outside the canonical alias list retain first-active dispatch', async ({ models, model, server }) => {
  const first = { ...task, name: 'custom_probe' };
  const shadow = { ...collision, name: 'CUSTOM_PROBE' };
  const routed = { ...model, compat: { ...model.compat, supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } };
  server.respond(sseReply(toolUseMessage('custom-call', 'CUSTOM_PROBE', ['{}'])));
  const run = await collect(models.streamSimple(routed, transcript([readTool, first], [shadow])));
  const body = soleRequest(server).body;

  expect(isRecord(body) ? body['tools'] : undefined).toMatchObject([{ name: 'Read' }, { name: 'custom_probe', description: 'first active task', input_schema: task.parameters }]);
  expect(run.message.content).toEqual([expect.objectContaining({ type: 'toolCall', name: 'custom_probe' })]);
});

test('concurrent requests keep opposite collision winners isolated without changing inputs', async ({ models, model, server }) => {
  const first = transcript([readTool, task], [collision]);
  const second = transcript([readTool, collision], [task]);
  const before = structuredClone([first, second]);
  const routed = Object.freeze({ ...model, compat: Object.freeze({ ...model.compat, supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true }) });
  server.respond(sseReply(toolUseMessage('concurrent-call', 'Task', ['{}'])));
  const runs = await Promise.all([collect(models.stream(routed, Object.freeze(first))), collect(models.streamSimple(routed, Object.freeze(second)))]);

  expect(runs.map((run) => run.message.content)).toEqual([[expect.objectContaining({ type: 'toolCall', name: 'task' })], [expect.objectContaining({ type: 'toolCall', name: 'Task' })]]);
  expect([first, second]).toEqual(before);
});

test('catalog capabilities retain the first active declaration after a shadow addition', async ({ models, server }) => {
  const model = models.getModel('claude-subscription', 'claude-opus-4-8');
  if (!model) throw new Error('missing native-transition catalog model');
  const context = transcript([readTool, task], [collision]);
  await collect(models.streamSimple({ ...model, baseUrl: server.baseUrl }, context));

  expect(taskDeclaration(soleRequest(server).body)).toMatchObject({ name: 'Task', description: 'first active task', input_schema: task.parameters });
});

test('unambiguous tool changes keep inline definitions and the fixed initial prefix', async ({ models, model, server }) => {
  const routed = { ...model, compat: { ...model.compat, supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } };
  await collect(models.streamSimple(routed, transcript([readTool], [task])));
  const body = soleRequest(server).body;

  expect(isRecord(body) ? body['tools'] : undefined).toEqual([expect.objectContaining({ name: 'Read', description: 'Read a file' }), expect.objectContaining({ name: '__pi_deferred_placeholder__', defer_loading: true })]);
  expect(changes(body)).toEqual([expect.objectContaining({ type: 'tool_addition', tool: { type: 'tool_definition', definition: expect.objectContaining({ name: 'Task', description: 'first active task' }) } })]);
});
