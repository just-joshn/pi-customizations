import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, DefaultResourceLoader, type Extension, type ExtensionAPI, type ExtensionToolContext, SessionManager } from '@earendil-works/pi-coding-agent';
import { Check } from 'typebox/value';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { restartTimerService, startTimerService, timerCommand, timerRecord } from '../scripts/timer-client.mjs';
import { registerTimers, rootExtensions } from '../src/timers.ts';
import { model } from './session-fixture.ts';

vi.mock(import('../scripts/timer-client.mjs'), () => ({ restartTimerService: vi.fn(), startTimerService: vi.fn(), timerCommand: vi.fn(), timerRecord: vi.fn() }));

beforeEach(() => {
  for (const mocked of [restartTimerService, startTimerService, timerCommand, timerRecord]) vi.mocked(mocked).mockReset();
  vi.mocked(timerCommand).mockResolvedValue([] as never);
});

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
  const ctx = { cwd: root, model, sessionManager: manager, getSystemPrompt: () => 'Follow the test contract.', isProjectTrusted: () => true } as unknown as ExtensionToolContext;
  return {
    root,
    ctx,
    definitions,
    invoke: (name: string, input = {}, override?: ExtensionToolContext, signal?: AbortSignal) => {
      const tool = definitions.find((entry) => entry.name === name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      return tool.execute('test-call', input, signal, undefined, override ?? ctx);
    },
  };
}

test('listing subscriptions for an unused owner starts no process', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  const listed = await f.invoke('ListSubscriptions');
  expect(listed.content).toEqual([{ type: 'text', text: '[]' }]);
  expect(listed.structuredContent).toEqual([]);
  expect(startTimerService).not.toHaveBeenCalled();
  expect(timerCommand).not.toHaveBeenCalled();
});

test('large subscription lists bound model text and preserve complete data', async () => {
  const f = await tools();
  const receipts = Array.from({ length: 64 }, (_, index) => ({ name: `timer-${index}`, prompt: '界'.repeat(1000), delaySeconds: 30, subscriptionId: `subscription-${index}`, runId: 'root-1', sessionFile: '/session', rpcDirectory: '/rpc' }));
  vi.mocked(timerRecord).mockResolvedValue({ kind: 'ready' });
  vi.mocked(timerCommand).mockResolvedValue(JSON.parse(JSON.stringify(receipts)));
  const output = await f.invoke('ListSubscriptions');
  const text = output.content.find((block) => block.type === 'text');
  if (text?.type !== 'text') throw new Error('Expected model-facing text');
  expect(Buffer.byteLength(text.text)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
  expect(text.text.split('\n').length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
  expect(text.text).toContain('[Output truncated.');
  expect(text.text).not.toContain('\ufffd');
  expect(output.details).toEqual(receipts);
  expect(output.structuredContent).toEqual(receipts);
});

test('first subscription starts a dedicated root with context and reports ownership', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  vi.mocked(timerCommand).mockResolvedValue({ name: 'audit', prompt: 'check', delaySeconds: 30, subscriptionId: 'timer-1', runId: 'root-1', sessionFile: '/session', rpcDirectory: '/rpc' } as never);
  const output = await f.invoke('SubscribeTimer', { name: 'audit', prompt: 'check', delaySeconds: 30 });
  const [directory, launch] = vi.mocked(startTimerService).mock.calls[0];
  expect(directory).toContain(join(f.root, 'pstack-timers'));
  expect(launch.args).toContain('--session-dir');
  expect(await readFile(join(directory, 'system.txt'), 'utf8')).toContain('Follow the test contract.');
  expect(output.details).toMatchObject({ execution: expect.stringContaining('Dedicated persistent Pi root') });
  expect(output.structuredContent).toEqual(output.details);
  const schema = f.definitions.find((tool) => tool.name === 'SubscribeTimer')?.outputSchema;
  if (!schema) throw new Error('Missing SubscribeTimer output schema');
  expect(Check(schema, output.structuredContent)).toBe(true);
});

test.for([true, false])('timer discovery and child launch preserve parent project trust %s', async (projectTrusted) => {
  const f = await tools();
  vi.mocked(DefaultResourceLoader.prototype.reload).mockRestore();
  const project = join(f.root, '.pi');
  await mkdir(join(project, 'extensions'), { recursive: true });
  const discoveredMarker = join(f.root, 'discovered-marker');
  const configuredMarker = join(f.root, 'configured-marker');
  const extension = (marker: string) => `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); export default function () {}`;
  await writeFile(join(project, 'extensions', 'probe.ts'), extension(discoveredMarker));
  await writeFile(join(f.root, 'configured.ts'), extension(configuredMarker));
  await writeFile(join(project, 'settings.json'), JSON.stringify({ extensions: [join(f.root, 'configured.ts')] }));
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  const trust = vi.fn().mockReturnValueOnce(projectTrusted).mockReturnValue(!projectTrusted);
  await f.invoke('SubscribeTimer', { name: 'trust', prompt: 'check', delaySeconds: 30 }, { ...f.ctx, isProjectTrusted: trust });
  expect(trust).toHaveBeenCalledTimes(1);
  const launch = vi.mocked(startTimerService).mock.calls[0]?.[1];
  if (!launch) throw new Error('Missing timer launch');
  expect(launch.args).toContain(projectTrusted ? '--approve' : '--no-approve');
  expect(launch.args).not.toContain(projectTrusted ? '--no-approve' : '--approve');
  expect(existsSync(discoveredMarker)).toBe(projectTrusted);
  expect(existsSync(configuredMarker)).toBe(projectTrusted);
  expect(launch.args.includes(join(project, 'extensions', 'probe.ts'))).toBe(projectTrusted);
  expect(launch.args.includes(join(f.root, 'configured.ts'))).toBe(projectTrusted);
});

test('subscribing to an existing service does not rewrite its launch configuration', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue({ kind: 'ready' });
  await f.invoke('SubscribeTimer', { name: 'audit', prompt: 'check', cron: '* * * * *' });
  expect(startTimerService).not.toHaveBeenCalled();
  expect(timerCommand).toHaveBeenCalledWith(expect.any(String), { type: 'subscribe', timer: { name: 'audit', prompt: 'check', cron: '* * * * *' } }, undefined, undefined);
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
  expect(timerCommand).toHaveBeenCalledWith(join(f.root, 'owner'), { type: 'list' }, undefined, undefined);
  expect(timerCommand).toHaveBeenCalledWith(join(f.root, 'owner'), { type: 'unsubscribe', subscriptionId: 'timer-one', fromSession: undefined }, undefined, undefined);
});

test('service errors remain visible to callers', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue({ kind: 'failed' });
  vi.mocked(timerCommand).mockRejectedValue(new Error('Timer service unavailable'));
  await expect(f.invoke('Unsubscribe', { subscriptionId: 'timer-one' })).rejects.toThrow('Timer service unavailable');
});

test('the owner key isolates sessions and an explicit directory overrides it', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  await f.invoke('ListSubscriptions');
  await f.invoke('ListSubscriptions');
  const [first, second] = vi.mocked(timerRecord).mock.calls.map((call) => call[0]);
  expect(first).toBe(second);
  expect(first).toContain(join(f.root, 'pstack-timers'));

  const other = { ...f.ctx, sessionManager: SessionManager.inMemory(f.root) } as ExtensionToolContext;
  await f.invoke('ListSubscriptions', {}, other);
  const isolated = vi.mocked(timerRecord).mock.calls.at(-1)?.[0];
  expect(isolated).not.toBe(first);

  vi.stubEnv('PI_PSTACK_TIMER_DIRECTORY', join(f.root, 'shared-owner'));
  await f.invoke('ListSubscriptions', {}, other);
  expect(vi.mocked(timerRecord).mock.calls.at(-1)?.[0]).toBe(join(f.root, 'shared-owner', 'status.json'));
});

test('a GitHub CI subscription starts the owner service with normalized defaults', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  vi.mocked(timerCommand).mockResolvedValue({ subscriptionId: 'ci-github-1' } as never);
  const output = await f.invoke('SubscribeGithubCI', { pr: 12 });
  expect(timerCommand).toHaveBeenCalledWith(
    expect.any(String),
    {
      type: 'subscribe_ci',
      ci: expect.objectContaining({ forge: 'github', pr: 12, cwd: f.root, pollSeconds: 30, name: 'ci-github-cwd-12' }),
    },
    undefined,
    undefined,
  );
  expect(output.details).toMatchObject({ subscriptionId: 'ci-github-1', execution: expect.stringContaining('Dedicated persistent Pi root') });
  expect(startTimerService).toHaveBeenCalledTimes(1);
});

test('an origin CI subscription is refused without a command and forwards one when configured', async () => {
  const f = await tools();
  vi.stubEnv('PI_PSTACK_ORIGIN_CI_COMMAND', '');
  await expect(f.invoke('SubscribeOriginCI', { pr: 7 })).rejects.toThrow('Origin CI subscriptions are unsupported');
  expect(startTimerService).not.toHaveBeenCalled();

  vi.stubEnv('PI_PSTACK_ORIGIN_CI_COMMAND', '/fixture/origin-ci');
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  vi.mocked(timerCommand).mockResolvedValue({ subscriptionId: 'ci-origin-1' } as never);
  await f.invoke('SubscribeOriginCI', { pr: 7 });
  expect(timerCommand).toHaveBeenCalledWith(expect.any(String), { type: 'subscribe_ci', ci: expect.objectContaining({ forge: 'origin', pr: 7, command: ['/fixture/origin-ci'] }) }, undefined, undefined);
});

test('CI subscriptions refuse to launch without a chosen model', async () => {
  const f = await tools();
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  const noModel = { ...f.ctx, model: undefined } as unknown as ExtensionToolContext;
  await expect(f.invoke('SubscribeGithubCI', { pr: 3 }, noModel)).rejects.toThrow('Choose a Pi model');
  expect(startTimerService).not.toHaveBeenCalled();
});

test('a malformed cron schedule is rejected before any service starts', async () => {
  const f = await tools();
  await expect(f.invoke('SubscribeTimer', { name: 'audit', prompt: 'check', cron: '61 * * * *' })).rejects.toThrow('Invalid cron range');
  expect(timerRecord).not.toHaveBeenCalled();
  expect(startTimerService).not.toHaveBeenCalled();
});

test('recovery restarts the owner and reports its resulting subscriptions', async () => {
  const f = await tools();
  vi.mocked(timerCommand).mockResolvedValue([] as never);
  const output = await f.invoke('RestartSubscriptions');
  expect(output.structuredContent).toEqual([]);
  expect(restartTimerService).toHaveBeenCalledWith(expect.stringContaining('pstack-timers'), undefined);
  expect(timerCommand).toHaveBeenCalledWith(expect.any(String), { type: 'list' }, undefined, undefined);
});

test('extension selection preserves provider modules alongside the sole pstack entry', async () => {
  const f = await tools();
  const baseline = new DefaultResourceLoader({ cwd: f.root, agentDir: f.root }).getExtensions();
  const own = new URL('../src/index.ts', import.meta.url).pathname;
  const entry = { path: own, resolvedPath: own, commands: new Map([['pstack', {}]]) } as Extension;
  const provider = { path: 'provider.ts', resolvedPath: 'provider.ts', commands: new Map() } as Extension;
  expect(rootExtensions({ ...baseline, extensions: [entry, provider] }, own).extensions).toEqual([entry, provider]);
});

test('timer tools publish output contracts and accurate exposure', async () => {
  const f = await tools();
  for (const tool of f.definitions) {
    expect(tool.outputSchema).toBeDefined();
    expect(tool.exposure).toBe('direct');
    expect(tool.executionMode).toBe('sequential');
    expect(tool.annotations).toBeDefined();
  }
});

test.for(['SubscribeTimer', 'SubscribeGithubCI', 'SubscribeOriginCI', 'RestartSubscriptions', 'ListSubscriptions', 'Unsubscribe'])('pre-aborted %s does not load resources or contact the durable service', async (name) => {
  const f = await tools();
  await expect(f.invoke(name, {}, undefined, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  expect(timerRecord).not.toHaveBeenCalled();
  expect(startTimerService).not.toHaveBeenCalled();
  expect(restartTimerService).not.toHaveBeenCalled();
  expect(timerCommand).not.toHaveBeenCalled();
  expect(DefaultResourceLoader.prototype.reload).not.toHaveBeenCalled();
});

test('cancellation during resource loading prevents service startup', async () => {
  const f = await tools();
  const controller = new AbortController();
  vi.spyOn(DefaultResourceLoader.prototype, 'reload').mockImplementation(async () => {
    controller.abort();
  });
  await expect(f.invoke('SubscribeTimer', { name: 'cancel', prompt: 'check', delaySeconds: 30 }, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(startTimerService).not.toHaveBeenCalled();
  expect(timerCommand).not.toHaveBeenCalled();
});

test('the timer tool forwards the caller signal without assigning it to the durable root', async () => {
  const f = await tools();
  const controller = new AbortController();
  vi.mocked(timerRecord).mockResolvedValue({ kind: 'ready' });
  await f.invoke('SubscribeTimer', { name: 'signal', prompt: 'check', delaySeconds: 30 }, undefined, controller.signal);
  expect(timerCommand).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ type: 'subscribe' }), undefined, controller.signal);
});

test('timer launch retains discovered provider extension arguments', async () => {
  const f = await tools();
  const baseline = new DefaultResourceLoader({ cwd: f.root, agentDir: f.root }).getExtensions();
  const provider = { path: 'provider.ts', resolvedPath: 'provider.ts', commands: new Map() } as Extension;
  vi.spyOn(DefaultResourceLoader.prototype, 'getExtensions').mockReturnValue({ ...baseline, extensions: [provider] });
  await f.invoke('SubscribeTimer', { name: 'provider', prompt: 'check', delaySeconds: 30 });
  expect(vi.mocked(startTimerService).mock.calls[0][1].args.slice(-2)).toEqual(['-e', 'provider.ts']);
});

test('resource loading errors prevent timer startup', async () => {
  const f = await tools();
  const baseline = new DefaultResourceLoader({ cwd: f.root, agentDir: f.root }).getExtensions();
  vi.spyOn(DefaultResourceLoader.prototype, 'getExtensions').mockReturnValue({ ...baseline, errors: [{ path: 'provider.ts', error: 'provider unavailable' }] });
  vi.mocked(timerRecord).mockResolvedValue(undefined);
  await expect(f.invoke('SubscribeTimer', { name: 'audit', prompt: 'check', delaySeconds: 1 })).rejects.toThrow('provider unavailable');
  expect(startTimerService).not.toHaveBeenCalled();
});
