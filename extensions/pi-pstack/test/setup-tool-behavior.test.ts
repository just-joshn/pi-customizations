import type { ExtensionAPI, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { setupModels } from '../src/models.ts';
import { registerSetupTool } from '../src/setup-tool.ts';
import { createState } from '../src/state.ts';

vi.mock(import('../src/models.ts'), () => ({ setupModels: vi.fn() }));

type ToolDefinition = Parameters<ExtensionAPI['registerTool']>[0];

function setupHarness() {
  const tools: ToolDefinition[] = [];
  const messages: string[] = [];
  const pi = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    appendEntry() {},
    sendUserMessage: (text: string) => messages.push(text),
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    mode: 'rpc',
    ui: { setStatus() {}, setWidget() {}, notify() {} },
  } as unknown as ExtensionToolContext;
  registerSetupTool(pi, createState(pi));
  return { tools, messages, ctx };
}

async function runSetup(h: ReturnType<typeof setupHarness>) {
  const tool = h.tools.find((entry) => entry.name === 'pstack_setup');
  if (!tool) throw new Error('pstack_setup was not registered.');
  return tool.execute('setup', {}, undefined, undefined, h.ctx);
}

test('a confirmed setup reports the written configuration and offers verification', async () => {
  vi.mocked(setupModels).mockResolvedValue(true);
  const h = setupHarness();
  const result = await runSetup(h);
  expect(result.details).toEqual({ written: true });
  expect(result.content).toEqual([{ type: 'text', text: 'Model configuration confirmed and saved.' }]);
  expect(h.messages).toHaveLength(1);
  expect(h.messages[0]).toContain('/create-verification-skill');
});

test('a cancelled setup reports that nothing was written', async () => {
  vi.mocked(setupModels).mockResolvedValue(false);
  const h = setupHarness();
  const result = await runSetup(h);
  expect(result.details).toEqual({ written: false });
  expect(result.content).toEqual([{ type: 'text', text: 'Setup cancelled. No configuration was written.' }]);
  expect(h.messages).toEqual([]);
});
