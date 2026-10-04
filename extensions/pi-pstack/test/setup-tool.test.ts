import type { ExtensionAPI, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { registerSetupTool } from '../src/setup-tool.ts';
import { createState } from '../src/state.ts';

test('natural language setup uses the same interactive gate and rejects unattended writes', async () => {
  let definition: Parameters<ExtensionAPI['registerTool']>[0] | undefined;
  const pi = {
    registerTool: (tool: typeof definition) => {
      definition = tool;
    },
    appendEntry() {},
  } as unknown as ExtensionAPI;
  registerSetupTool(pi, createState(pi));
  expect(definition?.name).toBe('pstack_setup');
  expect(definition?.exposure).toBe('model-only');
  expect(definition?.executionMode).toBe('sequential');
  expect(definition?.outputSchema).toBeDefined();
  expect(definition?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  await expect(definition?.execute('setup', {}, undefined, undefined, { hasUI: false } as ExtensionToolContext)).rejects.toThrow('requires Pi interactive or RPC dialog UI');
});
