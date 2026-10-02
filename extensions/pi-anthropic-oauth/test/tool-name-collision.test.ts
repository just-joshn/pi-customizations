import type { Tool } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import { ask, readTool } from './support/context.ts';
import { test } from './support/fixtures.ts';
import { isRecord, soleRequest, toolNames } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';

function agentTool(name: string): Tool {
  return {
    name,
    description: `the ${name} tool`,
    parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
  };
}

function cacheMarkers(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value.flatMap(cacheMarkers);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => (key === 'cache_control' ? [child] : cacheMarkers(child)));
}

function toolDescriptions(body: unknown): readonly string[] {
  if (!isRecord(body) || !Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) => (isRecord(tool) && typeof tool.description === 'string' ? [tool.description] : []));
}

test('a tool set that differs only in case still sends unique tool names', async ({ models, model, server }) => {
  const prompt = ask('hi', { tools: [readTool, agentTool('task'), agentTool('Task')] });
  await collect(models.streamSimple(model, prompt));
  const names = toolNames(soleRequest(server).body);
  const folded = names.map((name) => name.toLowerCase());
  expect(new Set(folded).size).toBe(folded.length);
});

test('the first tool of a case-colliding pair is the one the request keeps', async ({ models, model, server }) => {
  const prompt = ask('hi', { tools: [readTool, agentTool('task'), agentTool('Task')] });
  await collect(models.streamSimple(model, prompt));
  const { body } = soleRequest(server);
  expect(toolNames(body)).toStrictEqual(['Read', 'Task']);
  expect(toolDescriptions(body)).toStrictEqual(['Read a file', 'the task tool']);
});

test('a tool set without a case collision keeps every tool', async ({ models, model, server }) => {
  const prompt = ask('hi', { tools: [readTool, agentTool('task')] });
  await collect(models.streamSimple(model, prompt));
  expect(toolNames(soleRequest(server).body)).toStrictEqual(['Read', 'Task']);
});

test('dropping a colliding last tool keeps the one-hour marker on the new last tool', async ({ models, model, server }) => {
  const prompt = ask('hi', { tools: [readTool, agentTool('Task'), agentTool('task')] });
  await collect(models.streamSimple(model, prompt));
  const { body } = soleRequest(server);
  expect(toolNames(body)).toStrictEqual(['Read', 'Task']);
  const tools = isRecord(body) && Array.isArray(body.tools) ? body.tools : [];
  expect(cacheMarkers(tools[tools.length - 1])).toHaveLength(1);
  expect(cacheMarkers(body).length).toBeGreaterThanOrEqual(3);
});
