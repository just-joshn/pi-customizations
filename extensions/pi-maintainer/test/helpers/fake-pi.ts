import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

export interface Notification {
  readonly message: string;
  readonly type: string | undefined;
}

export interface CustomEntry {
  readonly customType: string;
  readonly data: unknown;
}

export interface RegisteredCommand {
  readonly description: string;
  readonly handler: (args: string, ctx: ExtensionContext) => Promise<unknown> | unknown;
}

export interface HarnessOptions {
  readonly hasUI?: boolean;
  readonly confirmAnswer?: boolean;
  readonly flags?: Readonly<Record<string, unknown>>;
  readonly cwd?: string;
  readonly exec?: (args: readonly string[]) => Promise<{ code: number; stdout: string }>;
  /** The file the command context reports from `getSessionFile`. Undefined models `pi --no-session`. */
  readonly sessionFile?: string;
  /** Model Pi's replacement: `newSession` disposes the command context and runs the callback in a fresh one. */
  readonly replaceSession?: boolean;
}

type Handler = (event: never, ctx: ExtensionContext) => unknown;

interface Records {
  readonly flags: Map<string, unknown>;
  readonly notifications: Notification[];
  readonly entries: CustomEntry[];
  readonly messages: unknown[];
  readonly userMessages: string[];
  readonly confirmations: string[];
  readonly editorTexts: string[];
  readonly commands: Map<string, RegisteredCommand>;
  readonly handlers: Map<string, Handler[]>;
  readonly replacementNotifications: Notification[];
  readonly replacementUserMessages: string[];
  readonly sessionSwitches: string[];
}

function makeRecords(options: HarnessOptions): Records {
  return {
    flags: new Map<string, unknown>(Object.entries(options.flags ?? {})),
    notifications: [],
    entries: [],
    messages: [],
    userMessages: [],
    confirmations: [],
    editorTexts: [],
    commands: new Map<string, RegisteredCommand>(),
    handlers: new Map<string, Handler[]>(),
    replacementNotifications: [],
    replacementUserMessages: [],
    sessionSwitches: [],
  };
}

interface ContextSink {
  readonly sessionFile: string | undefined;
  readonly notifications: Notification[];
}

function makeContextTarget(records: Records, options: HarnessOptions, shutdown: () => void, sink: ContextSink, replacement: boolean): Record<string, unknown> {
  const target: Record<string, unknown> = {
    ui: {
      confirm: async (title: string): Promise<boolean> => {
        records.confirmations.push(title);
        return options.confirmAnswer ?? false;
      },
      notify: (message: string, type?: string): void => {
        sink.notifications.push({ message, type });
      },
      setEditorText: (text: string): void => {
        records.editorTexts.push(text);
      },
    },
    mode: 'tui',
    hasUI: options.hasUI ?? true,
    cwd: options.cwd ?? '/repo',
    sessionManager: { getBranch: () => [], getSessionFile: () => sink.sessionFile },
    signal: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    shutdown,
    waitForIdle: async (): Promise<void> => undefined,
  };
  if (!replacement) return target;
  target.sendUserMessage = async (content: unknown): Promise<void> => {
    records.replacementUserMessages.push(String(content));
  };
  target.switchSession = async (sessionPath: string): Promise<{ cancelled: boolean }> => {
    records.sessionSwitches.push(sessionPath);
    return { cancelled: false };
  };
  return target;
}

function makeContext(records: Records, options: HarnessOptions, shutdown: () => void, sink: ContextSink, replacement: boolean): ExtensionContext {
  let disposed = false;
  let replacementContext: ExtensionContext | undefined;
  const target = makeContextTarget(records, options, shutdown, sink, replacement);
  if (!replacement) {
    target.newSession = async (sessionOptions: { withSession?: (ctx: ExtensionContext) => Promise<void> }): Promise<{ cancelled: boolean }> => {
      if (sessionOptions.withSession === undefined) return { cancelled: false };
      if (options.replaceSession !== true) {
        await sessionOptions.withSession(context);
        return { cancelled: false };
      }
      replacementContext ??= makeContext(records, options, shutdown, { sessionFile: '/tmp/pi-replacement.jsonl', notifications: records.replacementNotifications }, true);
      disposed = true;
      await sessionOptions.withSession(replacementContext);
      return { cancelled: false };
    };
  }
  const context = new Proxy(target, {
    get: (source, property): unknown => {
      if (disposed) throw new Error(`Pi disposed the replaced session context before ${String(property)} was read`);
      return Reflect.get(source, property);
    },
  }) as unknown as ExtensionContext;
  return context;
}

function makePi(records: Records, options: HarnessOptions): ExtensionAPI {
  return {
    on: (type: string, handler: Handler): (() => void) => {
      records.handlers.set(type, [...(records.handlers.get(type) ?? []), handler]);
      return () => undefined;
    },
    registerFlag: (name: string, definition: { default?: unknown }): void => {
      if (!records.flags.has(name)) records.flags.set(name, definition.default);
    },
    getFlag: (name: string): unknown => records.flags.get(name),
    appendEntry: (customType: string, data: unknown): void => {
      records.entries.push({ customType, data });
    },
    sendMessage: (message: unknown): void => {
      records.messages.push(message);
    },
    sendUserMessage: (content: unknown): void => {
      records.userMessages.push(String(content));
    },
    registerCommand: (name: string, command: RegisteredCommand): void => {
      records.commands.set(name, command);
    },
    exec: (command: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
      options.exec === undefined ? Promise.resolve({ code: 0, stdout: '', stderr: '' }) : options.exec([command, ...args]).then((result) => ({ ...result, stderr: '' })),
  } as unknown as ExtensionAPI;
}

/**
 * A minimal stand-in for the Pi extension host. Registration is recorded, and
 * tests drive the handlers they care about through `emit`. Nothing here touches
 * session transcripts; `sessionManager` is a read-only stub.
 */
export interface MaintainerHarness {
  readonly pi: ExtensionAPI;
  readonly context: ExtensionContext;
  readonly flags: Map<string, unknown>;
  readonly notifications: Notification[];
  readonly entries: CustomEntry[];
  readonly messages: unknown[];
  readonly userMessages: string[];
  readonly confirmations: string[];
  readonly editorTexts: string[];
  readonly commands: Map<string, RegisteredCommand>;
  readonly replacementNotifications: Notification[];
  readonly replacementUserMessages: string[];
  readonly sessionSwitches: string[];
  readonly shutdowns: () => number;
  emit(type: string, event: unknown): Promise<unknown>;
  setFlag(name: string, value: unknown): void;
}

export function createHarness(options: HarnessOptions = {}): MaintainerHarness {
  const records = makeRecords(options);
  let shutdownCount = 0;
  const context = makeContext(
    records,
    options,
    () => {
      shutdownCount += 1;
    },
    { sessionFile: options.sessionFile, notifications: records.notifications },
    false,
  );
  const pi = makePi(records, options);
  return {
    pi,
    context,
    flags: records.flags,
    notifications: records.notifications,
    entries: records.entries,
    messages: records.messages,
    userMessages: records.userMessages,
    confirmations: records.confirmations,
    editorTexts: records.editorTexts,
    commands: records.commands,
    replacementNotifications: records.replacementNotifications,
    replacementUserMessages: records.replacementUserMessages,
    sessionSwitches: records.sessionSwitches,
    shutdowns: () => shutdownCount,
    setFlag: (name: string, value: unknown): void => {
      records.flags.set(name, value);
    },
    emit: async (type: string, event: unknown): Promise<unknown> => {
      let result: unknown;
      for (const handler of records.handlers.get(type) ?? []) {
        result = await handler(event as never, context);
      }
      return result;
    },
  };
}
