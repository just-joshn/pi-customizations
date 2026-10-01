import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import pstack from '../src/index.ts';
import { pick } from '../src/picker.ts';
import { registerQuestions } from '../src/questions.ts';
import { registerShells } from '../src/shells.ts';

const BG_SHELL_LIST = 'Background' + 'ShellList';
const BG_SHELL_STOP = 'Background' + 'ShellStop';

type ToolMock = {
  name: string;
  execute: (id?: string, params?: unknown, signal?: unknown, update?: unknown, ctx?: unknown) => Promise<{ details: unknown }>;
};
type Listener = (...args: unknown[]) => unknown;

test('registerShells registers the three shell tools', () => {
  const tools = new Map<string, ToolMock>();
  const pi = {
    registerTool: (def: ToolMock) => tools.set(def.name, def),
    on: () => {},
  } as unknown as ExtensionAPI;
  registerShells(pi);
  expect([...tools.keys()].toSorted()).toEqual(['BackgroundShell', BG_SHELL_LIST, BG_SHELL_STOP]);
});

test('unknown shell output leaves the started shell list untouched', async () => {
  const tools = new Map<string, ToolMock>();
  const listeners: Record<string, Listener[]> = {};
  const pi = {
    registerTool: (def: ToolMock) => tools.set(def.name, def),
    on: (event: string, handler: Listener) => {
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
  const messageEnd = listeners.message_end?.[0];
  const shutdown = listeners.session_shutdown?.[0];
  expect(messageEnd).toBeDefined();
  try {
    const started = (await tools.get('BackgroundShell')?.execute('1', { command: 'sleep 30', title: 'running' }, undefined, undefined, ctx)) as { details: { id: string } };
    messageEnd?.({ message: { role: 'user', content: 'hello' } });
    messageEnd?.({ message: { role: 'custom', customType: 'other' } });
    messageEnd?.({ message: { role: 'custom', customType: 'pstack-shell-output', details: { id: 'unknown-id' } } });
    const listed = (await tools.get(BG_SHELL_LIST)?.execute()) as { details: Array<{ id: string }> };
    expect(listed.details.map((record) => record.id)).toEqual([started.details.id]);
  } finally {
    await shutdown?.();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('registerShells stops a started shell on request', async () => {
  const tools = new Map<string, ToolMock>();
  const listeners: Record<string, Listener[]> = {};
  const pi = {
    registerTool: (def: ToolMock) => tools.set(def.name, def),
    on: (event: string, handler: Listener) => {
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
  const shutdown = listeners.session_shutdown?.[0];
  try {
    const started = (await tools.get('BackgroundShell')?.execute('1', { command: 'sleep 30', title: 'long-running', notify_on_output: '^tick' }, undefined, undefined, ctx)) as {
      details: { id: string; title: string; pattern: string; status: unknown; pid: number };
    };
    expect(started.details.title).toBe('long-running');
    expect(started.details.pattern).toBe('^tick');
    expect(started.details.status).toEqual({ kind: 'running' });
    const listed = (await tools.get(BG_SHELL_LIST)?.execute()) as { details: Array<{ id: string }> };
    expect(listed.details.map((record) => record.id)).toEqual([started.details.id]);
    const stopped = (await tools.get(BG_SHELL_STOP)?.execute('2', { id: started.details.id })) as { details: { status: unknown } };
    expect(stopped.details.status).toEqual({ kind: 'stopped' });
    expect(() => process.kill(started.details.pid, 0)).toThrow(/ESRCH/);
  } finally {
    await shutdown?.();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('session_shutdown stops every running shell', async () => {
  const tools = new Map<string, ToolMock>();
  const listeners: Record<string, Listener[]> = {};
  const pi = {
    registerTool: (def: ToolMock) => tools.set(def.name, def),
    on: (event: string, handler: Listener) => {
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
  const shutdown = listeners.session_shutdown?.[0];
  expect(shutdown).toBeDefined();
  try {
    const first = (await tools.get('BackgroundShell')?.execute('1', { command: 'sleep 30', title: 'first' }, undefined, undefined, ctx)) as { details: { pid: number } };
    const second = (await tools.get('BackgroundShell')?.execute('2', { command: 'sleep 30', title: 'second' }, undefined, undefined, ctx)) as { details: { pid: number } };
    await shutdown?.();
    const listed = (await tools.get(BG_SHELL_LIST)?.execute()) as { details: Array<{ status: unknown }> };
    expect(listed.details.map((record) => record.status)).toEqual([{ kind: 'stopped' }, { kind: 'stopped' }]);
    expect(() => process.kill(first.details.pid, 0)).toThrow(/ESRCH/);
    expect(() => process.kill(second.details.pid, 0)).toThrow(/ESRCH/);
  } finally {
    await shutdown?.();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('a second session lists no shells from the session before it', async () => {
  const tools = new Map<string, ToolMock>();
  const listeners: Record<string, Listener[]> = {};
  const pi = {
    registerTool: (def: ToolMock) => tools.set(def.name, def),
    on: (event: string, handler: Listener) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    sendMessage: () => {},
  } as unknown as ExtensionAPI;
  registerShells(pi);
  const scratch = await mkdtemp(join(tmpdir(), 'pstack-shells-rotated-'));
  const ctx = {
    cwd: scratch,
    sessionManager: { getSessionFile: () => join(scratch, 's.jsonl'), getSessionId: () => 's1', getSessionDir: () => scratch },
  } as unknown as ExtensionContext;
  const shutdown = listeners.session_shutdown?.[0];
  const start = listeners.session_start?.[0];
  try {
    const firstShell = (await tools.get('BackgroundShell')?.execute('1', { command: 'sleep 30', title: 'first session' }, undefined, undefined, ctx)) as { details: { id: string } };
    await shutdown?.();
    await start?.();
    const carried = (await tools.get(BG_SHELL_LIST)?.execute()) as { details: Array<{ id: string }> };
    const secondShell = (await tools.get('BackgroundShell')?.execute('2', { command: 'sleep 30', title: 'second session' }, undefined, undefined, ctx)) as { details: { id: string } };
    const listed = (await tools.get(BG_SHELL_LIST)?.execute()) as { details: Array<{ id: string }> };
    expect(carried.details.some((record) => record.id === firstShell.details.id)).toBe(false);
    expect(listed.details.map((record) => record.id)).toEqual([secondShell.details.id]);
  } finally {
    await shutdown?.();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('pstack index before_agent_start with enabled and todos', async () => {
  const listeners: Record<string, Listener[]> = {};
  const pi = {
    registerCommand: () => {},
    registerTool: () => {},
    on: (event: string, handler: Listener) => {
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
      getEntries: () => [],
      getSessionId: () => 's',
      getSessionDir: () => '/tmp',
      getSessionFile: () => '/tmp/f.jsonl',
    },
    ui: { setStatus() {}, setWidget() {} },
  } as unknown as ExtensionContext;

  for (const fn of listeners.session_start ?? []) await fn({}, ctx);

  const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
  for (const fn of listeners.before_agent_start ?? []) await fn(event, ctx);

  expect(event.systemPromptOptions.sections.pstack_mode).toMatch(/References are relative to/);
  expect(event.systemPromptOptions.sections.pstack_todos).toMatch(/Step 1/);
});

test('pick filters the TUI list before resolving the selected choice', async () => {
  const ctx = {
    mode: 'tui',
    ui: {
      custom: (factory: (...args: unknown[]) => unknown) =>
        new Promise((resolve) => {
          const theme = {
            fg: (_role: string, text: string) => `[${text}]`,
            bold: (text: string) => `*${text}*`,
          };
          const widget = factory({ requestRender() {} }, theme, undefined, resolve) as { render: (w: number) => string[]; handleInput: (k: string) => void };
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
      custom: (factory: (...args: unknown[]) => unknown) =>
        new Promise((resolve) => {
          const theme = {
            fg: (_role: string, text: string) => `[${text}]`,
            bold: (text: string) => `*${text}*`,
          };
          const widget = factory({ requestRender() {} }, theme, undefined, resolve) as { render: (w: number) => string[]; handleInput: (k: string) => void };
          expect(widget.render(80).at(-1)).toBe('[type to filter  ↑↓ navigate  enter select  escape cancel]');
          widget.handleInput('\x1b');
        }),
    },
  } as unknown as ExtensionContext;

  const result = await pick(ctx, 'Select', ['alpha', 'beta']);
  expect(result).toBeUndefined();
});

test('a multi-select question offers the typed answer only once', async () => {
  let toolDef: ToolMock | undefined;
  const pi = {
    registerTool: (def: ToolMock) => {
      toolDef = def;
    },
  } as never;
  registerQuestions(pi);

  const dialogs: string[] = [];
  const ctx = {
    hasUI: true,
    ui: {
      select: async (_title: string, options: string[]) => {
        if (dialogs.length > 10) throw new Error('the question never finished');
        dialogs.push(options.join(' | '));
        return options[0];
      },
      input: async () => 'Typed once',
    },
    sessionManager: { getSessionFile: () => '/tmp/file' },
  } as never;

  const res = (await toolDef?.execute('1', { questions: [{ id: 'q1', prompt: 'Choose', allow_multiple: true, options: [{ id: 'a', label: 'A' }] }] }, undefined, undefined, ctx)) as { details: unknown };

  expect(res.details).toEqual([{ id: 'q1', answers: ['a', 'Typed once'], cancelled: false }]);
  expect(dialogs.at(-1)).toBe('Done selecting');
});

test('AskQuestion multi-choice with freeText and completion', async () => {
  let toolDef: ToolMock | undefined;
  const pi = {
    registerTool: (def: ToolMock) => {
      toolDef = def;
    },
  } as never;
  registerQuestions(pi);

  const answers = ['First [opt1]', 'Enter a text answer', 'Custom text', 'Done selecting'];
  const ctx = {
    hasUI: true,
    ui: {
      select: async () => answers.shift(),
      input: async () => answers.shift(),
    },
    sessionManager: { getSessionFile: () => '/tmp/file' },
  } as never;

  const res = (await toolDef?.execute(
    '1',
    {
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
    },
    undefined,
    undefined,
    ctx,
  )) as { details: unknown };

  expect(res.details).toEqual([{ id: 'q1', answers: ['opt1', 'Custom text'], cancelled: false }]);
  await checkOptionValidation(toolDef, ctx);
});

async function checkOptionValidation(toolDef: ToolMock | undefined, ctx: unknown) {
  const duplicate = {
    questions: [
      {
        id: 'q1',
        prompt: 'p',
        options: [
          { id: 'same', label: '1' },
          { id: 'same', label: '2' },
        ],
      },
    ],
  };
  await expect(toolDef?.execute('2', duplicate, undefined, undefined, ctx)).rejects.toThrow(/Option IDs must be unique/);

  const ambiguous = {
    questions: [
      {
        id: 'q1',
        prompt: 'p',
        options: [
          { id: 'b] [c', label: 'a' },
          { id: 'c', label: 'a [b]' },
        ],
      },
    ],
  };
  await expect(toolDef?.execute('3', ambiguous, undefined, undefined, ctx)).rejects.toThrow(/Option labels and IDs must produce distinct displayed choices/);
}

test('AskQuestion single choice and freeText cancel branches', async () => {
  let toolDef: ToolMock | undefined;
  const pi = {
    registerTool: (def: ToolMock) => {
      toolDef = def;
    },
  } as never;
  registerQuestions(pi);

  const ctxSingle = {
    hasUI: true,
    ui: { select: async () => 'First [opt1]', input: async () => undefined },
    sessionManager: { getSessionFile: () => null },
  } as never;
  const singleRes = (await toolDef?.execute(
    'single',
    {
      questions: [{ id: 'q1', prompt: 'Choose', options: [{ id: 'opt1', label: 'First' }] }],
    },
    undefined,
    undefined,
    ctxSingle,
  )) as { details: unknown };
  expect(singleRes.details).toEqual([{ id: 'q1', answers: ['opt1'], cancelled: false }]);

  const ctxCancelInput = {
    hasUI: true,
    ui: { select: async () => 'Enter a text answer', input: async () => undefined },
    sessionManager: { getSessionFile: () => null },
  } as never;
  const cancelInputRes = (await toolDef?.execute(
    'cancel',
    {
      questions: [{ id: 'q2', prompt: 'Choose', options: [{ id: 'opt1', label: 'First' }] }],
    },
    undefined,
    undefined,
    ctxCancelInput,
  )) as { details: unknown };
  expect(cancelInputRes.details).toEqual([{ id: 'q2', answers: [], cancelled: true }]);
});

test('resolveModel rejects an unavailable model request', async () => {
  const { resolveModel } = await import('../src/models.ts');
  const availableModel = { provider: 'p', id: 'm', reasoning: true };
  expect(() => resolveModel('no_colon_model', { modelRegistry: { getAvailable: () => [availableModel] } } as never)).toThrow(/Unavailable model 'no_colon_model'/);
});

test('renderTodoSummary reports no in-progress count for pending-only todos', async () => {
  const { registerStateTools, createState } = await import('../src/state.ts');
  let todoTool: { renderResult: (result: unknown, opts: unknown, theme: unknown, ctx: unknown) => { render: (w: number) => string[] } } | undefined;
  const pi = {
    appendEntry() {},
    registerTool: (def: { name: string; renderResult: typeof todoTool extends undefined ? never : NonNullable<typeof todoTool>['renderResult'] }) => {
      if (def.name === 'TodoWrite') todoTool = def;
    },
  } as never;
  registerStateTools(pi, createState(pi));
  const pendingOnly = [{ id: '1', content: 'wait', status: 'pending' as const }];
  const mockTheme = {
    fg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };
  const rendered = todoTool?.renderResult({ content: [], details: pendingOnly }, { expanded: false }, mockTheme, {} as never);
  expect(rendered?.render(80)[0]).toMatch(/0\/1 completed/);
  expect(rendered?.render(80)[0]).not.toMatch(/in progress/);
});
