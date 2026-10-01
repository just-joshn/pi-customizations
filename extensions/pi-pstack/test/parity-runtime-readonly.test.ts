import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { registerContext } from '../src/context.ts';
import { registerGoal } from '../src/goal.ts';
import { registerShells } from '../src/shells.ts';
import { TaskParameters } from '../src/worker-records.ts';
import { registerWorkers } from '../src/workers.ts';
import { workerFixture } from './worker-fixture.ts';

const sdkTypes = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'core/extensions/types.d.ts');

test('the SDK tool annotations that could classify extension tools are unverified author hints', async () => {
  const types = await readFile(sdkTypes, 'utf8');
  expect(types).toContain("They come from the tool's\n * author and are not verified;");
  expect(types).toMatch(/readOnlyHint\?: boolean;/);
});

test('Task offers one readonly boolean and no mode that keeps extension tools', () => {
  expect(TaskParameters.properties.readonly).toMatchObject({ type: 'boolean' });
  expect(Object.keys(TaskParameters.properties).filter((name) => /readonly|write|tools|access/i.test(name))).toEqual(['readonly']);
});

test('this package registers write-capable extension tools that declare no read-only hint', () => {
  const tools: ToolDefinition[] = [];
  const pi = { registerTool: (tool: ToolDefinition) => tools.push(tool), registerCommand() {}, on() {}, appendEntry() {} } as never;
  for (const register of [registerShells, registerWorkers, registerGoal, registerContext]) register(pi);
  const hints = new Map(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint === true]));
  expect(hints.get('BackgroundShell')).toBe(false);
  expect(hints.get('Task')).toBe(false);
  expect(hints.get('GetGoal')).toBe(true);
});

test('a readonly child keeps exactly the four read tools and drops every extension tool', async () => {
  const f = await workerFixture();
  try {
    await f.call('Task', { prompt: 'readonly review', model: 'worker-test/deterministic', readonly: true, run_in_background: false });
    expect(JSON.parse(await readFile(join(f.dir, 'child-tools.txt'), 'utf8')).sort()).toEqual(['find', 'grep', 'ls', 'read']);
  } finally {
    await f.close();
  }
});
