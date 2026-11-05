import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import {
  BUILD_IN_WORKER,
  BUILD_LOCALLY,
  PLAN_BASH,
  PLAN_ENTRY,
  PLAN_SAVE,
  PROPOSE_CHANGES,
  parsePlanArgs,
  planBlockReason,
  planBody,
  planFileName,
  planFromBranch,
  planSection,
  planTitle,
  planTodos,
  planTools,
  registerPlanMode,
  SWITCH_MODE,
  savePlan,
  syncPlanTodoStatuses,
} from '../src/plan.ts';

type Handler = (event: unknown, ctx: unknown) => unknown;

function harness(initialTools = ['read', 'bash', 'edit', 'write', 'Task', 'TodoWrite', 'AskQuestion', 'stop_agent', 'mcp', SWITCH_MODE], options: Parameters<typeof registerPlanMode>[1] = {}) {
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const entries: { type: string; customType: string; data: unknown }[] = [];
  const sent: { text: string; options: unknown }[] = [];
  const notes: string[] = [];
  const status = new Map<string, string | undefined>();
  let active = [...initialTools];
  const pi = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, options),
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active = [...names];
    },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: 'custom', customType, data: structuredClone(data) }),
    sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
  } as unknown as ExtensionAPI;
  const answers: unknown[] = [];
  const asked: { kind: string; title: string; options?: string[] }[] = [];
  const ctx = {
    hasUI: true,
    cwd: process.cwd(),
    isIdle: () => true,
    ui: {
      notify: (text: string) => notes.push(text),
      setStatus: (key: string, text: string | undefined) => status.set(key, text),
      theme: { fg: (_color: string, text: string) => text },
      select: async (title: string, choices: string[]) => {
        asked.push({ kind: 'select', title, options: choices });
        return answers.shift();
      },
      confirm: async (title: string) => {
        asked.push({ kind: 'confirm', title });
        return answers.shift();
      },
    },
    sessionManager: { getBranch: () => entries, getSessionId: () => '01a1a4d1-28f8-7233-860b-05294fd5bb1a' },
  };
  const plan = registerPlanMode(pi, options);
  const emit = (event: string, payload: unknown = {}) => (handlers.get(event) ?? []).map((handler) => handler(payload, ctx));
  const run = (args: string) => (commands.get('plan') as { handler: (args: string, ctx: unknown) => Promise<void> }).handler(args, ctx);
  const tool = (name: string) =>
    tools.find((candidate) => candidate.name === name) as unknown as {
      execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
    };
  const call = (name: string, params: unknown) => tool(name).execute('call', params, undefined, undefined, ctx);
  return { plan, tools, entries, sent, notes, status, emit, run, call, answers, asked, active: () => active, setActive: (names: string[]) => (active = names) };
}

test('parses the command forms', () => {
  expect(parsePlanArgs('')).toEqual({ kind: 'on', task: '' });
  expect(parsePlanArgs(' off ')).toEqual({ kind: 'off' });
  expect(parsePlanArgs('on')).toEqual({ kind: 'on', task: '' });
  expect(parsePlanArgs('add a cache layer')).toEqual({ kind: 'on', task: 'add a cache layer' });
});

test('registers the sandboxed shell and CreatePlan inactive, and SwitchMode active', () => {
  const { tools } = harness();
  expect(tools.map((tool) => [tool.name, tool.defaultActive])).toEqual([
    [PLAN_BASH, false],
    [PLAN_SAVE, false],
    [SWITCH_MODE, undefined],
  ]);
  expect(tools[0]?.description).toContain('denies filesystem writes and Unix sockets. Network requests work');
});

test('a bare /plan enters plan mode, as Cursor does, and /plan off restores the exact earlier set', async () => {
  const h = harness();
  const before = h.active();
  expect(h.plan.section()).toBeUndefined();

  await h.run('');
  expect(h.notes.at(-1)).toContain('on');
  expect(h.active().toSorted()).toEqual(['AskQuestion', PLAN_BASH, PLAN_SAVE, SWITCH_MODE, 'Task', 'TodoWrite', 'edit', 'find', 'grep', 'ls', 'read', 'stop_agent', 'write'].toSorted());
  expect(h.status.get('pstack-plan')).toBe('plan');
  expect(h.plan.section()).toBe(planSection(undefined));
  expect(h.sent).toEqual([]);

  await h.run('off');
  expect(h.active()).toEqual(before);
  expect(h.status.get('pstack-plan')).toBeUndefined();
  expect(h.plan.section()).toBeUndefined();
  expect(h.entries.map((entry) => entry.data)).toEqual([{ enabled: true, toolsBefore: before }, { enabled: false }]);
});

test('/plan <task> sends the task, and a second /plan keeps the first saved tool set', async () => {
  const h = harness();
  const before = h.active();
  await h.run('investigate the flaky test');
  expect(h.sent).toEqual([{ text: 'investigate the flaky test', options: { expandPromptTemplates: true } }]);
  await h.run('another task');
  await h.run('off');
  expect(h.active()).toEqual(before);
});

test('plan mode never activates Task when it was off before', async () => {
  expect(planTools(['read', 'bash', 'edit'])).toEqual(['read', 'grep', 'find', 'ls', PLAN_BASH, PLAN_SAVE, 'edit']);
});

test('a plan file is named in Cursor shape from its name or its title', () => {
  expect(planFileName('Ship the /plan flow!', '0123456789abcdef')).toBe('Ship the plan flow-01234567.plan.md');
  expect(planFileName('   ', '0123456789abcdef')).toBe('Plan-01234567.plan.md');
  expect([planTitle('intro\n# Cache layer\n\nbody'), planTitle('First line of text\nmore'), planTitle('')]).toEqual(['Cache layer', 'First line of text', 'Plan']);
});

test("CreatePlan writes Cursor's plan file: the chat id, the todos as front matter, then the plan", () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-plans-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const path = savePlan('session-1', '# Tiny plan\n\n- step', undefined, [{ id: 'one', content: 'Say "hi"' }], dir);
  expect(path).toMatch(new RegExp(`^${dir}/Tiny plan-[0-9a-f]{8}\\.plan\\.md$`));
  expect(readFileSync(path, 'utf8')).toBe(['<!-- session-1 -->', '---', 'todos:', '  - id: "one"', '    content: "Say \\"hi\\""', '    status: pending', 'isProject: false', '---', '# Tiny plan', '', '- step'].join('\n'));
  expect(planBody(path)).toBe('# Tiny plan\n\n- step');
  expect(savePlan('session-1', '# Tiny plan\n\nrevised', undefined, [], dir)).toBe(path);
  expect(readFileSync(path, 'utf8')).toBe('<!-- session-1 -->\n# Tiny plan\n\nrevised');
  expect(savePlan('session-2', '# Tiny plan', undefined, [], dir)).not.toBe(path);
});

test('a project with no root todos still saves its phases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-plans-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const file = savePlan('session', '# Project', undefined, [], dir, { is_project: true, phases: [{ name: 'First', todos: [{ id: 'one', content: 'First task' }] }, { name: 'Empty' }] });
  expect(readFileSync(file, 'utf8')).toBe(
    '<!-- session -->\n---\nisProject: true\nphases:\n  - name: "First"\n    todos:\n      - id: "one"\n        content: "First task"\n        status: pending\n  - name: "Empty"\n    todos:\n---\n# Project',
  );
  expect(planTodos(file)).toEqual([]);
});

test('plan status synchronization preserves scalar quotes, comments, CRLF, and unrelated todos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-plans-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'Plan.plan.md');
  const before = [
    '<!-- session -->',
    '---',
    'todos:',
    '  - id: first',
    '    content: First',
    '    status: "pending" # Keep the note',
    '    dependencies: [prior]',
    '  - id: second',
    '    content: Second',
    "    status: 'in_progress'",
    '  - id: other',
    '    content: Other',
    '    status: cancelled',
    'custom: keep',
    '---',
    '# Plan',
    '',
    'Body text.',
  ].join('\r\n');
  writeFileSync(file, before);
  expect(planTodos(file)).toEqual([
    { id: 'first', content: 'First', status: 'pending', dependencies: ['prior'] },
    { id: 'second', content: 'Second', status: 'in_progress' },
    { id: 'other', content: 'Other', status: 'cancelled' },
  ]);
  syncPlanTodoStatuses(file, [
    { id: 'first', content: 'First', status: 'in_progress' },
    { id: 'second', content: 'Second', status: 'completed' },
  ]);
  expect(readFileSync(file, 'utf8')).toBe(before.replace('"pending"', '"in_progress"').replace("'in_progress'", "'completed'"));
  expect(planBody(file)).toBe('# Plan\n\nBody text.');
});

test.for([
  { name: 'block LF', metadata: 'todos:\n  - id: work\n    content: Work # keep', expected: 'todos:\n  - status: completed\n    id: work\n    content: Work # keep', newline: '\n' },
  { name: 'block CRLF', metadata: 'todos:\n  - id: work\n    content: Work # keep', expected: 'todos:\n  - status: completed\n    id: work\n    content: Work # keep', newline: '\r\n' },
  { name: 'flow', metadata: 'todos: [{ id: work, content: Work }]', expected: 'todos: [{status: completed,  id: work, content: Work }]', newline: '\n' },
  { name: 'flow with trailing comma', metadata: 'todos: [{ id: work, content: Work, }]', expected: 'todos: [{status: completed,  id: work, content: Work, }]', newline: '\n' },
])('synchronizes an omitted optional status in $name metadata', ({ metadata, expected, newline }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-plans-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'Plan.plan.md');
  const before = `<!-- session -->\n---\n${metadata}\ncustom: keep\n---\n# Plan\n`.replaceAll('\n', newline);
  writeFileSync(file, before);
  expect(planTodos(file)).toEqual([{ id: 'work', content: 'Work', status: 'pending' }]);
  syncPlanTodoStatuses(file, [{ id: 'work', content: 'Work', status: 'pending' }]);
  expect(readFileSync(file, 'utf8')).toBe(before);

  syncPlanTodoStatuses(file, [{ id: 'work', content: 'Work', status: 'completed' }]);

  expect(readFileSync(file, 'utf8')).toBe(before.replace(metadata.replaceAll('\n', newline), expected.replaceAll('\n', newline)));
  expect(planTodos(file)).toEqual([{ id: 'work', content: 'Work', status: 'completed' }]);
});

test.for([
  { metadata: 'todos: [', error: 'Invalid plan metadata' },
  { metadata: 'todos: wrong', error: 'must be a list' },
  { metadata: 'todos: [{id: a, content: A, status: wrong}]', error: 'Invalid plan todo' },
  { metadata: 'todos: [{id: a, content: A, dependencies: [12]}]', error: 'Invalid todo dependencies' },
])('rejects edited plan metadata that cannot describe a todo list $metadata', ({ metadata, error }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-plans-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'Plan.plan.md');
  const before = `<!-- session -->\n---\n${metadata}\n---\n# Plan`;
  writeFileSync(file, before);
  expect(() => planTodos(file)).toThrow(error);
  expect(readFileSync(file, 'utf8')).toBe(before);
});

test('/plan build needs a saved plan, and otherwise hands the plan to the next turn', async () => {
  const h = harness();
  await h.run('build');
  expect(h.notes.at(-1)).toContain('No saved plan to build');
  expect(h.sent).toEqual([]);

  await h.run('on');
  const saved = await h.call(PLAN_SAVE, { name: 'Build it', plan: '# Build it\n\n- first', todos: [{ id: 'a', content: 'first' }] });
  const path = String(saved.details['planFile']);
  onTestFinished(() => rmSync(path, { force: true }));
  expect(saved.content[0]?.text).toBe(`Created the plan file ${path}.\nTo change the plan, edit that file; do not call ${PLAN_SAVE} again.`);
  expect(h.plan.section()).toContain(`The plan is saved at ${path}.`);

  const before = h.active();
  await h.run('build');
  expect(h.notes.at(-1)).toBe(`Building ${path}.`);
  expect(h.active()).not.toContain(PLAN_BASH);
  expect(h.active()).not.toContain(PLAN_SAVE);
  expect(h.status.get('pstack-plan')).toBeUndefined();
  expect(before).toContain(PLAN_SAVE);
  expect(h.sent).toEqual([{ text: [`Build the plan saved at ${path}. Follow it.`, '', '# Build it', '', '- first'].join('\n'), options: { expandPromptTemplates: true } }]);
});

test("after a run that saved a plan, the user picks build or propose changes, as Cursor's plan card asks", async () => {
  const h = harness();
  await h.run('on');
  const saved = await h.call(PLAN_SAVE, { plan: '# Review me\n\n- one' });
  const path = String(saved.details['planFile']);
  onTestFinished(() => rmSync(path, { force: true }));
  h.answers.push(PROPOSE_CHANGES);
  h.emit('agent_settled', { aborted: false });
  await vi.waitFor(() => expect(h.answers).toEqual([]));
  expect([h.asked.at(-1)?.options, h.plan.enabled(), h.sent]).toEqual([[BUILD_LOCALLY, PROPOSE_CHANGES], true, []]);

  await h.call(PLAN_SAVE, { plan: '# Review me\n\n- two' });
  h.answers.push(BUILD_LOCALLY);
  h.emit('agent_settled', { aborted: false });
  await vi.waitFor(() => expect(h.sent).toHaveLength(1));
  expect([h.plan.enabled(), h.sent.at(-1)?.text]).toEqual([false, [`Build the plan saved at ${path}. Follow it.`, '', '# Review me', '', '- two'].join('\n')]);
  h.emit('agent_settled', { aborted: false });
  expect(h.asked).toHaveLength(2);

  h.answers.push(PROPOSE_CHANGES);
  await h.run('');
  await vi.waitFor(() => expect(h.asked).toHaveLength(3));
  expect([h.plan.enabled(), h.asked.at(-1)?.title]).toEqual([true, `Plan saved at ${path}. Build it?`]);
});

test('a plan-build handoff imports into the first session but not a later new session', () => {
  const file = savePlan('worker-import', '# Worker plan', undefined, [{ id: 'build', content: 'Build', dependencies: ['design'] }]);
  onTestFinished(() => rmSync(file, { force: true }));
  const imports: unknown[] = [];
  const h = harness(undefined, { buildPlan: file, setTodos: (todos) => imports.push(todos) });

  h.emit('session_start');
  h.entries.splice(0);
  h.emit('session_start');

  expect(imports).toEqual([[{ id: 'build', content: 'Build', status: 'pending', dependencies: ['design'] }]]);
  expect(h.entries).toEqual([]);
  expect(h.plan.enabled()).toBe(false);
});

test('the build-in-a-worker choice leaves plan mode and starts an isolated worker with the plan', async () => {
  const builds: string[] = [];
  const h = harness(undefined, {
    buildInWorker: async (_file, request) => {
      builds.push(request);
      return 'agent-1';
    },
  });
  await h.run('on');
  const path = String((await h.call(PLAN_SAVE, { plan: '# Worker plan' })).details['planFile']);
  onTestFinished(() => rmSync(path, { force: true }));
  h.answers.push(BUILD_IN_WORKER);
  h.emit('agent_settled', { aborted: false });
  await vi.waitFor(() => expect(h.notes.at(-1)).toContain('isolated worker'));
  expect([h.asked.at(-1)?.options, h.plan.enabled(), builds, h.notes.at(-1)]).toEqual([
    [BUILD_LOCALLY, BUILD_IN_WORKER, PROPOSE_CHANGES],
    false,
    [`Build the plan saved at ${path}. Follow it.\n\n# Worker plan`],
    `Building ${path} in an isolated worker (agent agent-1). Its result arrives as a Task notification.`,
  ]);
});

test("SwitchMode moves between agent and plan mode only with the user's approval", async () => {
  const h = harness();
  h.answers.push(false);
  expect((await h.call(SWITCH_MODE, { target_mode_id: 'plan', explanation: 'Several designs fit.' })).content[0]?.text).toBe('The user declined the switch to plan mode. Stay in agent mode.');
  expect([h.asked.at(-1), h.plan.enabled()]).toEqual([{ kind: 'confirm', title: 'Switch to Plan mode?' }, false]);
  h.answers.push(true);
  expect((await h.call(SWITCH_MODE, { target_mode_id: 'plan' })).content[0]?.text.startsWith('Switched to plan mode.')).toBe(true);
  expect([h.plan.enabled(), h.active().includes(PLAN_BASH)]).toEqual([true, true]);
  expect((await h.call(SWITCH_MODE, { target_mode_id: 'plan' })).content[0]?.text).toBe('Already in plan mode.');
  h.answers.push(true);
  expect((await h.call(SWITCH_MODE, { target_mode_id: 'agent' })).content[0]?.text).toBe('Switched to agent mode. Plan mode restrictions no longer apply, and every tool is back.');
  expect([h.plan.enabled(), h.active().includes(PLAN_BASH), h.active().includes('bash')]).toEqual([false, false, true]);
});

test('lets plan mode edit only markdown files, blocks other writers and unknown tools, and lets Task run unchanged for it to restrict (C-M1)', async () => {
  const h = harness();
  const call = (toolName: string, input: Record<string, unknown> = {}) => ({ result: h.emit('tool_call', { toolName, input })[0], input });
  expect(call('write', { path: 'src/a.ts' }).result).toBeUndefined();

  await h.run('on');
  expect(call('write', { path: 'src/a.ts' }).result).toEqual({ block: true, reason: planBlockReason('write', { path: 'src/a.ts' }) });
  expect(planBlockReason('edit', { path: 'a.ts' })).toBe('Cannot edit non markdown files in plan mode');
  expect([call('edit', { path: 'docs/plan.md' }).result, call('write', { path: '/home/u/.pi/agent/pstack/plans/X-01234567.plan.md' }).result]).toEqual([undefined, undefined]);
  // Cursor CLI 2026.11.05's list: .md .markdown .mdown .mkd .mkdn .mdx in any case, and not .mdc.
  expect(['A.MDX', 'b.mdown', 'c.mkd', 'd.mkdn', 'e.Markdown'].map((path) => planBlockReason('write', { path }))).toEqual([undefined, undefined, undefined, undefined, undefined]);
  expect(planBlockReason('write', { path: 'rules/x.mdc' })).toBe('Cannot edit non markdown files in plan mode');
  expect((call('bash').result as { reason: string }).reason).toContain(PLAN_BASH);
  expect((call('mcp').result as { block: boolean }).block).toBe(true);
  expect(call('read').result).toBeUndefined();
  const task = call('Task', { prompt: 'look', description: 'x', readonly: false });
  expect([task.result, task.input]).toEqual([undefined, { prompt: 'look', description: 'x', readonly: false }]);
  expect(h.plan.enabled()).toBe(true);
  await h.run('off');
  expect(h.plan.enabled()).toBe(false);
});

test('restores plan mode from the session and drops a stray plan shell when off', async () => {
  const h = harness();
  await h.run('on');
  const saved = (h.entries.at(-1) as { data: unknown }).data as { toolsBefore: string[] };
  h.setActive(['read', 'bash', 'edit']);
  h.emit('session_start');
  expect(h.active()).toContain(PLAN_BASH);
  expect(h.active()).not.toContain('bash');
  await h.run('off');
  expect(h.active()).toEqual(saved.toolsBefore);

  h.setActive([...h.active(), PLAN_BASH]);
  h.emit('session_start');
  expect(h.active()).not.toContain(PLAN_BASH);
});

test('leaving the planning branch restores the tools from before planning', async () => {
  const h = harness();
  const before = h.active();
  await h.run('on');
  expect(h.active()).not.toContain('bash');

  h.entries.splice(0);
  h.emit('session_tree');

  expect(h.plan.enabled()).toBe(false);
  expect(h.active()).toEqual(before);
});

test('reads the last plan entry and treats malformed data as off', () => {
  const entry = (data: unknown) => ({ type: 'custom', customType: PLAN_ENTRY, data });
  expect(planFromBranch([])).toEqual({ enabled: false });
  expect(planFromBranch([entry({ enabled: true, toolsBefore: ['read'] }), entry({ enabled: false })])).toEqual({ enabled: false });
  expect(planFromBranch([entry({ enabled: true, toolsBefore: ['read', 3] })])).toEqual({ enabled: true });
  expect(planFromBranch([entry(null)])).toEqual({ enabled: false });
});

test('a stored plan path outside the plans folder never reaches a build', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-plans-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const outside = join(dir, 'secret.txt');
  const inside = join(dir, 'plans', 'Plan-01234567.plan.md');
  expect(planFromBranch([{ type: 'custom', customType: PLAN_ENTRY, data: { enabled: false, planFile: outside } }], join(dir, 'plans'))).toEqual({ enabled: false });
  expect(planFromBranch([{ type: 'custom', customType: PLAN_ENTRY, data: { enabled: false, planFile: inside } }], join(dir, 'plans'))).toEqual({ enabled: false, planFile: inside });
});
