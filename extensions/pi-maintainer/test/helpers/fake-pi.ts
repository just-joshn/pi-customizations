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
  };
}

function makeContext(records: Records, options: HarnessOptions, shutdown: () => void): ExtensionContext {
  const context = {
    ui: {
      confirm: async (title: string): Promise<boolean> => {
        records.confirmations.push(title);
        return options.confirmAnswer ?? false;
      },
      notify: (message: string, type?: string): void => {
        records.notifications.push({ message, type });
      },
      setEditorText: (text: string): void => {
        records.editorTexts.push(text);
      },
    },
    mode: 'tui',
    hasUI: options.hasUI ?? true,
    cwd: options.cwd ?? '/repo',
    sessionManager: { getBranch: () => [], getSessionFile: () => undefined },
    signal: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    shutdown,
    waitForIdle: async (): Promise<void> => undefined,
  } as unknown as ExtensionContext;
  (context as unknown as { newSession: unknown }).newSession = async (sessionOptions: { withSession?: (ctx: ExtensionContext) => Promise<void> }): Promise<{ cancelled: boolean }> => {
    if (sessionOptions.withSession !== undefined) await sessionOptions.withSession(context);
    return { cancelled: false };
  };
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
  readonly shutdowns: () => number;
  emit(type: string, event: unknown): Promise<unknown>;
  setFlag(name: string, value: unknown): void;
}

export function createHarness(options: HarnessOptions = {}): MaintainerHarness {
  const records = makeRecords(options);
  let shutdownCount = 0;
  const context = makeContext(records, options, () => {
    shutdownCount += 1;
  });
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
