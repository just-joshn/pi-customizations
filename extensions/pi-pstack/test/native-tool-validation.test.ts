import assert from 'node:assert/strict';

import { type Tool, validateToolArguments } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { registerSubscriptions } from '../src/subscriptions/index.ts';
import { TaskParams } from '../src/task/tool.ts';
import { registerTodoWrite } from '../src/todo.ts';

function tools(): Map<string, Tool> {
  const registered = new Map<string, Tool>([['Task', { name: 'Task', description: 'Task', parameters: TaskParams }]]);
  const pi = {
    registerTool: (tool: Tool) => registered.set(tool.name, tool),
    on: () => {},
    registerCommand: () => {},
  } as unknown as ExtensionAPI;
  registerTodoWrite(pi);
  registerSubscriptions(pi, { runFresh: () => {}, ensureSupervisor: () => {} });
  return registered;
}

const cases = [
  {
    name: 'Task',
    args: { description: 'probe', prompt: 'p', environment: 'cloud' },
    coercible: { description: 'probe', prompt: 'p', environment: null, run_in_background: 'true' },
    coerced: { description: 'probe', prompt: 'p', run_in_background: true },
    invalid: { description: 'probe', prompt: 'p', environment: 'remote' },
  },
  {
    name: 'TodoWrite',
    args: { todos: [{ id: 'a', status: 'pending' }], merge: true },
    coercible: { todos: [{ id: 'a', status: null }], merge: 'true' },
    coerced: { todos: [{ id: 'a' }], merge: true },
    invalid: { todos: [{ id: 'a', status: 'done' }], merge: true },
  },
  {
    name: 'subscribe_timer',
    args: { name: 'probe', prompt: 'p', delaySeconds: 1, sessionStrategy: 'new_session' },
    coercible: { name: 'probe', prompt: 'p', delaySeconds: '2', sessionStrategy: null },
    coerced: { name: 'probe', prompt: 'p', delaySeconds: 2 },
    invalid: { name: 'probe', prompt: 'p', sessionStrategy: 'other' },
  },
  {
    name: 'subscribe_github_pr',
    args: { scope: 'repo', repo: 'owner/repo' },
    coercible: { scope: 'repo', repo: 'owner/repo', expiresInHours: '2' },
    coerced: { scope: 'repo', repo: 'owner/repo', expiresInHours: 2 },
    invalid: { scope: 'organization' },
  },
];

test.for(cases)('native validation accepts $name arguments', ({ name, args }) => {
  const tool = tools().get(name);
  assert(tool);
  expect(validateToolArguments(tool, { type: 'toolCall', id: 'call', name, arguments: args })).toEqual(args);
});

test.for(cases)('native validation coerces $name arguments', ({ name, coercible, coerced }) => {
  const tool = tools().get(name);
  assert(tool);
  expect(validateToolArguments(tool, { type: 'toolCall', id: 'call', name, arguments: coercible })).toEqual(coerced);
});

test.for(cases)('native validation rejects invalid $name enums', ({ name, invalid }) => {
  const tool = tools().get(name);
  assert(tool);
  expect(() => validateToolArguments(tool, { type: 'toolCall', id: 'call', name, arguments: invalid })).toThrow(/Validation failed/);
});
