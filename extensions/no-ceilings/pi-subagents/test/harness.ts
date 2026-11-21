import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionContext, ExtensionFactory, Theme } from '@earendil-works/pi-coding-agent';
import piSubagentsExtension from '../src/index.ts';
import type { TaskToolDetails } from '../src/types.ts';

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
  readonly execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: ((partial: AgentToolResult<TaskToolDetails>) => void) | undefined, ctx: ExtensionContext) => Promise<AgentToolResult<TaskToolDetails>>;
  readonly renderCall?: (args: Record<string, unknown>, theme: Theme) => { readonly render: (width: number) => string[] };
  readonly renderResult?: (result: AgentToolResult<TaskToolDetails>, options: { readonly expanded: boolean; readonly isPartial: boolean }, theme: Theme) => { readonly render: (width: number) => string[] };
}

type MessageRenderer = (message: { readonly details?: unknown; readonly content: unknown }, options: unknown, theme: Theme) => { readonly render: (width: number) => string[] };
type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

export interface HarnessOptions {
  readonly sessionId?: string;
  readonly hasUI?: boolean;
  readonly initialEntries?: readonly Record<string, unknown>[];
  readonly registeredNativeProviders?: Readonly<Record<string, Record<string, unknown>>>;
  readonly registeredProviderConfigs?: Readonly<Record<string, Record<string, unknown>>>;
  readonly onCustomOverlay?: (
    factory: (tui: { readonly requestRender: () => void }, theme: Theme, kb: unknown, done: (val: unknown) => void) => { readonly render: (w: number) => string[]; readonly handleInput?: (d: string) => void; readonly dispose?: () => void },
  ) => Promise<void>;
}

export interface SubagentsTestHarness {
  readonly cwd: string;
  readonly sessionDir: string;
  readonly ctx: ExtensionContext;
  readonly theme: Theme;
  readonly getStatuses: () => Readonly<Record<string, string | undefined>>;
  readonly getWidgets: () => Readonly<Record<string, readonly string[] | undefined>>;
  readonly getNotifications: () => readonly { readonly message: string; readonly level?: string }[];
  readonly getEntries: () => readonly { readonly customType: string; readonly data: unknown }[];
  readonly getSentMessages: () => readonly { readonly message: unknown; readonly options?: unknown }[];
  readonly getSentUserMessages: () => readonly { readonly content: string; readonly options?: unknown }[];
  readonly runCommand: (name: string, args?: string) => Promise<void>;
  readonly triggerShortcut: (shortcut: string) => Promise<void>;
  readonly callTool: (
    name: string,
    params: unknown,
    options?: {
      readonly toolCallId?: string;
      readonly signal?: AbortSignal;
      readonly onUpdate?: (partial: AgentToolResult<TaskToolDetails>) => void;
    },
  ) => Promise<AgentToolResult<TaskToolDetails>>;
  readonly renderToolCall: (name: string, args: Record<string, unknown>, width?: number) => readonly string[];
  readonly renderToolResult: (name: string, result: AgentToolResult<TaskToolDetails>, expanded: boolean, isPartial: boolean, width?: number) => readonly string[];
  readonly renderMessage: (customType: string, message: { readonly details?: unknown; readonly content: unknown }, width?: number) => readonly string[];
  readonly emit: (eventName: string, event: unknown) => Promise<unknown>;
  readonly cleanup: () => Promise<void>;
}

const DEFAULT_WIDTH = 100;

function isDouble<T>(_value: unknown): _value is T {
  return true;
}

export function double<T>(value: unknown): T {
  if (!isDouble<T>(value)) {
    throw new Error('unreachable: test double is always accepted');
  }
  return value;
}

function createFakeTheme(): Theme {
  return double<Theme>({
    fg: (_token: string, text: string) => text,
    bold: (text: string) => `**${text}**`,
    strikethrough: (text: string) => `~~${text}~~`,
  });
}

function createUiRecorder(
  options: HarnessOptions,
  theme: Theme,
): {
  readonly ui: ExtensionContext['ui'];
  readonly getStatuses: () => Readonly<Record<string, string | undefined>>;
  readonly getWidgets: () => Readonly<Record<string, readonly string[] | undefined>>;
  readonly getNotifications: () => readonly { readonly message: string; readonly level?: string }[];
} {
  let statuses: Readonly<Record<string, string | undefined>> = {};
  let widgets: Readonly<Record<string, readonly string[] | undefined>> = {};
  let notifications: readonly { readonly message: string; readonly level?: string }[] = [];

  const ui = double<ExtensionContext['ui']>({
    theme,
    setStatus: (key: string, value: string | undefined) => {
      statuses = { ...statuses, [key]: value };
    },
    setWidget: (key: string, lines: readonly string[] | undefined) => {
      widgets = { ...widgets, [key]: lines };
    },
    notify: (message: string, level?: string) => {
      notifications = [...notifications, level ? { message, level } : { message }];
    },
    custom: async (
      factory: (tui: { readonly requestRender: () => void }, th: Theme, kb: unknown, done: (val: unknown) => void) => { readonly render: (w: number) => string[]; readonly handleInput?: (d: string) => void; readonly dispose?: () => void },
    ) => {
      if (options.onCustomOverlay) {
        await options.onCustomOverlay(factory);
        return undefined;
      }
      const comp = factory({ requestRender: () => undefined }, theme, {}, () => undefined);
      comp.render(DEFAULT_WIDTH);
      comp.dispose?.();
      return undefined;
    },
  });

  return { ui, getStatuses: () => statuses, getWidgets: () => widgets, getNotifications: () => notifications };
}

function createApiRecorder(): {
  readonly pi: ExtensionAPI;
  readonly getEntries: () => readonly { readonly customType: string; readonly data: unknown }[];
  readonly getSentMessages: () => readonly { readonly message: unknown; readonly options?: unknown }[];
  readonly getSentUserMessages: () => readonly { readonly content: string; readonly options?: unknown }[];
  readonly getCommand: (name: string) => RegisteredCommand | undefined;
  readonly getShortcut: (key: string) => RegisteredShortcut | undefined;
  readonly getTool: (name: string) => RegisteredTool | undefined;
  readonly getMessageRenderer: (customType: string) => MessageRenderer | undefined;
  readonly getListeners: (eventName: string) => readonly EventHandler[];
} {
  let entries: readonly { readonly customType: string; readonly data: unknown }[] = [];
  let sentMessages: readonly { readonly message: unknown; readonly options?: unknown }[] = [];
  let sentUserMessages: readonly { readonly content: string; readonly options?: unknown }[] = [];
  let commands: Readonly<Record<string, RegisteredCommand>> = {};
  let shortcuts: Readonly<Record<string, RegisteredShortcut>> = {};
  let tools: Readonly<Record<string, RegisteredTool>> = {};
  let renderers: Readonly<Record<string, MessageRenderer>> = {};
  let listeners: Readonly<Record<string, readonly EventHandler[]>> = {};

  const pi = double<ExtensionAPI>({
    registerCommand: (name: string, cmd: RegisteredCommand) => {
      commands = { ...commands, [name]: cmd };
    },
    registerShortcut: (key: string, sc: RegisteredShortcut) => {
      shortcuts = { ...shortcuts, [String(key)]: sc };
    },
    registerTool: (tool: RegisteredTool) => {
      tools = { ...tools, [tool.name]: tool };
    },
    registerMessageRenderer: (customType: string, renderer: MessageRenderer) => {
      renderers = { ...renderers, [customType]: renderer };
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
  });

  return {
    pi,
    getEntries: () => entries,
    getSentMessages: () => sentMessages,
    getSentUserMessages: () => sentUserMessages,
    getCommand: (name) => commands[name],
    getShortcut: (key) => shortcuts[key],
    getTool: (name) => tools[name],
    getMessageRenderer: (customType) => renderers[customType],
    getListeners: (eventName) => listeners[eventName] ?? [],
  };
}

function requireRegistered<T>(value: T | undefined, kind: string, name: string): T {
  if (!value) {
    throw new Error(`${kind} not registered: ${name}`);
  }
  return value;
}

function createFakeContext(cwd: string, sessionDir: string, sessionId: string, options: HarnessOptions, ui: ExtensionContext['ui'], getEntries: () => readonly { readonly customType: string; readonly data: unknown }[]): ExtensionContext {
  return double<ExtensionContext>({
    cwd,
    hasUI: options.hasUI ?? true,
    model: { provider: 'test-provider', id: 'model-sonnet' },
    modelRegistry: {
      getAvailable: () => [
        { provider: 'test-provider', id: 'model-sonnet' },
        { provider: 'test-provider', id: 'model-haiku-fast' },
      ],
      getAll: () => [
        { provider: 'test-provider', id: 'model-sonnet' },
        { provider: 'test-provider', id: 'model-haiku-fast' },
      ],
      find: (provider: string, id: string) => (provider === 'test-provider' && id === 'model-haiku-fast' ? { provider, id } : undefined),
      getRegisteredProviderIds: () => [...Object.keys(options.registeredNativeProviders ?? {}), ...Object.keys(options.registeredProviderConfigs ?? {})],
      getRegisteredNativeProvider: (id: string) => options.registeredNativeProviders?.[id],
      getRegisteredProviderConfig: (id: string) => options.registeredProviderConfigs?.[id],
    },
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionDir: () => sessionDir,
      getEntries: () => [...(options.initialEntries ?? []), ...getEntries().map((e) => ({ type: 'custom', customType: e.customType, data: e.data }))],
    },
    ui,
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createGate(): { readonly promise: Promise<void>; readonly release: () => void } {
  let releaseFn: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  return { promise, release: () => releaseFn?.() };
}

export function extractGuardHandler(factory: ExtensionFactory | undefined): ((event: unknown) => Promise<{ readonly block?: boolean; readonly reason?: string } | undefined>) | undefined {
  let handler: ((event: unknown) => Promise<{ readonly block?: boolean; readonly reason?: string } | undefined>) | undefined;
  void factory?.(
    double<ExtensionAPI>({
      on: (_ev: string, fn: (event: unknown) => Promise<{ readonly block?: boolean; readonly reason?: string } | undefined>) => {
        handler = fn;
      },
    }),
  );
  return handler;
}

export function createTestHarness(options: HarnessOptions = {}): SubagentsTestHarness {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-subagents-test-'));
  const sessionDir = mkdtempSync(join(tmpdir(), 'pi-subagents-sess-'));
  const sessionId = options.sessionId ?? '11111111-2222-4333-8444-555555555555';
  const theme = createFakeTheme();
  const uiRec = createUiRecorder(options, theme);
  const apiRec = createApiRecorder();
  const ctx = createFakeContext(cwd, sessionDir, sessionId, options, uiRec.ui, apiRec.getEntries);

  piSubagentsExtension(apiRec.pi);

  const emit = async (eventName: string, event: unknown): Promise<unknown> => {
    let lastResult: unknown;
    for (const handler of apiRec.getListeners(eventName)) {
      lastResult = await handler(event, ctx);
    }
    return lastResult;
  };

  return {
    cwd,
    sessionDir,
    ctx,
    theme,
    getStatuses: uiRec.getStatuses,
    getWidgets: uiRec.getWidgets,
    getNotifications: uiRec.getNotifications,
    getEntries: apiRec.getEntries,
    getSentMessages: apiRec.getSentMessages,
    getSentUserMessages: apiRec.getSentUserMessages,
    runCommand: (name, args = '') => requireRegistered(apiRec.getCommand(name), 'Command', name).handler(args, ctx),
    triggerShortcut: (shortcut) => requireRegistered(apiRec.getShortcut(shortcut), 'Shortcut', shortcut).handler(ctx),
    callTool: (name, params, opts) => requireRegistered(apiRec.getTool(name), 'Tool', name).execute(opts?.toolCallId ?? `call-${ZERO}`, params, opts?.signal, opts?.onUpdate, ctx),
    renderToolCall: (name, args, width = DEFAULT_WIDTH) => {
      const tool = requireRegistered(apiRec.getTool(name), 'Tool', name);
      return tool.renderCall ? tool.renderCall(args, theme).render(width) : [];
    },
    renderToolResult: (name, result, expanded, isPartial, width = DEFAULT_WIDTH) => {
      const tool = requireRegistered(apiRec.getTool(name), 'Tool', name);
      return tool.renderResult ? tool.renderResult(result, { expanded, isPartial }, theme).render(width) : [];
    },
    renderMessage: (customType, message, width = DEFAULT_WIDTH) => requireRegistered(apiRec.getMessageRenderer(customType), 'MessageRenderer', customType)(message, {}, theme).render(width),
    emit,
    cleanup: async () => {
      await emit('session_shutdown', {});
      rmSync(cwd, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    },
  };
}
