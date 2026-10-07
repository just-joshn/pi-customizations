import type { ExtensionCommandContext, ExtensionContext, ExtensionToolContext, RegisteredCommand, ToolDefinition } from '@earendil-works/pi-coding-agent';
import s50 from '../../src/index.ts';

type Pi = Parameters<typeof s50>[0];

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

export type Sent = { readonly customType: string; readonly content: unknown; readonly display: boolean };

export type FakeUi = { readonly confirms: string[]; readonly notes: string[]; readonly answer: boolean };

export type FakePi = {
  readonly tool: ToolDefinition;
  readonly command: Omit<RegisteredCommand, 'name' | 'sourceInfo'>;
  readonly sent: readonly Sent[];
  readonly handlers: ReadonlyMap<string, readonly Handler[]>;
};

export function loadFakePi(options: { readonly skills?: readonly { readonly name: string; readonly path: string }[]; readonly tools?: readonly string[] } = {}): FakePi {
  let tool: ToolDefinition | undefined;
  let command: Omit<RegisteredCommand, 'name' | 'sourceInfo'> | undefined;
  const sent: Sent[] = [];
  const handlers = new Map<string, Handler[]>();
  const sourceInfo = { path: '', source: 'test', scope: 'temporary', origin: 'top-level' } as const;
  const pi = {
    registerTool: (definition: ToolDefinition) => {
      tool = definition;
    },
    registerCommand: (_name: string, definition: Omit<RegisteredCommand, 'name' | 'sourceInfo'>) => {
      command = definition;
    },
    getCommands: () => (options.skills ?? []).map((skill) => ({ name: `skill:${skill.name}`, source: 'skill', sourceInfo: { ...sourceInfo, path: skill.path } })),
    getAllTools: () => (options.tools ?? []).map((name) => ({ name, description: '', parameters: {}, exposure: 'direct', sourceInfo })),
    sendMessage: (message: Sent) => {
      sent.push(message);
    },
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => undefined;
    },
  };
  // The fake implements only the slice of ExtensionAPI that the s50 factory declares in its Pi type; Pi's overloads cannot be restated without a cast.
  s50(pi as unknown as Pi);
  if (tool === undefined || command === undefined) throw new Error('s50 did not register its tool and command');
  return { tool, command, sent, handlers };
}

export function fakeUi(answer: boolean): FakeUi {
  return { confirms: [], notes: [], answer };
}

function uiOf(ui: FakeUi | null) {
  return {
    confirm: async (title: string, message: string) => {
      ui?.confirms.push(`${title}: ${message}`);
      return ui?.answer ?? false;
    },
    notify: (message: string, level: string) => {
      ui?.notes.push(`${level}: ${message}`);
    },
  };
}

// A real context needs a running Pi session; the tool, command, and event handlers read only cwd, hasUI, ui, and signal.
export function toolContext(cwd: string, ui: FakeUi | null): ExtensionToolContext {
  return { cwd, hasUI: ui !== null, ui: uiOf(ui), signal: undefined } as unknown as ExtensionToolContext;
}

export function commandContext(cwd: string, ui: FakeUi): ExtensionCommandContext {
  return { cwd, hasUI: true, ui: uiOf(ui), signal: undefined } as unknown as ExtensionCommandContext;
}

export function eventContext(cwd: string, ui: FakeUi | null): ExtensionContext {
  return { cwd, hasUI: ui !== null, ui: uiOf(ui), signal: undefined } as unknown as ExtensionContext;
}
