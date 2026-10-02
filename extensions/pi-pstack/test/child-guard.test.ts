import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import childGuard, { guardEnv } from '../src/subagents/child-guard.ts';

type Guard = Readonly<{ kind: 'remote' | 'teammate'; allowed: readonly string[]; approve: readonly string[] }>;

// A real pi session loads the extension, so the guard sees the same tool_call dispatch a child process does.
async function openChild(guard: string | undefined) {
  vi.stubEnv(guardEnv, guard);
  const dir = await mkdtemp(join(tmpdir(), 'child-guard-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [childGuard] });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, settingsManager, sessionManager: SessionManager.inMemory(dir), resourceLoader, modelRuntime });
  onTestFinished(() => session.dispose());
  await session.bindExtensions({});
  const runner = session.extensionRunner;
  const call = (toolName: string, input: Record<string, unknown> = {}) => runner.emitToolCall({ type: 'tool_call', toolCallId: `call-${toolName}`, toolName, input });
  const answerWith = (confirm: (title: string, message: string) => Promise<boolean>) => runner.setUIContext({ ...runner.getUIContext(), confirm }, 'rpc');
  return { call, answerWith };
}

const config = (guard: Guard): string => JSON.stringify(guard);

test.for([
  { name: 'no guard configured', guard: undefined },
  { name: 'unparseable guard configuration', guard: '{nope' },
  { name: 'guard configuration of the wrong shape', guard: JSON.stringify({ kind: 'remote', allowed: 'bash', approve: [] }) },
  { name: 'guard configuration with an unknown kind', guard: JSON.stringify({ kind: 'local', allowed: [], approve: [] }) },
])('$name leaves every tool call alone', async ({ guard }) => {
  const { call } = await openChild(guard);
  expect(await call('bash', { command: 'rm -rf /' })).toBe(undefined);
});

test('a tool outside the allowed list is blocked and the reason names the agent kind', async () => {
  const { call } = await openChild(config({ kind: 'teammate', allowed: ['read'], approve: [] }));
  expect(await call('bash', { command: 'ls' })).toEqual({ block: true, reason: "Tool 'bash' is not permitted for this teammate agent." });
});

test('an allowed tool that needs no approval runs without asking the parent', async () => {
  const { call, answerWith } = await openChild(config({ kind: 'remote', allowed: ['read', 'bash'], approve: ['bash'] }));
  const asked: string[] = [];
  answerWith(async (title) => {
    asked.push(title);
    return true;
  });
  expect({ verdict: await call('read', { path: '/tmp/x' }), asked }).toEqual({ verdict: undefined, asked: [] });
});

test('an approved tool asks the parent with the relay title and body, then runs when confirmed', async () => {
  const { call, answerWith } = await openChild(config({ kind: 'remote', allowed: ['bash'], approve: ['bash'] }));
  const asked: Array<[string, string]> = [];
  answerWith(async (title, message) => {
    asked.push([title, message]);
    return true;
  });
  expect(await call('bash', { command: 'make' })).toBe(undefined);
  expect(asked).toEqual([['pstack-permission:bash', 'bash {"command":"make"}']]);
});

test('declining the approval blocks the tool', async () => {
  const { call, answerWith } = await openChild(config({ kind: 'remote', allowed: ['bash'], approve: ['bash'] }));
  answerWith(async () => false);
  expect(await call('bash', { command: 'make' })).toEqual({ block: true, reason: 'The parent session did not approve bash.' });
});

test('a failing approval dialog blocks the tool instead of letting it through', async () => {
  const { call, answerWith } = await openChild(config({ kind: 'remote', allowed: ['bash'], approve: ['bash'] }));
  answerWith(() => Promise.reject(new Error('relay closed')));
  expect(await call('bash', { command: 'make' })).toEqual({ block: true, reason: 'The parent session did not approve bash.' });
});

test('a tool that needs approval is blocked when the child has no UI to ask through', async () => {
  const { call } = await openChild(config({ kind: 'teammate', allowed: ['write'], approve: ['write'] }));
  expect(await call('write', { path: '/tmp/x', content: 'y' })).toEqual({ block: true, reason: 'The parent session did not approve write.' });
});
