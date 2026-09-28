import { expect, test } from 'vitest';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerShells } from '../src/shells.ts';
import { pick } from '../src/picker.ts';
import { registerQuestions } from '../src/questions.ts';
import pstack from '../src/index.ts';

test('registerShells message_end and list tools', async () => {
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
  expect(tools.has('BackgroundShellList')).toBe(true);
  const messageEnd = listeners['message_end']?.[0];
  expect(messageEnd).toBeDefined();
  messageEnd!({ message: { role: 'user', content: 'hello' } });
  messageEnd!({ message: { role: 'custom', customType: 'other' } });
  messageEnd!({ message: { role: 'custom', customType: 'pstack-shell-output', details: { id: 'unknown-id' } } });
  const listRes = await tools.get('BackgroundShellList').execute();
  expect(listRes.details).toEqual([]);
});

test('registerShells start, stop, and shutdown', async () => {
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
  const ctx = {
    cwd: '/tmp',
    sessionManager: { getSessionFile: () => null, getSessionId: () => 's1', getSessionDir: () => '/tmp' },
  } as unknown as ExtensionContext;
  const shellTool = tools.get('BackgroundShell');
  const stopTool = tools.get('BackgroundShellStop');
  const s1 = await shellTool.execute('1', { command: 'sleep 5', title: 'u' }, undefined, undefined, ctx);
  expect(s1.details.title).toBe('u');
  await stopTool.execute('2', { id: s1.details.id });
  const s2 = await shellTool.execute('3', { command: 'sleep 5', title: 'p', notify_on_output: '^test' }, undefined, undefined, ctx);
  expect(s2.details.pattern).toBe('^test');
  await stopTool.execute('4', { id: s2.details.id });
  const shutdown = listeners['session_shutdown']?.[0];
  expect(shutdown).toBeDefined();
  await shutdown!();
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

test('pick in TUI mode exercises listTheme and filter changes', async () => {
  const ctx = {
    mode: 'tui',
    ui: {
      custom: (factory: Function) => new Promise((resolve) => {
        const theme = {
          fg: (_role: string, text: string) => `[${text}]`,
          bold: (text: string) => `*${text}*`,
        };
        const widget = factory({ requestRender() {} }, theme, undefined, resolve);
        widget.handleInput('a');
        expect(widget.render(80).length > 0).toBe(true);
        widget.handleInput('z');
        widget.handleInput('z');
        widget.handleInput('z');
        expect(widget.render(80).length > 0).toBe(true);
        widget.handleInput('\r');
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

test('models resolveModel fallback to supported thinkingLevel and state renderTodoSummary', async () => {
  const { resolveModel } = await import('../src/models.ts');
  const availableModel = { provider: 'p', id: 'm', reasoning: true } as any;
  expect(() => resolveModel('no_colon_model', { modelRegistry: { getAvailable: () => [availableModel] } } as any)).toThrow(/Unavailable model 'no_colon_model'/);

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
