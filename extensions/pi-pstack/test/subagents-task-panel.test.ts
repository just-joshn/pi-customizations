import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEventBus, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { registerTaskPanel } from '../src/subagents/task-panel.ts';
import type { TaskRecord } from '../src/worker-records.ts';

let dir = '';
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-panel-')));
  vi.stubEnv('PI_CODING_AGENT_DIR', dir);
  vi.stubEnv('HOME', dir);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const record = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't1',
  persona: 'Explore',
  cwd: dir,
  readonly: false,
  sessionFile: join(dir, 't1.jsonl'),
  outputFile: join(dir, 't1.txt'),
  status: 'running',
  output: '',
  description: 'map the repo',
  modelReference: 'p/m:high',
  startedAt: 1000,
  ...overrides,
});

function harness(options: { hasUI?: boolean; trusted?: boolean } = {}) {
  const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
  const events = createEventBus();
  const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), handler]), events } as unknown as ExtensionAPI;
  let records: TaskRecord[] = [record()];
  const setWidget = vi.fn();
  const ctx = {
    hasUI: options.hasUI ?? true,
    cwd: dir,
    ui: { setWidget },
    isProjectTrusted: () => options.trusted ?? true,
    sessionManager: { getSessionId: () => 'parent', getSessionFile: () => join(dir, 'parent.jsonl') },
    modelRegistry: { find: (provider: string, id: string) => (provider === 'p' && id === 'm' ? { contextWindow: 1000 } : undefined) },
  };
  registerTaskPanel(pi, { list: () => records, liveMessages: () => undefined }, {});
  const fire = (name: string, event: unknown = {}) => Promise.all((handlers.get(name) ?? []).map((handler) => handler(event, ctx)));
  return { fire, events, setWidget, setRecords: (next: TaskRecord[]) => (records = next) };
}

test('[C97] session start shows running agents from the registry snapshot', async () => {
  const { fire, setWidget } = harness();
  await fire('session_start');
  expect(setWidget).toHaveBeenLastCalledWith('pstack-agents', ['● Explore: map the repo']);
  await fire('session_shutdown');
});

test('[C97] a settled agent is redrawn as finished and dismissed on the next user input', async () => {
  const { fire, events, setWidget, setRecords } = harness();
  await fire('session_start');
  setRecords([record({ status: 'settled', agentName: 'scout' }), record({ id: 't2', status: 'failed', description: 'broken' })]);
  events.emit('pstack:subagent-settled', { agentId: 't1', status: 'settled' });
  expect(setWidget).toHaveBeenLastCalledWith('pstack-agents', ['✓ scout: map the repo', '✗ Explore: broken']);
  await fire('input', { text: 'next', source: 'interactive' });
  expect(setWidget).toHaveBeenLastCalledWith('pstack-agents', undefined);
  await fire('session_shutdown');
});

test('[C97] without a UI the panel never draws', async () => {
  const { fire, events, setWidget } = harness({ hasUI: false });
  await fire('session_start');
  events.emit('pstack:subagent-started', { agentId: 't1' });
  expect(setWidget.mock.calls).toEqual([]);
  const control = harness();
  await control.fire('session_start');
  expect(control.setWidget).toHaveBeenLastCalledWith('pstack-agents', ['● Explore: map the repo']);
  await control.fire('session_shutdown');
});

test('[C101] status-line output decorates the matching panel row', async () => {
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ subagentStatusLine: { type: 'command', command: `cat > ${join(dir, 'stdin.json')}; echo '{"id":"t1","content":"ctx 5%"}'` } }));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { fire, setWidget } = harness();
  await fire('session_start');
  await vi.advanceTimersByTimeAsync(300);
  await vi.waitFor(() => expect(setWidget).toHaveBeenLastCalledWith('pstack-agents', ['● Explore: map the repo · ctx 5%']));
  await fire('session_shutdown');
  expect(setWidget).toHaveBeenLastCalledWith('pstack-agents', undefined);
});

test('[C99] an untrusted workspace never runs the configured status-line command', async () => {
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ subagentStatusLine: { type: 'command', command: `touch ${join(dir, 'ran')}` } }));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { fire, events } = harness({ trusted: false });
  const logs: unknown[] = [];
  events.on('pstack:subagent-log', (message) => logs.push(message));
  await fire('session_start');
  await vi.advanceTimersByTimeAsync(300);
  expect(logs).toEqual(['Skipping subagentStatusLine execution - workspace trust not accepted']);
  await fire('session_shutdown');
});
