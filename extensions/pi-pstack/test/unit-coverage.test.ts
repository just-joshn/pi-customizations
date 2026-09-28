import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerShells } from '../src/shells.ts';
import { pick } from '../src/picker.ts';
import { registerQuestions } from '../src/questions.ts';
import pstack from '../src/index.ts';

test('registerShells registers the three shell tools', () => {
  const tools = new Map<string, any>();
  const pi = {
    registerTool: (def: any) => tools.set(def.name, def),
    on: () => {},
  } as unknown as ExtensionAPI;
  registerShells(pi);
  expect([...tools.keys()].toSorted()).toEqual(['BackgroundShell', 'BackgroundShellList', 'BackgroundShellStop']);
});

test('unknown shell output leaves the started shell list untouched', async () => {
  const tools = new Map<string, any>();
  const listeners: Record<string, Function[]> = {};
  const pi = {
    registerTool: (def: any) => tools.set(def.name, def),
    on: (event: string, handler: Function) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    sendMessage: () => {},
  } as unknown as ExtensionAPI;
  registerShells(pi);
  const scratch = await mkdtemp(join(tmpdir(), 'pstack-shells-'));
  const ctx = {
    cwd: scratch,
    sessionManager: { getSessionFile: () => join(scratch, 's.jsonl'), getSessionId: () => 's1', getSessionDir: () => scratch },
  } as unknown as ExtensionContext;
  const messageEnd = listeners['message_end']?.[0];
  const shutdown = listeners['session_shutdown']?.[0];
  expect(messageEnd).toBeDefined();
  try {
    const started = await tools.get('BackgroundShell').execute('1', { command: 'sleep 30', title: 'running' }, undefined, undefined, ctx);
    messageEnd!({ message: { role: 'user', content: 'hello' } });
    messageEnd!({ message: { role: 'custom', customType: 'other' } });
    messageEnd!({ message: { role: 'custom', customType: 'pstack-shell-output', details: { id: 'unknown-id' } } });
    const listed = await tools.get('BackgroundShellList').execute();
    expect(listed.details.map((record: any) => record.id)).toEqual([started.details.id]);
  } finally {
    await shutdown?.();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('registerShells stops a started shell on request', async () => {
  const tools = new Map<string, any>();
  const listeners: Record<string, Function[]> = {};
  const pi = {
    registerTool: (def: any) => tools.set(def.name, def),
    on: (event: string, handler: Function) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    sendMessage: () => {},
  } as unknown as ExtensionAPI;
  registerShells(pi);
  const scratch = await mkdtemp(join(tmpdir(), 'pstack-shells-'));
  const ctx = {
    cwd: scratch,
    sessionManager: { getSessionFile: () => join(scratch, 's.jsonl'), getSessionId: () => 's1', getSessionDir: () => scratch },
  } as unknown as ExtensionContext;
  const shutdown = listeners['session_shutdown']?.[0];
  try {
    const started = await tools.get('BackgroundShell').execute('1', { command: 'sleep 30', title: 'long-running', notify_on_output: '^tick' }, undefined, undefined, ctx);
    expect(started.details.title).toBe('long-running');
    expect(started.details.pattern).toBe('^tick');
    expect(started.details.status).toEqual({ kind: 'running' });
    const listed = await tools.get('BackgroundShellList').execute();
    expect(listed.details.map((record: any) => record.id)).toEqual([started.details.id]);
    const stopped = await tools.get('BackgroundShellStop').execute('2', { id: started.details.id });
    expect(stopped.details.status).toEqual({ kind: 'stopped' });
    expect(() => process.kill(started.details.pid, 0)).toThrow(/ESRCH/);
  } finally {
    await shutdown?.();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('session_shutdown stops every running shell', async () => {
  const tools = new Map<string, any>();
  const listeners: Record<string, Function[]> = {};
  const pi = {
    registerTool: (def: any) => tools.set(def.name, def),
    on: (event: string, handler: Function) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    sendMessage: () => {},
  } as unknown as ExtensionAPI;
  registerShells(pi);
  const scratch = await mkdtemp(join(tmpdir(), 'pstack-shells-'));
  const ctx = {
    cwd: scratch,
    sessionManager: { getSessionFile: () => join(scratch, 's.jsonl'), getSessionId: () => 's1', getSessionDir: () => scratch },
  } as unknown as ExtensionContext;
  const shutdown = listeners['session_shutdown']?.[0];
  expect(shutdown).toBeDefined();
  try {
    const first = await tools.get('BackgroundShell').execute('1', { command: 'sleep 30', title: 'first' }, undefined, undefined, ctx);
    const second = await tools.get('BackgroundShell').execute('2', { command: 'sleep 30', title: 'second' }, undefined, undefined, ctx);
    await shutdown!();
    const listed = await tools.get('BackgroundShellList').execute();
    expect(listed.details.map((record: any) => record.status)).toEqual([{ kind: 'stopped' }, { kind: 'stopped' }]);
    expect(() => process.kill(first.details.pid, 0)).toThrow(/ESRCH/);
    expect(() => process.kill(second.details.pid, 0)).toThrow(/ESRCH/);
  } finally {
    await shutdown?.();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('pstack index before_agent_start with enabled and todos', async () => {
  const listeners: Record<string, Function[]> = {};
  const pi = {
    registerCommand: () => {},
    registerTool: () => {},
    on: (event: string, handler: Function) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    appendEntry() {},
    getCommands: () => [],
    getAllTools: () => [],
  } as unknown as ExtensionAPI;

  await pstack(pi);

  const ctx = {
    cwd: '/test/cwd',
    sessionManager: {
      getBranch: () => [
        {
          type: 'custom',
          customType: 'pstack-state',
          data: {
            enabled: true,
            todos: [{ id: '1', content: 'Step 1', status: 'pending' }],
          },
        },
      ],
      getSessionDir: () => '/tmp',
      getSessionFile: () => '/tmp/f.jsonl',
    },
    ui: { setStatus() {}, setWidget() {} },
  } as unknown as ExtensionContext;

  for (const fn of listeners['session_start'] ?? []) fn({}, ctx);

  const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
  for (const fn of listeners['before_agent_start'] ?? []) await fn(event, ctx);

  expect(event.systemPromptOptions.sections.pstack_mode).toMatch(/References are relative to/);
  expect(event.systemPromptOptions.sections.pstack_todos).toMatch(/Step 1/);
});

test('pick filters the TUI list before resolving the selected choice', async () => {
  const ctx = {
    mode: 'tui',
    ui: {
      custom: (factory: Function) => new Promise((resolve) => {
        const theme = {
          fg: (_role: string, text: string) => `[${text}]`,
          bold: (text: string) => `*${text}*`,
        };
        const widget = factory({ requestRender() {} }, theme, undefined, resolve);
        expect(widget.render(80)).toContainEqual('[→ alpha]');
        widget.handleInput('b');
        const filtered = widget.render(80);
        expect(filtered).toContainEqual('[→ beta]');
        expect(filtered.some((line: string) => line.includes('alpha'))).toBe(false);
        widget.handleInput('\r');
      }),
    },
  } as unknown as ExtensionContext;

  const result = await pick(ctx, 'Select', ['alpha', 'beta']);
  expect(result).toBe('beta');
});

test('pick resolves undefined when the TUI list is cancelled', async () => {
  const ctx = {
    mode: 'tui',
    ui: {
      custom: (factory: Function) => new Promise((resolve) => {
        const theme = {
          fg: (_role: string, text: string) => `[${text}]`,
          bold: (text: string) => `*${text}*`,
        };
        const widget = factory({ requestRender() {} }, theme, undefined, resolve);
        expect(widget.render(80).at(-1)).toBe('[type to filter  ↑↓ navigate  enter select  escape cancel]');
        widget.handleInput('\x1b');
      }),
    },
  } as unknown as ExtensionContext;

  const result = await pick(ctx, 'Select', ['alpha', 'beta']);
  expect(result).toBeUndefined();
});

test('AskQuestion multi-choice with freeText and completion', async () => {
  let toolDef: any;
  const pi = { registerTool: (def: any) => { toolDef = def; } } as any;
  registerQuestions(pi);

  const answers = ['First [opt1]', 'Enter a text answer', 'Custom text', 'Done selecting'];
  const ctx = {
    hasUI: true,
    ui: {
      select: async () => answers.shift(),
      input: async () => answers.shift(),
    },
    sessionManager: { getSessionFile: () => '/tmp/file' },
  } as any;

  const res = await toolDef.execute('1', {
    questions: [
      {
        id: 'q1',
        prompt: 'Choose opts',
        allow_multiple: true,
        options: [
          { id: 'opt1', label: 'First' },
          { id: 'opt2', label: 'Second' },
        ],
      },
    ],
  }, undefined, undefined, ctx);

  expect(res.details).toEqual([
    { id: 'q1', answers: ['opt1', 'Custom text'], cancelled: false },
  ]);

  await expect(toolDef.execute('2', {
    questions: [{ id: 'q1', prompt: 'p', options: [{ id: 'same', label: '1' }, { id: 'same', label: '2' }] }],
  }, undefined, undefined, ctx)).rejects.toThrow(/Option IDs must be unique/);

  await expect(toolDef.execute('3', {
    questions: [{ id: 'q1', prompt: 'p', options: [{ id: 'b] [c', label: 'a' }, { id: 'c', label: 'a [b]' }] }],
  }, undefined, undefined, ctx)).rejects.toThrow(/Option labels and IDs must produce distinct displayed choices/);
});

test('AskQuestion single choice and freeText cancel branches', async () => {
  let toolDef: any;
  const pi = { registerTool: (def: any) => { toolDef = def; } } as any;
  registerQuestions(pi);

  const ctxSingle = {
    hasUI: true,
    ui: { select: async () => 'First [opt1]', input: async () => undefined },
    sessionManager: { getSessionFile: () => null },
  } as any;
  const singleRes = await toolDef.execute('single', {
    questions: [{ id: 'q1', prompt: 'Choose', options: [{ id: 'opt1', label: 'First' }] }],
  }, undefined, undefined, ctxSingle);
  expect(singleRes.details).toEqual([{ id: 'q1', answers: ['opt1'], cancelled: false }]);

  const ctxCancelInput = {
    hasUI: true,
    ui: { select: async () => 'Enter a text answer', input: async () => undefined },
    sessionManager: { getSessionFile: () => null },
  } as any;
  const cancelInputRes = await toolDef.execute('cancel', {
    questions: [{ id: 'q2', prompt: 'Choose', options: [{ id: 'opt1', label: 'First' }] }],
  }, undefined, undefined, ctxCancelInput);
  expect(cancelInputRes.details).toEqual([{ id: 'q2', answers: [], cancelled: true }]);
});

test('resolveModel rejects an unavailable model request', async () => {
  const { resolveModel } = await import('../src/models.ts');
  const availableModel = { provider: 'p', id: 'm', reasoning: true } as any;
  expect(() => resolveModel('no_colon_model', { modelRegistry: { getAvailable: () => [availableModel] } } as any)).toThrow(/Unavailable model 'no_colon_model'/);
});

test('renderTodoSummary reports no in-progress count for pending-only todos', async () => {
  const { registerStateTools, createState } = await import('../src/state.ts');
  let todoTool: any;
  const pi = {
    appendEntry() {},
    registerTool: (def: any) => { if (def.name === 'TodoWrite') todoTool = def; },
  } as any;
  registerStateTools(pi, createState(pi));
  const pendingOnly = [{ id: '1', content: 'wait', status: 'pending' as const }];
  const mockTheme = {
    fg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  } as any;
  const rendered = todoTool.renderResult({ content: [], details: pendingOnly }, { expanded: false }, mockTheme, {} as any);
  expect(rendered.render(80)[0]).toMatch(/0\/1 completed/);
  expect(rendered.render(80)[0]).not.toMatch(/in progress/);
});
