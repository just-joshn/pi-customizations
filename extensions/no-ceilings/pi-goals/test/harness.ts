import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, ExtensionWidgetOptions, Theme } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import piGoalsExtension from '../src/index.ts';
import type { GoalToolDetails } from '../src/types.ts';

const DEFAULT_WIDTH = 80;
const ZERO = 0;

interface RegisteredCommand {
  readonly description: string;
  readonly handler: (args: string, ctx: ExtensionContext) => Promise<void>;
}

interface RegisteredTool {
  readonly name: string;
  readonly execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: ((partial: AgentToolResult<GoalToolDetails>) => void) | undefined, ctx: ExtensionContext) => Promise<AgentToolResult<GoalToolDetails>>;
  readonly renderCall?: (args: Record<string, unknown>, theme: Theme) => { readonly render: (width: number) => string[] };
  readonly renderResult?: (result: AgentToolResult<GoalToolDetails | undefined>, options: { readonly expanded: boolean; readonly isPartial: boolean }, theme: Theme) => { readonly render: (width: number) => string[] };
}

type WidgetFactory = (tui: TUI, theme: Theme) => Component & { readonly dispose?: () => void };
type WidgetSlot = { readonly content: readonly string[] | WidgetFactory | undefined; readonly options?: ExtensionWidgetOptions };
type MessageRenderer = (message: { readonly details?: unknown; readonly content: unknown }, options: unknown, theme: Theme) => { readonly render: (width: number) => string[] };
type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

export interface HarnessOptions {
  readonly sessionId?: string;
  readonly hasUI?: boolean;
  readonly flags?: Readonly<Record<string, boolean | string>>;
  readonly initialEntries?: readonly Record<string, unknown>[];
}

export interface GoalsTestHarness {
  readonly ctx: ExtensionContext;
  readonly theme: Theme;
  readonly getStatuses: () => Readonly<Record<string, string | undefined>>;
  readonly getWidgets: () => Readonly<Record<string, WidgetSlot | undefined>>;
  readonly renderWidget: (key: string, width?: number) => { readonly lines: readonly string[]; readonly dispose: () => void };
  readonly getNotifications: () => readonly { readonly message: string; readonly level?: string }[];
  readonly getEntries: () => readonly { readonly customType: string; readonly data: unknown }[];
  readonly getSentMessages: () => readonly { readonly message: unknown; readonly options?: unknown }[];
  readonly getSentUserMessages: () => readonly { readonly content: string; readonly options?: unknown }[];
  readonly runCommand: (name: string, args?: string) => Promise<void>;
  readonly callTool: (name: string, params: unknown, options?: { readonly signal?: AbortSignal }) => Promise<AgentToolResult<GoalToolDetails>>;
  readonly renderToolCall: (name: string, args: Record<string, unknown>, width?: number) => readonly string[];
  readonly renderToolResult: (name: string, result: AgentToolResult<GoalToolDetails | undefined>, expanded: boolean, isPartial: boolean, width?: number) => readonly string[];
  readonly renderMessage: (customType: string, message: { readonly details?: unknown; readonly content: unknown }, width?: number) => readonly string[];
  readonly emit: (eventName: string, event: unknown) => Promise<unknown>;
  readonly buildBeforeSettleEvent: (overrides?: Partial<AgentBeforeSettleEvent>) => AgentBeforeSettleEvent;
  readonly cleanup: () => Promise<void>;
}

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
  });
}

function requireRegistered<T>(value: T | undefined, kind: string, name: string): T {
  if (!value) {
    throw new Error(`${kind} not registered: ${name}`);
  }
  return value;
}

function createUiRecorder(theme: Theme) {
  let statuses: Readonly<Record<string, string | undefined>> = {};
  let widgets: Readonly<Record<string, WidgetSlot | undefined>> = {};
  let notifications: readonly { readonly message: string; readonly level?: string }[] = [];

  const ui = double<ExtensionContext['ui']>({
    theme,
    setStatus: (key: string, value: string | undefined) => {
      statuses = { ...statuses, [key]: value };
    },
    setWidget: (key: string, content: readonly string[] | WidgetFactory | undefined, options?: ExtensionWidgetOptions) => {
      widgets = { ...widgets, [key]: content === undefined ? undefined : { content, ...(options ? { options } : {}) } };
    },
    notify: (message: string, level?: string) => {
      notifications = [...notifications, level ? { message, level } : { message }];
    },
  });

  return { ui, getStatuses: () => statuses, getWidgets: () => widgets, getNotifications: () => notifications };
}

function createApiRecorder(flagOverrides: Readonly<Record<string, boolean | string>>) {
  let flagDefaults: Readonly<Record<string, boolean | string | undefined>> = {};
  let entries: readonly { readonly customType: string; readonly data: unknown }[] = [];
  let sentMessages: readonly { readonly message: unknown; readonly options?: unknown }[] = [];
  let sentUserMessages: readonly { readonly content: string; readonly options?: unknown }[] = [];
  let commands: Readonly<Record<string, RegisteredCommand>> = {};
  let tools: Readonly<Record<string, RegisteredTool>> = {};
  let renderers: Readonly<Record<string, MessageRenderer>> = {};
  let listeners: Readonly<Record<string, readonly EventHandler[]>> = {};

  const pi = double<ExtensionAPI>({
    registerFlag: (name: string, opts: { readonly default?: boolean | string }) => {
      flagDefaults = { ...flagDefaults, [name]: opts.default };
    },
    getFlag: (name: string) => (name in flagOverrides ? flagOverrides[name] : flagDefaults[name]),
    registerCommand: (name: string, cmd: RegisteredCommand) => {
      commands = { ...commands, [name]: cmd };
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
      return () => undefined;
    },
  });

  return {
    pi,
    getEntries: () => entries,
    getSentMessages: () => sentMessages,
    getSentUserMessages: () => sentUserMessages,
    getCommand: (name: string) => commands[name],
    getTool: (name: string) => tools[name],
    getMessageRenderer: (customType: string) => renderers[customType],
    getListeners: (eventName: string) => listeners[eventName] ?? [],
  };
}

function renderSlotWidget(slot: WidgetSlot | undefined, theme: Theme, width: number): { readonly lines: readonly string[]; readonly dispose: () => void } {
  if (!slot || slot.content === undefined) {
    return { lines: [], dispose: () => undefined };
  }
  if (typeof slot.content !== 'function') {
    return { lines: slot.content, dispose: () => undefined };
  }
  const comp = slot.content(double<TUI>({ requestRender: () => undefined }), theme);
  return { lines: comp.render(width), dispose: () => comp.dispose?.() };
}

function makeBeforeSettleEvent(overrides: Partial<AgentBeforeSettleEvent> = {}): AgentBeforeSettleEvent {
  return double<AgentBeforeSettleEvent>({
    type: 'agent_before_settle',
    outcome: 'completed',
    entries: [],
    continue: false,
    context: { contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: true },
    ...overrides,
  });
}

export function createGoalsTestHarness(options: HarnessOptions = {}): GoalsTestHarness {
  const sessionId = options.sessionId ?? '11111111-2222-4333-8444-555555555555';
  const theme = createFakeTheme();
  const uiRec = createUiRecorder(theme);
  const apiRec = createApiRecorder(options.flags ?? {});

  const ctx = double<ExtensionContext>({
    cwd: process.cwd(),
    hasUI: options.hasUI ?? true,
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => [...(options.initialEntries ?? []), ...apiRec.getEntries().map((e) => ({ type: 'custom', customType: e.customType, data: e.data }))],
    },
    ui: uiRec.ui,
  });

  piGoalsExtension(apiRec.pi);

  const emit = async (eventName: string, event: unknown): Promise<unknown> => {
    let lastResult: unknown;
    for (const handler of apiRec.getListeners(eventName)) {
      lastResult = await handler(event, ctx);
    }
    return lastResult;
  };

  return {
    ctx,
    theme,
    getStatuses: uiRec.getStatuses,
    getWidgets: uiRec.getWidgets,
    renderWidget: (key, width = DEFAULT_WIDTH) => renderSlotWidget(uiRec.getWidgets()[key], theme, width),
    getNotifications: uiRec.getNotifications,
    getEntries: apiRec.getEntries,
    getSentMessages: apiRec.getSentMessages,
    getSentUserMessages: apiRec.getSentUserMessages,
    runCommand: (name, args = '') => requireRegistered(apiRec.getCommand(name), 'Command', name).handler(args, ctx),
    callTool: (name, params, opts) => requireRegistered(apiRec.getTool(name), 'Tool', name).execute(`call-${ZERO}`, params, opts?.signal, undefined, ctx),
    renderToolCall: (name, args, width = DEFAULT_WIDTH) => requireRegistered(apiRec.getTool(name), 'Tool', name).renderCall?.(args, theme).render(width) ?? [],
    renderToolResult: (name, result, expanded, isPartial, width = DEFAULT_WIDTH) => requireRegistered(apiRec.getTool(name), 'Tool', name).renderResult?.(result, { expanded, isPartial }, theme).render(width) ?? [],
    renderMessage: (customType, message, width = DEFAULT_WIDTH) => requireRegistered(apiRec.getMessageRenderer(customType), 'MessageRenderer', customType)(message, {}, theme).render(width),
    emit,
    buildBeforeSettleEvent: makeBeforeSettleEvent,
    cleanup: async () => {
      await emit('session_shutdown', {});
    },
  };
}
