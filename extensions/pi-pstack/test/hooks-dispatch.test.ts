import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { type HookBase, HookDispatcher, type HookEventPayload, type HookRequest } from '../src/subagents/hook-dispatch.ts';
import type { HookEventName, HookTable } from '../src/subagents/hook-table.ts';

async function setup() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'hook-dispatch-')));
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  const published: HookEventPayload[] = [];
  const dispatcher = new HookDispatcher((payload) => published.push(payload));
  const base = { session_id: 's-1', cwd } satisfies HookBase;
  const request = (overrides: Partial<HookRequest> = {}): HookRequest => ({ event: 'PreToolUse', subject: 'Bash', base, settings: {}, ...overrides });
  return { cwd, published, dispatcher, request };
}

function tableFor(event: HookEventName, command: string, matcher?: string): HookTable {
  return { [event]: [{ ...(matcher ? { matcher } : {}), hooks: [{ command }] }] };
}

test('only hooks whose matcher fits the subject run', async () => {
  const { dispatcher, request } = await setup();
  const settings: HookTable = { PreToolUse: [{ matcher: 'Read', hooks: [{ command: 'echo read' }] }, { matcher: 'Bash', hooks: [{ command: 'echo bash' }] }] };
  const runs = await dispatcher.fire(request({ settings }));
  expect(runs.map((run) => run.stdout)).toEqual(['bash\n']);
});

test('firing with no matching hook runs nothing and publishes nothing', async () => {
  const { dispatcher, published, request } = await setup();
  const runs = await dispatcher.fire(request({ settings: tableFor('PreToolUse', 'echo hi', 'Read') }));
  expect({ runs, published }).toEqual({ runs: [], published: [] });
});

test('a matching settings hook receives the base fields, event name and input on stdin', async () => {
  const { cwd, dispatcher, request } = await setup();
  const [run] = await dispatcher.fire(request({ settings: tableFor('PreToolUse', 'cat', 'Bash|Edit'), input: { tool_name: 'Bash', tool_input: { command: 'ls' } } }));
  expect(run?.json).toEqual({ session_id: 's-1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
});

test('settings hooks run before the hooks registered for the agent', async () => {
  const { dispatcher, request } = await setup();
  dispatcher.register('agent-1', tableFor('PreToolUse', 'echo own'));
  const runs = await dispatcher.fire(request({ agentId: 'agent-1', settings: tableFor('PreToolUse', 'echo settings') }));
  expect(runs.map((run) => run.stdout)).toEqual(['settings\n', 'own\n']);
});

test('agent hooks are skipped when disabled, when no agent id is given, or after release', async () => {
  const { dispatcher, request } = await setup();
  dispatcher.register('agent-1', tableFor('PreToolUse', 'echo own'));
  expect(await dispatcher.fire(request({ agentId: 'agent-1', agentHooks: false }))).toEqual([]);
  expect(await dispatcher.fire(request())).toEqual([]);
  expect(dispatcher.has('agent-1')).toBe(true);
  dispatcher.release('agent-1');
  expect(dispatcher.has('agent-1')).toBe(false);
  expect(await dispatcher.fire(request({ agentId: 'agent-1' }))).toEqual([]);
});

test('registering several agents keeps each table and an undefined table registers nothing', async () => {
  const { dispatcher, request } = await setup();
  dispatcher.register('a', tableFor('PreToolUse', 'echo a'));
  dispatcher.register('b', tableFor('PreToolUse', 'echo b'));
  dispatcher.register('c', undefined);
  expect([dispatcher.has('a'), dispatcher.has('b'), dispatcher.has('c')]).toEqual([true, true, false]);
  dispatcher.release('a');
  const runs = await dispatcher.fire(request({ agentId: 'b' }));
  expect(runs.map((run) => run.stdout)).toEqual(['b\n']);
});

test('firing reports the event with agent identity, tool and per-hook exit codes', async () => {
  const { dispatcher, published, request } = await setup();
  await dispatcher.fire(request({ event: 'PostToolUse', agentId: 'agent-9', agentType: 'reviewer', toolName: 'Bash', settings: tableFor('PostToolUse', 'exit 0') }));
  expect(published).toEqual([{ hook_event_name: 'PostToolUse', agent_id: 'agent-9', agent_type: 'reviewer', tool_name: 'Bash', hooks: [{ command: 'exit 0', exit_code: 0 }], outcome: 'success' }]);
});

test('the report omits identity fields that were not supplied', async () => {
  const { dispatcher, published, request } = await setup();
  await dispatcher.fire(request({ event: 'SubagentStart', subject: 'reviewer', settings: tableFor('SubagentStart', 'true') }));
  expect(published).toEqual([{ hook_event_name: 'SubagentStart', hooks: [{ command: 'true', exit_code: 0 }], outcome: 'success' }]);
});

test.for([
  { name: 'exit code 2 on PreToolUse is blocked', event: 'PreToolUse', command: 'exit 2', outcome: 'blocked' },
  { name: 'exit code 2 on PermissionRequest is blocked', event: 'PermissionRequest', command: 'exit 2', outcome: 'blocked' },
  { name: 'exit code 2 on PostToolUse is an error', event: 'PostToolUse', command: 'exit 2', outcome: 'error' },
  { name: 'exit code 1 on PreToolUse is an error', event: 'PreToolUse', command: 'exit 1', outcome: 'error' },
] as const)('outcome: $name', async ({ event, command, outcome }) => {
  const { dispatcher, published, request } = await setup();
  await dispatcher.fire(request({ event, settings: tableFor(event, command) }));
  expect(published.map((payload) => payload.outcome)).toEqual([outcome]);
});

test('the timeout cap applies to hooks fired through the dispatcher', async () => {
  const { dispatcher, published, request } = await setup();
  await dispatcher.fire(request({ timeoutCapMs: 50, settings: tableFor('PreToolUse', 'sleep 30') }));
  expect(published).toEqual([{ hook_event_name: 'PreToolUse', hooks: [{ command: 'sleep 30', exit_code: 124 }], outcome: 'error' }]);
});
