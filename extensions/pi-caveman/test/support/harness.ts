import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, MessageRenderer, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { vi } from 'vitest';
import caveman from '../../src/index.ts';

// The vendored runtime spawns the caveman CLI on session_start; package-runtime.test.ts covers it through real Pi.
vi.mock(import('#caveman-runtime'), () => ({ default: () => undefined }));

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;
type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown };
type SentMessage = { readonly customType: string; readonly content: string; readonly display: boolean };

export interface Harness {
  readonly emit: (name: string, event: Record<string, unknown>) => unknown[];
  readonly command: (name: string, args?: string) => Promise<void>;
  readonly completions: (name: string, prefix: string) => unknown;
  readonly turn: (prompt: string) => { sections: Record<string, string>; result: unknown };
  readonly entries: readonly unknown[];
  readonly messages: readonly SentMessage[];
  readonly statuses: readonly (string | undefined)[];
  readonly notices: readonly string[];
  readonly commandNames: () => string[];
  readonly toolNames: () => string[];
  readonly tool: (name: string) => ToolDefinition | undefined;
  readonly renderer: (customType: string) => MessageRenderer | undefined;
  readonly record: (entry: unknown) => void;
}

export function harness(cwd: string = process.cwd(), { hasUI = true, resources = [] }: { readonly hasUI?: boolean; readonly resources?: ReturnType<ExtensionAPI['getCommands']> } = {}): Harness {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, Command>();
  const tools = new Map<string, ToolDefinition>();
  const renderers = new Map<string, MessageRenderer>();
  const entries: unknown[] = [];
  const messages: SentMessage[] = [];
  const statuses: (string | undefined)[] = [];
  const notices: string[] = [];
  const pi = {
    getCommands: () => resources,
    on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerCommand: (name: string, command: Command) => commands.set(name, command),
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerMessageRenderer: (customType: string, renderer: MessageRenderer) => renderers.set(customType, renderer),
    appendEntry: (customType: string, data: unknown) => entries.push({ type: 'custom', customType, data, timestamp: new Date().toISOString() }),
    sendMessage: async (message: SentMessage) => {
      messages.push(message);
    },
  };
  const ctx = {
    cwd,
    hasUI,
    ui: { setStatus: (_key: string, text: string | undefined) => statuses.push(text), notify: (text: string) => notices.push(text), theme: { fg: (_c: string, text: string) => text } },
    sessionManager: { getBranch: () => entries, getSessionId: () => 'sid', getSessionFile: () => undefined },
  };
  caveman(pi as unknown as ExtensionAPI);
  const emit = (name: string, event: Record<string, unknown>) => (handlers.get(name) ?? []).map((handler) => handler({ type: name, ...event }, ctx as unknown as ExtensionContext));
  return {
    emit,
    command: async (name, args = '') => commands.get(name)?.handler(args, ctx as unknown as ExtensionCommandContext),
    completions: (name, prefix) => commands.get(name)?.getArgumentCompletions?.(prefix),
    turn: (prompt) => {
      const sections: Record<string, string> = {};
      const [result] = emit('before_agent_start', { prompt, systemPromptOptions: { sections } });
      return { sections, result };
    },
    entries,
    messages,
    statuses,
    notices,
    commandNames: () => [...commands.keys()].sort(),
    toolNames: () => [...tools.keys()].sort(),
    tool: (name) => tools.get(name),
    renderer: (customType) => renderers.get(customType),
    record: (entry) => {
      entries.push(entry);
    },
  };
}
