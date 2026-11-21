import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import piModesExtension from '../src/index.ts';

const ZERO = 0;

interface RegisteredCommand {
  readonly description: string;
  readonly handler: (args: string, ctx: ExtensionContext) => Promise<void>;
}

interface RegisteredShortcut {
  readonly description: string;
  readonly handler: (ctx: ExtensionContext) => Promise<void>;
}

interface RegisteredTool {
  readonly name: string;
  readonly execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext) => Promise<{ content: readonly { type: string; text: string }[]; details?: Record<string, unknown> }>;
}

type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

export interface HarnessOptions {
  readonly sessionId?: string;
  readonly hasUI?: boolean;
  readonly initialTools?: readonly string[];
  readonly flags?: Readonly<Record<string, string | boolean>>;
  readonly initialEntries?: readonly Record<string, unknown>[];
  readonly selectResponses?: readonly (string | undefined)[];
  readonly inputResponses?: readonly (string | undefined)[];
  readonly editorResponses?: readonly (string | undefined)[];
}

export interface TestHarness {
  readonly cwd: string;
  readonly ctx: ExtensionContext;
  readonly getActiveTools: () => readonly string[];
  readonly getStatuses: () => Readonly<Record<string, string | undefined>>;
  readonly getWidgets: () => Readonly<Record<string, readonly string[] | undefined>>;
  readonly getNotifications: () => readonly { message: string; level?: string }[];
  readonly getEntries: () => readonly { customType: string; data: unknown }[];
  readonly getSentMessages: () => readonly { message: unknown; options?: unknown }[];
  readonly getSentUserMessages: () => readonly { content: string; options?: unknown }[];
  readonly runCommand: (name: string, args?: string) => Promise<void>;
  readonly triggerShortcut: (shortcut: string) => Promise<void>;
  readonly callTool: (name: string, params: unknown) => Promise<{ content: readonly { type: string; text: string }[]; details?: Record<string, unknown> }>;
  readonly emit: (eventName: string, event: unknown) => Promise<unknown>;
  readonly cleanup: () => Promise<void>;
}

function createQueue<T>(initial: readonly T[]): () => T | undefined {
  let items: readonly T[] = [...initial];
  return () => {
    const [first, ...rest] = items;
    items = rest;
    return first;
  };
}

function createFakeTheme(): ExtensionContext['ui']['theme'] {
  return {
    fg: (_token: string, text: string) => text,
    strikethrough: (text: string) => `~~${text}~~`,
  } as unknown as ExtensionContext['ui']['theme'];
}

interface UiRecorder {
  readonly ui: ExtensionContext['ui'];
  readonly getStatuses: () => Readonly<Record<string, string | undefined>>;
  readonly getWidgets: () => Readonly<Record<string, readonly string[] | undefined>>;
  readonly getNotifications: () => readonly { message: string; level?: string }[];
}

function createUiRecorder(options: HarnessOptions): UiRecorder {
  let statuses: Readonly<Record<string, string | undefined>> = {};
  let widgets: Readonly<Record<string, readonly string[] | undefined>> = {};
  let notifications: readonly { message: string; level?: string }[] = [];
  const nextSelect = createQueue(options.selectResponses ?? []);
  const nextInput = createQueue(options.inputResponses ?? []);
  const nextEditor = createQueue(options.editorResponses ?? []);

  const ui = {
    theme: createFakeTheme(),
    setStatus: (key: string, value: string | undefined) => {
      statuses = { ...statuses, [key]: value };
    },
    setWidget: (key: string, lines: readonly string[] | undefined) => {
      widgets = { ...widgets, [key]: lines };
    },
    notify: (message: string, level?: string) => {
      notifications = [...notifications, level ? { message, level } : { message }];
    },
    select: async () => nextSelect(),
    input: async () => nextInput(),
    editor: async () => nextEditor(),
  } as unknown as ExtensionContext['ui'];

  return { ui, getStatuses: () => statuses, getWidgets: () => widgets, getNotifications: () => notifications };
}

interface ApiRecorder {
  readonly pi: ExtensionAPI;
  readonly getActiveTools: () => readonly string[];
  readonly getEntries: () => readonly { customType: string; data: unknown }[];
  readonly getSentMessages: () => readonly { message: unknown; options?: unknown }[];
  readonly getSentUserMessages: () => readonly { content: string; options?: unknown }[];
  readonly getCommand: (name: string) => RegisteredCommand | undefined;
  readonly getShortcut: (key: string) => RegisteredShortcut | undefined;
  readonly getTool: (name: string) => RegisteredTool | undefined;
  readonly getListeners: (eventName: string) => readonly EventHandler[];
}

function createApiRecorder(options: HarnessOptions): ApiRecorder {
  let activeTools: readonly string[] = options.initialTools ?? ['read', 'bash', 'edit', 'write'];
  let entries: readonly { customType: string; data: unknown }[] = [];
  let sentMessages: readonly { message: unknown; options?: unknown }[] = [];
  let sentUserMessages: readonly { content: string; options?: unknown }[] = [];
  let commands: Readonly<Record<string, RegisteredCommand>> = {};
  let shortcuts: Readonly<Record<string, RegisteredShortcut>> = {};
  let tools: Readonly<Record<string, RegisteredTool>> = {};
  let listeners: Readonly<Record<string, readonly EventHandler[]>> = {};
  const flagValues: Readonly<Record<string, string | boolean>> = options.flags ?? {};

  const pi = {
    registerFlag: () => undefined,
    getFlag: (name: string) => flagValues[name],
    registerCommand: (name: string, cmd: RegisteredCommand) => {
      commands = { ...commands, [name]: cmd };
    },
    registerShortcut: (key: string, sc: RegisteredShortcut) => {
      shortcuts = { ...shortcuts, [String(key)]: sc };
    },
    registerTool: (tool: RegisteredTool) => {
      tools = { ...tools, [tool.name]: tool };
    },
    getActiveTools: () => [...activeTools],
    setActiveTools: (next: string[]) => {
      activeTools = [...next];
    },
    appendEntry: (customType: string, data: unknown) => {
      entries = [...entries, { customType, data }];
    },
    sendMessage: (message: unknown, opts?: unknown) => {
      sentMessages = [...sentMessages, { message, options: opts }];
    },
    sendUserMessage: (content: string, opts?: unknown) => {
      sentUserMessages = [...sentUserMessages, { content, options: opts }];
    },
    on: (eventName: string, handler: EventHandler) => {
      listeners = { ...listeners, [eventName]: [...(listeners[eventName] ?? []), handler] };
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    getActiveTools: () => activeTools,
    getEntries: () => entries,
    getSentMessages: () => sentMessages,
    getSentUserMessages: () => sentUserMessages,
    getCommand: (name) => commands[name],
    getShortcut: (key) => shortcuts[key],
    getTool: (name) => tools[name],
    getListeners: (eventName) => listeners[eventName] ?? [],
  };
}

function requireRegistered<T>(value: T | undefined, kind: string, name: string): T {
  if (!value) {
    throw new Error(`${kind} not registered: ${name}`);
  }
  return value;
}

export function createTestHarness(options: HarnessOptions = {}): TestHarness {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-modes-test-'));
  const sessionId = options.sessionId ?? 'sess1234-5678-90ab-cdef';
  const uiRec = createUiRecorder(options);
  const apiRec = createApiRecorder(options);

  const ctx = {
    cwd,
    hasUI: options.hasUI ?? true,
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => [...(options.initialEntries ?? []), ...apiRec.getEntries().map((e) => ({ type: 'custom', customType: e.customType, data: e.data }))],
    },
    ui: uiRec.ui,
  } as unknown as ExtensionContext;

  piModesExtension(apiRec.pi);

  const emit = async (eventName: string, event: unknown): Promise<unknown> => {
    let lastResult: unknown;
    for (const handler of apiRec.getListeners(eventName)) {
      lastResult = await handler(event, ctx);
    }
    return lastResult;
  };

  return {
    cwd,
    ctx,
    getActiveTools: apiRec.getActiveTools,
    getStatuses: uiRec.getStatuses,
    getWidgets: uiRec.getWidgets,
    getNotifications: uiRec.getNotifications,
    getEntries: apiRec.getEntries,
    getSentMessages: apiRec.getSentMessages,
    getSentUserMessages: apiRec.getSentUserMessages,
    runCommand: (name, args = '') => requireRegistered(apiRec.getCommand(name), 'Command', name).handler(args, ctx),
    triggerShortcut: (shortcut) => requireRegistered(apiRec.getShortcut(shortcut), 'Shortcut', shortcut).handler(ctx),
    callTool: (name, params) => requireRegistered(apiRec.getTool(name), 'Tool', name).execute(`call-${ZERO}`, params, undefined, undefined, ctx),
    emit,
    cleanup: async () => {
      await emit('session_shutdown', {});
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}
