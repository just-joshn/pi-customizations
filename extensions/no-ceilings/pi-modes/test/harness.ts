import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { onTestFinished } from 'vitest';
import piModesExtension from '../src/index.ts';

const ZERO = 0;

interface RegisteredCommand {
  readonly description: string;
  readonly handler: (args: string, ctx: ExtensionContext) => Promise<void>;
  readonly getArgumentCompletions?: (argumentPrefix: string) => readonly CompletionItem[] | null | Promise<readonly CompletionItem[] | null>;
}

interface CompletionItem {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
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

export interface SkillCommandOption {
  readonly name: string;
  readonly path: string;
  readonly description?: string;
}

export interface HarnessOptions {
  readonly sessionId?: string;
  readonly hasUI?: boolean;
  readonly initialTools?: readonly string[];
  readonly flags?: Readonly<Record<string, string | boolean>>;
  readonly initialEntries?: readonly Record<string, unknown>[];
  readonly selectResponses?: readonly (string | undefined)[];
  readonly inputResponses?: readonly (string | undefined)[];
  readonly editorResponses?: readonly (string | undefined)[];
  readonly skillCommands?: readonly SkillCommandOption[];
}

export interface TestHarness {
  readonly cwd: string;
  readonly ctx: ExtensionContext;
  readonly getActiveTools: () => readonly string[];
  readonly setActiveTools: (names: readonly string[]) => void;
  readonly getStatuses: () => Readonly<Record<string, string | undefined>>;
  readonly getWidgets: () => Readonly<Record<string, readonly string[] | undefined>>;
  readonly getNotifications: () => readonly { message: string; level?: string }[];
  readonly getEntries: () => readonly { customType: string; data: unknown }[];
  readonly getSentMessages: () => readonly { message: unknown; options?: unknown }[];
  readonly getSentUserMessages: () => readonly { content: string; options?: unknown }[];
  readonly setSkillCommands: (commands: readonly SkillCommandOption[]) => void;
  readonly runCommand: (name: string, args?: string) => Promise<void>;
  readonly getCompletions: (name: string, prefix?: string) => Promise<readonly CompletionItem[] | null>;
  readonly triggerShortcut: (shortcut: string) => Promise<void>;
  readonly callTool: (name: string, params: unknown) => Promise<{ content: readonly { type: string; text: string }[]; details?: Record<string, unknown> }>;
  readonly emit: (eventName: string, event: unknown) => Promise<unknown>;
  readonly emitAll: (eventName: string, event: unknown) => Promise<readonly unknown[]>;
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

export function double<T>(value: unknown): T {
  return value as T;
}

function createFakeTheme(): ExtensionContext['ui']['theme'] {
  return double<ExtensionContext['ui']['theme']>({
    fg: (_token: string, text: string) => text,
    strikethrough: (text: string) => `~~${text}~~`,
  });
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

  const ui = double<ExtensionContext['ui']>({
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
  });

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
  readonly setSkillCommands: (commands: readonly SkillCommandOption[]) => void;
}

function toSkillCommands(skills: readonly SkillCommandOption[], cwd: string): readonly Record<string, unknown>[] {
  return skills.map((skill) => ({
    name: `skill:${skill.name}`,
    description: skill.description,
    source: 'skill',
    sourceInfo: { path: join(cwd, skill.path), source: 'skill', scope: 'project', origin: 'top-level' },
  }));
}

function createApiRecorder(options: HarnessOptions, cwd: string): ApiRecorder {
  let activeTools: readonly string[] = options.initialTools ?? ['read', 'bash', 'edit', 'write'];
  let skillCommands: readonly SkillCommandOption[] = options.skillCommands ?? [];
  let entries: readonly { customType: string; data: unknown }[] = [];
  let sentMessages: readonly { message: unknown; options?: unknown }[] = [];
  let sentUserMessages: readonly { content: string; options?: unknown }[] = [];
  let commands: Readonly<Record<string, RegisteredCommand>> = {};
  let shortcuts: Readonly<Record<string, RegisteredShortcut>> = {};
  let tools: Readonly<Record<string, RegisteredTool>> = {};
  let listeners: Readonly<Record<string, readonly EventHandler[]>> = {};
  const flagValues: Readonly<Record<string, string | boolean>> = options.flags ?? {};

  const pi = double<ExtensionAPI>({
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
    getCommands: () => toSkillCommands(skillCommands, cwd),
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
  });

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
    setSkillCommands: (next) => {
      skillCommands = next;
    },
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
  const apiRec = createApiRecorder(options, cwd);

  const ctx = double<ExtensionContext>({
    cwd,
    hasUI: options.hasUI ?? true,
    waitForIdle: async () => undefined,
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => [...(options.initialEntries ?? []), ...apiRec.getEntries().map((e) => ({ type: 'custom', customType: e.customType, data: e.data }))],
    },
    ui: uiRec.ui,
  });

  piModesExtension(apiRec.pi);

  const emitAll = async (eventName: string, event: unknown): Promise<readonly unknown[]> => {
    const results: readonly unknown[] = [];
    let collected: readonly unknown[] = results;
    for (const handler of apiRec.getListeners(eventName)) {
      collected = [...collected, await handler(event, ctx)];
    }
    return collected;
  };

  const emit = async (eventName: string, event: unknown): Promise<unknown> => {
    const results = await emitAll(eventName, event);
    return results.find((result) => result !== undefined);
  };

  return {
    cwd,
    ctx,
    getActiveTools: apiRec.getActiveTools,
    setActiveTools: (names) => apiRec.pi.setActiveTools([...names]),
    getStatuses: uiRec.getStatuses,
    getWidgets: uiRec.getWidgets,
    getNotifications: uiRec.getNotifications,
    getEntries: apiRec.getEntries,
    getSentMessages: apiRec.getSentMessages,
    getSentUserMessages: apiRec.getSentUserMessages,
    setSkillCommands: apiRec.setSkillCommands,
    runCommand: (name, args = '') => requireRegistered(apiRec.getCommand(name), 'Command', name).handler(args, ctx),
    getCompletions: async (name, prefix = '') => {
      const command = requireRegistered(apiRec.getCommand(name), 'Command', name);
      const completions = command.getArgumentCompletions;
      if (completions === undefined) {
        return null;
      }
      return await completions(prefix);
    },
    triggerShortcut: (shortcut) => requireRegistered(apiRec.getShortcut(shortcut), 'Shortcut', shortcut).handler(ctx),
    callTool: (name, params) => requireRegistered(apiRec.getTool(name), 'Tool', name).execute(`call-${ZERO}`, params, undefined, undefined, ctx),
    emit,
    emitAll,
    cleanup: async () => {
      try {
        await emit('session_shutdown', {});
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  };
}

export function useTestHarness(options: HarnessOptions = {}): TestHarness {
  const harness = createTestHarness(options);
  onTestFinished(() => harness.cleanup());
  return harness;
}
