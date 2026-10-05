import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { continuationPrompt, parseGoalArgs, registerGoal } from '../src/goal.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;
type Hook = (...args: unknown[]) => unknown;
type ToolResult = { content: Array<{ type: string; text?: string }>; details: unknown };

function goalHarness(branch: unknown[] = []) {
  const commands = new Map<string, CommandHandler>();
  const tools: ToolDefinition[] = [];
  const hooks = new Map<string, Hook[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const sent: Array<{ text: string; options: unknown }> = [];
  const statuses: Array<[string, string | undefined]> = [];
  const notices: Array<{ message: string; level: string }> = [];
  const pi = {
    registerCommand: (name: string, options: { handler: CommandHandler }) => commands.set(name, options.handler),
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    on: (event: string, handler: Hook) => {
      hooks.set(event, [...(hooks.get(event) ?? []), handler]);
      return () => {};
    },
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
    sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: 'tui',
    hasUI: true,
    cwd: '/workspace',
    ui: {
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      notify: (message: string, level: string) => notices.push({ message, level }),
    },
    sessionManager: {
      getBranch: () => branch,
      getSessionFile: () => '/sessions/goal.jsonl',
      getSessionId: () => 'session-one',
    },
  } as unknown as ExtensionToolContext;
  registerGoal(pi);
  return { commands, tools, hooks, entries, sent, statuses, notices, ctx };
}

type GoalHarness = ReturnType<typeof goalHarness>;

function hooksFor(h: GoalHarness, event: string): Hook[] {
  return h.hooks.get(event) ?? [];
}

async function runGoalCommand(h: GoalHarness, args: string): Promise<void> {
  const handler = h.commands.get('goal');
  if (!handler) throw new Error('goal command was not registered.');
  await handler(args, h.ctx);
}

async function callTool(h: GoalHarness, name: string, params: unknown = {}): Promise<ToolResult> {
  const tool = h.tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return (await tool.execute('test-call', params as never, undefined, undefined, h.ctx)) as unknown as ToolResult;
}

beforeEach(() => {
  vi.stubEnv('PI_PSTACK_HEADLESS', '');
});

test('goal arguments parse time limits and leave other numbers in place', () => {
  expect(parseGoalArgs('45 secs tune the queue')).toEqual({ objective: 'tune the queue', droppedTimeLimit: true });
  expect(parseGoalArgs('1.5h land it')).toEqual({ objective: 'land it', droppedTimeLimit: true });
  expect(parseGoalArgs('30 units land it')).toEqual({ objective: '30 units land it', droppedTimeLimit: false });
});

test('the goal command with no objective reports usage and the current goal', async () => {
  const h = goalHarness();
  await runGoalCommand(h, '   ');
  expect(h.notices).toHaveLength(1);
  expect(h.notices[0]?.message).toContain('Usage: /goal <objective>.');
  expect(h.notices[0]?.message).toContain('No goal.');
  expect(h.notices[0]?.level).toBe('info');
  expect(h.sent).toEqual([]);
  expect(h.entries).toEqual([]);
});

test('a dropped time limit warns and still delivers the objective as the goal skill', async () => {
  const h = goalHarness();
  await runGoalCommand(h, '30m ship the queue');
  expect(h.notices).toEqual([{ message: 'Time limits are unsupported. The goal is created without one.', level: 'warning' }]);
  expect(h.entries).toEqual([]);
  expect(h.sent).toHaveLength(1);
  const delivered = h.sent[0];
  expect(delivered?.options).toEqual({ deliverAs: 'followUp' });
  expect(delivered?.text).toContain('<skill name="goal"');
  expect(delivered?.text).toMatch(/ship the queue$/);
});

test('the command describes an active goal when asked without an objective', async () => {
  const h = goalHarness();
  await callTool(h, 'CreateGoal', { objective: 'Hold the line' });
  await runGoalCommand(h, '');
  expect(h.notices.at(-1)?.message).toContain('Goal (active): Hold the line');
  expect(h.notices.at(-1)?.level).toBe('info');
});

test('clearing without a goal only notifies', async () => {
  const h = goalHarness();
  await runGoalCommand(h, '  CLEAR ');
  expect(h.notices).toEqual([{ message: 'Goal cleared.', level: 'info' }]);
  expect(h.entries).toEqual([]);
});

test('clearing an active goal persists the cleared status', async () => {
  const h = goalHarness();
  await callTool(h, 'CreateGoal', { objective: 'Wind down' });
  await runGoalCommand(h, 'clear');
  expect(h.entries.at(-1)).toEqual({ customType: 'pstack-goal', data: { objective: 'Wind down', status: 'cleared' } });
  expect(h.statuses.at(-1)).toEqual(['pstack-goal', undefined]);
  expect((await callTool(h, 'GetGoal')).details).toEqual({ objective: 'Wind down', status: 'cleared' });
});

test('goal tools create, read, complete, and refuse conflicting transitions', async () => {
  const h = goalHarness();
  const initial = await callTool(h, 'GetGoal');
  expect(initial.details).toBeNull();
  expect(initial.content).toEqual([{ type: 'text', text: 'No goal.' }]);

  const created = await callTool(h, 'CreateGoal', { objective: 'Audit every requirement' });
  expect(created.details).toEqual({ objective: 'Audit every requirement', status: 'active' });
  expect(created.content).toEqual([{ type: 'text', text: 'Goal (active): Audit every requirement' }]);
  expect(h.entries.at(-1)).toEqual({ customType: 'pstack-goal', data: { objective: 'Audit every requirement', status: 'active' } });
  expect(h.statuses.at(-1)).toEqual(['pstack-goal', 'goal']);

  await expect(callTool(h, 'CreateGoal', { objective: 'Another goal' })).rejects.toThrow('A goal is already active. Goal (active): Audit every requirement');

  const complete = await callTool(h, 'UpdateGoal', { status: 'complete' });
  expect(complete.details).toEqual({ objective: 'Audit every requirement', status: 'complete' });
  expect(complete.content).toEqual([{ type: 'text', text: 'Goal (complete): Audit every requirement' }]);
  expect(h.statuses.at(-1)).toEqual(['pstack-goal', undefined]);

  await expect(callTool(h, 'UpdateGoal', { status: 'complete' })).rejects.toThrow('No active goal to complete.');
  expect((await callTool(h, 'GetGoal')).details).toEqual({ objective: 'Audit every requirement', status: 'complete' });
});

test('session restore keeps the last valid goal entry and ignores malformed ones', async () => {
  const branch = [
    { type: 'message', message: {} },
    { type: 'custom', customType: 'pstack-goal', data: { objective: 'Superseded', status: 'complete' } },
    { type: 'custom', customType: 'pstack-goal', data: { objective: 'Restored objective', status: 'active' } },
    { type: 'custom', customType: 'pstack-goal', data: { objective: '', status: 'bogus' } },
    { type: 'custom', customType: 'pstack-state', data: { enabled: true } },
  ];
  const h = goalHarness(branch);
  hooksFor(h, 'session_start')[0]?.({ type: 'session_start' }, h.ctx);
  expect(h.statuses.at(-1)).toEqual(['pstack-goal', 'goal']);
  expect((await callTool(h, 'GetGoal')).details).toEqual({ objective: 'Restored objective', status: 'active' });
});

test('session tree restore reflects the selected branch and clears the status', async () => {
  const h = goalHarness([{ type: 'custom', customType: 'pstack-goal', data: { objective: 'Tree goal', status: 'complete' } }]);
  hooksFor(h, 'session_tree')[0]?.({ type: 'session_tree' }, h.ctx);
  expect(h.statuses.at(-1)).toEqual(['pstack-goal', undefined]);
  expect((await callTool(h, 'GetGoal')).details).toEqual({ objective: 'Tree goal', status: 'complete' });
});

test('the system prompt carries an active goal and drops a stale section', async () => {
  const h = goalHarness();
  const before = { systemPromptOptions: { sections: { pstack_goal: 'stale', other: 'kept' } } };
  hooksFor(h, 'before_agent_start')[0]?.(before, h.ctx);
  expect(before.systemPromptOptions.sections).toEqual({ other: 'kept' });

  await callTool(h, 'CreateGoal', { objective: 'Pursue the goal' });
  const during = { systemPromptOptions: { sections: {} as Record<string, string> } };
  hooksFor(h, 'before_agent_start')[0]?.(during, h.ctx);
  expect(during.systemPromptOptions.sections['pstack_goal']).toBe('Active goal. Pursue it to completion and never shrink its scope.\nPursue the goal');

  await callTool(h, 'UpdateGoal', { status: 'complete' });
  const after = { systemPromptOptions: { sections: { pstack_goal: 'stale' } as Record<string, string> } };
  hooksFor(h, 'before_agent_start')[0]?.(after, h.ctx);
  expect('pstack_goal' in after.systemPromptOptions.sections).toBe(false);
});

test('settlement continuation only fires for an active goal after a completed turn', async () => {
  const h = goalHarness();
  const settle = hooksFor(h, 'agent_before_settle')[0];
  const completed = { type: 'agent_before_settle', outcome: 'completed' };
  expect(settle?.(completed)).toBeUndefined();

  await callTool(h, 'CreateGoal', { objective: 'Finish the audit' });
  expect(settle?.({ type: 'agent_before_settle', outcome: 'aborted' })).toBeUndefined();
  expect(settle?.(completed)).toEqual({
    entries: [{ type: 'custom_message', customType: 'pstack-goal-continue', display: true, content: continuationPrompt('Finish the audit') }],
    continue: true,
  });

  await callTool(h, 'UpdateGoal', { status: 'complete' });
  expect(settle?.(completed)).toBeUndefined();
});
