import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultResourceLoader, type Extension, type ExtensionAPI, type ExtensionToolContext, SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import { restartTimerService, startTimerService, timerCommand, timerRecord } from '../scripts/timer-client.mjs';
import { registerTimers, rootExtensions } from '../src/timers.ts';
import { model } from './session-fixture.ts';

vi.mock(import('../scripts/timer-client.mjs'), () => ({ restartTimerService: vi.fn(), startTimerService: vi.fn(), timerCommand: vi.fn(), timerRecord: vi.fn() }));

async function tools() {
  const root = await mkdtemp(join(tmpdir(), 'pstack-timer-tools-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
  vi.stubEnv('PI_PSTACK_TIMER_DIRECTORY', '');
  vi.spyOn(DefaultResourceLoader.prototype, 'reload').mockResolvedValue();
  const definitions: Parameters<ExtensionAPI['registerTool']>[0][] = [];
  const pi = { registerTool: (tool: Parameters<ExtensionAPI['registerTool']>[0]) => definitions.push(tool), getThinkingLevel: () => 'off' } as unknown as ExtensionAPI;
  registerTimers(pi);
  const manager = SessionManager.inMemory(root);
  manager.appendMessage({ role: 'user', content: 'Prior report', timestamp: 1 });
  const ctx = { cwd: root, model, sessionManager: manager, getSystemPrompt: () => 'Follow the test contract.' } as unknown as ExtensionToolContext;
  return {
    root,
    ctx,
    invoke: (name: string, input = {}) => {
      const tool = definitions.find((entry) => entry.name === name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      return tool.execute('test-call', input, undefined, undefined, ctx);
    },
  };
}

test('listing subscriptions for an unused owner starts no process', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  const listed = await f.invoke('ListSubscriptions');
  expect(listed.content).toEqual([{ type: 'text', text: '[]' }]);
  expect(startTimerService).not.toHaveBeenCalled();
  expect(timerCommand).not.toHaveBeenCalled();
});

test('first subscription starts a dedicated root with context and reports ownership', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  vi.mocked(timerCommand).mockResolvedValue(undefined);
  const output = await f.invoke('SubscribeTimer', { name: 'audit', prompt: 'check', delaySeconds: 30 });
  const [directory, launch] = vi.mocked(startTimerService).mock.calls[0];
  expect(directory).toContain(join(f.root, 'pstack-timers'));
  expect(launch.args).toContain('--session-dir');
  expect(await readFile(join(directory, 'system.txt'), 'utf8')).toContain('Follow the test contract.');
  expect(output.details).toMatchObject({ execution: expect.stringContaining('Dedicated persistent Pi root') });
});

test('subscribing to an existing service does not rewrite its launch configuration', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue({ kind: 'ready' });
  await f.invoke('SubscribeTimer', { name: 'audit', prompt: 'check', cron: '* * * * *' });
  expect(startTimerService).not.toHaveBeenCalled();
  expect(timerCommand).toHaveBeenCalledWith(expect.any(String), { type: 'subscribe', timer: { name: 'audit', prompt: 'check', cron: '* * * * *' } });
});

test('missing model and invalid timer inputs fail before starting a service', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  await expect(f.invoke('SubscribeTimer', { name: 'audit', prompt: 'check', delaySeconds: 0 })).rejects.toThrow('Invalid timer');
  const noModel = { ...f.ctx, model: undefined };
  const definitions: Parameters<ExtensionAPI['registerTool']>[0][] = [];
  registerTimers({ registerTool: (tool: Parameters<ExtensionAPI['registerTool']>[0]) => definitions.push(tool) } as unknown as ExtensionAPI);
  const subscribe = definitions.find((tool) => tool.name === 'SubscribeTimer');
  if (!subscribe) throw new Error('SubscribeTimer was not registered.');
  await expect(subscribe.execute('test', { name: 'audit', prompt: 'check', delaySeconds: 1 }, undefined, undefined, noModel)).rejects.toThrow('Choose a Pi model');
  expect(startTimerService).not.toHaveBeenCalled();
});

test('timer roots list and cancel subscriptions in their original owner directory', async () => {
  const f = await tools();
  vi.stubEnv('PI_PSTACK_TIMER_DIRECTORY', join(f.root, 'owner'));
  vi.mocked(timerRecord).mockResolvedValue({ kind: 'ready' });
  await f.invoke('ListSubscriptions');
  await f.invoke('Unsubscribe', { subscriptionId: 'timer-one' });
  expect(timerCommand).toHaveBeenCalledWith(join(f.root, 'owner'), { type: 'list' });
  expect(timerCommand).toHaveBeenCalledWith(join(f.root, 'owner'), { type: 'unsubscribe', subscriptionId: 'timer-one', fromSession: undefined });
});

test('service errors remain visible to callers', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue({ kind: 'failed' });
  vi.mocked(timerCommand).mockRejectedValue(new Error('Timer service unavailable'));
  await expect(f.invoke('Unsubscribe', { subscriptionId: 'timer-one' })).rejects.toThrow('Timer service unavailable');
});

test('recovery restarts the owner and reports its resulting subscriptions', async () => {
  const f = await tools();
  vi.mocked(timerCommand).mockResolvedValue(undefined);
  await f.invoke('RestartSubscriptions');
  expect(restartTimerService).toHaveBeenCalledWith(expect.stringContaining('pstack-timers'));
  expect(timerCommand).toHaveBeenCalledWith(expect.any(String), { type: 'list' });
});

test('extension selection preserves provider modules alongside the sole pstack entry', async () => {
  const f = await tools();
  const baseline = new DefaultResourceLoader({ cwd: f.root, agentDir: f.root }).getExtensions();
  const own = new URL('../src/index.ts', import.meta.url).pathname;
  const entry = { path: own, resolvedPath: own, commands: new Map([['pstack', {}]]) } as Extension;
  const provider = { path: 'provider.ts', resolvedPath: 'provider.ts', commands: new Map() } as Extension;
  expect(rootExtensions({ ...baseline, extensions: [entry, provider] }, own).extensions).toEqual([entry, provider]);
});

test('resource loading errors prevent timer startup', async () => {
  const f = await tools();
  const baseline = new DefaultResourceLoader({ cwd: f.root, agentDir: f.root }).getExtensions();
  vi.spyOn(DefaultResourceLoader.prototype, 'getExtensions').mockReturnValue({ ...baseline, errors: [{ path: 'provider.ts', error: 'provider unavailable' }] });
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  await expect(f.invoke('SubscribeTimer', { name: 'audit', prompt: 'check', delaySeconds: 1 })).rejects.toThrow('provider unavailable');
  expect(startTimerService).not.toHaveBeenCalled();
});
