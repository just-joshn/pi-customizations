import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { McpServerConfig } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { deferTools, forwardedUi } from '../src/subagents/child-session.ts';
import { contentExclusionExtension, excludedPath, globToRegExp, isExcluded, parsePatterns } from '../src/subagents/content-exclusion.ts';
import { fileTrackingGate } from '../src/subagents/file-tracking.ts';
import { gatherParentServers, inheritedMcpExtension, serversForChild } from '../src/subagents/mcp-inheritance.ts';
import { writeGateExtension } from '../src/subagents/write-gate.ts';
import { workerFixture } from './worker-fixture.ts';

function fakePi(servers: { name: string; config: Record<string, unknown> }[] = [], _changes = 0) {
  const registered: { name: string; config: unknown }[] = [];
  const handlers = new Map<string, (event: never) => unknown>();
  const pi = {
    getMcpServers: () => servers.map((server) => ({ ...server, extensionPath: '/x' })),
    registerMcpServer: (name: string, config: unknown) => {
      if (name === 'broken') throw new Error('spawn failed');
      registered.push({ name, config });
    },
    on: (name: string, handler: (event: never) => unknown) => {
      handlers.set(name, handler);
      return () => {};
    },
  };
  return { pi: pi as never, registered, fireChange: () => handlers.get('mcp_servers_change')?.({ type: 'mcp_servers_change', servers: [] } as never) };
}

test('gathering waits for the catalog to settle and snapshots every parent server', async () => {
  const { pi } = fakePi([{ name: 'github', config: { command: 'gh' } }]);
  const gathered = await gatherParentServers(pi, { settledMs: 1 });
  expect(gathered).toEqual([{ name: 'github', config: { command: 'gh' } }]);
});

test('the child keeps the parent servers its definition does not own', () => {
  const gathered: { name: string; config: McpServerConfig }[] = [
    { name: 'github', config: { command: 'gh' } },
    { name: 'own', config: { command: 'x' } },
  ];
  expect(serversForChild(gathered, { mcpServers: [{ kind: 'ref', name: 'own' }] })).toEqual([{ name: 'github', config: { command: 'gh' } }]);
  expect(serversForChild(gathered, {})).toEqual(gathered);
});

test('the inherited extension registers servers at start and logs a per-server failure', async () => {
  const registered: { name: string; config: unknown }[] = [];
  const handlers = new Map<string, (event: never) => unknown>();
  const pi = {
    registerMcpServer: (name: string, config: unknown) => {
      if (name === 'broken') throw new Error('spawn failed');
      registered.push({ name, config });
    },
    on: (name: string, handler: (event: never) => unknown) => {
      handlers.set(name, handler);
      return () => {};
    },
  };
  const logs: string[] = [];
  inheritedMcpExtension(
    [
      { name: 'github', config: { command: 'gh' } },
      { name: 'broken', config: { command: 'x' } },
    ],
    (message) => logs.push(message),
  )(pi as never);
  await handlers.get('session_start')?.({ type: 'session_start' } as never);
  expect(registered).toEqual([{ name: 'github', config: { command: 'gh' } }]);
  expect(logs).toEqual(['Failed to refresh MCP tools before subagent creation: broken: spawn failed']);
});

test.for([
  { pattern: 'src/**', path: 'src/a/b.ts', excluded: true },
  { pattern: 'secret.env', path: 'config/secret.env', excluded: true },
  { pattern: 'docs/*.md', path: 'docs/a.md', excluded: true },
  { pattern: 'docs/*.md', path: 'docs/a/b.md', excluded: false },
  { pattern: 'se?ret', path: 'secret', excluded: true },
])('pattern $pattern against $path is excluded: $excluded', ({ pattern, path, excluded }) => {
  expect(isExcluded([pattern], path)).toBe(excluded);
});

test('gated tools refuse excluded paths and other tools do not', () => {
  const patterns = parsePatterns(['secret.env']);
  expect(excludedPath(patterns, 'read', { path: 'config/secret.env' })).toBe('config/secret.env');
  expect(excludedPath(patterns, 'bash', { command: 'cat secret.env' })).toBe(undefined);
  expect(excludedPath([], 'read', { path: 'config/secret.env' })).toBe(undefined);
  expect(globToRegExp('a.b').test('x/a.b')).toBe(true);
  expect(globToRegExp('a.b').test('x/a.b/c')).toBe(false);
});

test('the exclusion extension blocks a gated call on an excluded path', () => {
  const handlers = new Map<string, (event: never) => unknown>();
  const pi = { on: (name: string, handler: (event: never) => unknown) => handlers.set(name, handler), events: { emit: () => {}, on: () => () => {} } };
  contentExclusionExtension(['secret.env'])(pi as never);
  const blocked = handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'read', input: { path: 'config/secret.env' } } as never) as { block: boolean; reason: string };
  expect(blocked).toMatchObject({ block: true, reason: 'config/secret.env blocked by the content exclusion policy' });
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '2', toolName: 'read', input: { path: 'src/a.ts' } } as never)).toBe(undefined);
});

test('the write gate blocks edits while the parent reports plan mode', () => {
  let planMode = true;
  const handlers = new Map<string, (event: never) => unknown>();
  const pi = { on: (name: string, handler: (event: never) => unknown) => handlers.set(name, handler), events: { emit: () => {}, on: () => () => {} } };
  writeGateExtension(() => !planMode)(pi as never);
  const blocked = handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'edit', input: { path: 'a.ts' } } as never) as { block: boolean; reason: string };
  expect(blocked.reason).toBe('The parent session is in plan mode, so this agent cannot modify files.');
  planMode = false;
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '2', toolName: 'edit', input: { path: 'a.ts' } } as never)).toBe(undefined);
});

test.for([
  { name: 'two tools without the flag', effective: ['a', 'b'], aggressive: false, active: ['a', 'b'], deferred: [] },
  { name: 'thirty-one tools past the threshold', effective: Array.from({ length: 31 }, (_, index) => `t${index}`), aggressive: false, active: [], deferred: Array.from({ length: 31 }, (_, index) => `t${index}`) },
  { name: 'the flag with three tools', effective: ['read', 'grep', 'custom'], aggressive: true, active: ['read', 'grep'], deferred: ['custom'] },
])('$name defers the non-core surface', ({ effective, aggressive, active, deferred }) => {
  expect(deferTools(effective, { aggressive })).toEqual({ active, deferred });
});

test('the forwarded ui attributes dialogs to the child', () => {
  const asks: string[] = [];
  const parent = {
    confirm: (title: string) => {
      asks.push(title);
      return Promise.resolve(true);
    },
    notify: () => {},
  };
  const child = forwardedUi(parent as never, 'explore');
  void child.confirm('Run the risky step?', 'message');
  expect(asks).toEqual(['subagent explore: Run the risky step?']);
});

test.for([
  { depth: 0, persisted: false, enabled: false, refusal: true },
  { depth: 0, persisted: true, enabled: true, refusal: false },
  { depth: 1, persisted: false, enabled: false, refusal: false },
])('file tracking for depth $depth persisted $persisted is enabled $enabled', ({ depth, persisted, enabled, refusal }) => {
  const gate = fileTrackingGate(depth, persisted);
  expect({ enabled: gate.enabled, refusal: Boolean(gate.refusal) }).toEqual({ enabled, refusal });
});

test('a child session persists its lineage, tool policy and servers beside the transcript', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('task', { agent_type: 'general-purpose', name: 'lin', description: 'probe', prompt: 'hello', mode: 'background' });
    const id = String((started.details as { agent_id: string }).agent_id);
    const read = await fixture.call('read_agent', { agent_id: id, wait: true });
    expect(read.content[0]).toMatchObject({ text: expect.stringContaining('[Turn 0]') });
    const { globSync } = await import('node:fs');
    const transcript = globSync(join(fixture.dir, 'sessions', '**', 'subagents', '**', 'agent-*.jsonl'))[0];
    const text = await readFile(transcript, 'utf8');
    expect(text).toContain('reference-assistant-child-context');
    expect(text).toContain(['prompt', 'Cache', 'Lineage'].join(''));
    expect(text).toContain('"tools"');
  } finally {
    await fixture.close();
  }
});
