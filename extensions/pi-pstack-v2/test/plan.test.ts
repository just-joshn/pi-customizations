import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { isPlanWritablePath, PLAN_ENTRY } from '../src/plan.ts';
import { createWorld, type Host, loadPstack, promptFor, type World } from './core-host.ts';

const GUEST_PLAN_PATH = '/workspace/plans/migration.md';
const GUEST_TODO_PATH = '/workspace/TODO.md';
const GUEST_SRC_PATH = '/workspace/src/index.ts';

let world: World;
let host: Host;

beforeEach(() => {
  world = createWorld();
  host = loadPstack(world);
});

afterEach(() => {
  world.dispose();
});

describe('isPlanWritablePath', () => {
  test('allows plans, TODO.md, .pi/TODO.md, Gondolin workspace paths, and @-prefixed paths, and rejects implementation or outside paths', () => {
    expect(isPlanWritablePath('plans/migration.md', world.cwd)).toBe(true);
    expect(isPlanWritablePath('  plans/migration.md  ', world.cwd)).toBe(true);
    expect(isPlanWritablePath(GUEST_PLAN_PATH, world.cwd)).toBe(true);
    expect(isPlanWritablePath('@plans/migration.md', world.cwd)).toBe(true);
    expect(isPlanWritablePath(GUEST_TODO_PATH, world.cwd)).toBe(true);
    expect(isPlanWritablePath('TODO.md', world.cwd)).toBe(true);
    expect(isPlanWritablePath('.pi/TODO.md', world.cwd)).toBe(true);
    expect(isPlanWritablePath('src/index.ts', world.cwd)).toBe(false);
    expect(isPlanWritablePath(GUEST_SRC_PATH, world.cwd)).toBe(false);
    expect(isPlanWritablePath('../plans/escape.md', world.cwd)).toBe(false);
  });
});

describe('plan command and tool-call enforcement', () => {
  test('on enables plan mode, adds the prompt section, and blocks writes outside plans', async () => {
    await host.command('plan').handler('on', host.ctx());
    expect(host.setStatus).toHaveBeenLastCalledWith(PLAN_ENTRY, 'plan');
    expect((await promptFor(host)).sections[PLAN_ENTRY]).toContain('Plan mode is active');

    const blockedWrite = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c1', toolName: 'write', input: { path: 'src/app.ts', content: 'x' } });
    expect(blockedWrite).toMatchObject({ block: true });

    const blockedEdit = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c2', toolName: 'edit', input: { path: 'src/app.ts' } });
    expect(blockedEdit).toMatchObject({ block: true });

    const allowedPlan = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c3', toolName: 'write', input: { path: 'plans/arch.md', content: '# Plan' } });
    expect(allowedPlan).toBeUndefined();

    const allowedTodo = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c4', toolName: 'write', input: { path: 'TODO.md', content: '- [ ] step' } });
    expect(allowedTodo).toBeUndefined();

    const blockedMalformed = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c4b', toolName: 'write', input: { content: 'missing path' } });
    expect(blockedMalformed).toMatchObject({ block: true });

    const blockedSubagent = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c4c', toolName: 'subagent', input: { agent: 'poteto-agent', task: 'edit code' } });
    expect(blockedSubagent).toMatchObject({ block: true });

    const allowedScout = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c4d', toolName: 'subagent', input: { agent: 'scout', task: 'read code' } });
    expect(allowedScout).toBeUndefined();

    const allowedStop = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c4e', toolName: 'subagent', input: { stop: 'job-123' } });
    expect(allowedStop).toBeUndefined();
  });
});

describe('plan command lifecycle and mode integration', () => {
  test('off disables plan mode and restores editing', async () => {
    await host.command('plan').handler('on', host.ctx());
    await host.command('plan').handler('off', host.ctx());
    expect(host.setStatus).toHaveBeenLastCalledWith(PLAN_ENTRY, undefined);
    expect((await promptFor(host)).sections[PLAN_ENTRY]).toBeUndefined();
    const allowed = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'c5', toolName: 'write', input: { path: 'src/app.ts', content: 'x' } });
    expect(allowed).toBeUndefined();
  });

  test('passing a goal enables plan mode and immediately sends the goal as a user message', async () => {
    await host.command('plan').handler('design the new storage layer', host.ctx());
    expect(host.sendUserMessage).toHaveBeenCalledWith('design the new storage layer');
    expect((await promptFor(host)).sections[PLAN_ENTRY]).toContain('Plan mode is active');
  });

  test('plan mode restores across session_start and session_tree', async () => {
    await host.command('plan').handler('on', host.ctx());
    const resumed = loadPstack(world);
    resumed.setBranch(host.branch());
    await resumed.fire('session_start', {});
    expect((await promptFor(resumed)).sections[PLAN_ENTRY]).toContain('Plan mode is active');
  });

  test('pstack-mode with skill and prompt activates persistent mode and sends the prompt in one command', async () => {
    await host.command('pstack-mode').handler('poteto-mode fix the login race', host.ctx());
    expect(host.setStatus).toHaveBeenLastCalledWith('pstack-mode', 'mode: poteto-mode');
    expect(host.sendUserMessage).toHaveBeenCalledWith('fix the login race');
  });
});
