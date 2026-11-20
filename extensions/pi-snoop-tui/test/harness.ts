import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type AgentToolResult,
  type CustomEditor,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ExtensionContext,
  initTheme,
  type KeybindingsManager,
  type MarkdownTransformer,
  type ReadonlyFooterDataProvider,
  type Theme,
  type ToolRendererResolver,
  type ToolRenderers,
} from '@earendil-works/pi-coding-agent';
import { type Component, type EditorTheme, Text, type TUI } from '@earendil-works/pi-tui';
import { vi } from 'vitest';
import chrome from '../src/chrome.ts';
import footer from '../src/footer.ts';
import toolRows from '../src/tool-rows.ts';

export type ThemeName = 'snoop-dark' | 'snoop-light';
export const THEME_NAMES: readonly ThemeName[] = ['snoop-dark', 'snoop-light'];
type Context = Parameters<NonNullable<ToolRenderers['renderCall']>>[2];
type Listener = (event: unknown, ctx: ExtensionContext) => void;
type ThinkingLevel = ReturnType<ExtensionAPI['getThinkingLevel']>;
export type EditorFactory = NonNullable<ReturnType<ExtensionContext['ui']['getEditorComponent']>>;

/**
 * Test doubles implement only the slice of a Pi interface the code under test touches.
 * This is the one place that vouches for the rest, so the doubles themselves stay cast-free.
 */
function isDouble<T>(_value: unknown): _value is T {
  return true;
}
export function double<T>(value: unknown): T {
  if (!isDouble<T>(value)) throw new Error('unreachable: a double is always accepted');
  return value;
}

/** A single replaceable value, so helpers never reassign their own variables. */
interface Cell<T> {
  readonly read: () => T;
  readonly write: (next: T) => void;
}
export function cell<T>(initial: T): Cell<T> {
  let value = initial;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}

const THEMES_DIR = fileURLToPath(new URL('../themes', import.meta.url));
const THEME_GLOBAL = Symbol.for('@earendil-works/pi-coding-agent:theme');
const themes = cell<ReadonlyMap<ThemeName, Theme>>(new Map());

/** Builds a Theme from themes/<name>.json the way Pi does: the file sits in the agent's themes directory. */
export function loadTheme(name: ThemeName): Theme {
  const known = themes.read().get(name);
  if (known) return known;
  // Pi picks truecolor or 256-color codes from COLORTERM.
  vi.stubEnv('COLORTERM', 'truecolor');
  const agentDir = mkdtempSync(join(tmpdir(), 'snoop-theme-'));
  try {
    mkdirSync(join(agentDir, 'themes'));
    copyFileSync(join(THEMES_DIR, `${name}.json`), join(agentDir, 'themes', `${name}.json`));
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    initTheme(name, false);
    // Pi keeps the active theme on this global symbol and does not export the instance.
    const theme = double<Theme>(Reflect.get(globalThis, THEME_GLOBAL));
    if (theme.name !== name) throw new Error(`Pi did not load ${name}`);
    themes.write(new Map([...themes.read(), [name, theme]]));
    return theme;
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
}

const ESC = '\u001b';
const BEL = '\u0007';
/** SGR color/style escapes. */
export const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
/** Pi's hardware-cursor marker. */
export const CURSOR = new RegExp(`${ESC}_pi:c${BEL}`, 'g');
/** What the user reads: colors and Pi's cursor marker removed. */
export function plain(line: string): string {
  return line.replace(CURSOR, '').replace(ANSI, '');
}
export function plainLines(lines: readonly string[]): string[] {
  return lines.map(plain);
}

/** The Pi host: records what the three extensions register and replays Pi's lifecycle events. */
export function loadSnoop(settings: { readonly outputPad?: number } = {}) {
  const listeners = cell<ReadonlyMap<string, readonly Listener[]>>(new Map());
  const resolvers = cell<readonly ToolRendererResolver[]>([]);
  const transformers = cell<readonly MarkdownTransformer[]>([]);
  const registrations = cell<readonly unknown[]>([]);
  const thinking = cell<ThinkingLevel>('medium');
  const api = {
    on: (name: string, listener: Listener) => listeners.write(new Map([...listeners.read(), [name, [...(listeners.read().get(name) ?? []), listener]]])),
    getThinkingLevel: () => thinking.read(),
    getSettings: () => settings,
    registerMarkdownTransformer: (transformer: MarkdownTransformer, options: unknown) => {
      transformers.write([...transformers.read(), transformer]);
      registrations.write([...registrations.read(), options]);
    },
    registerToolRenderer: (resolver: ToolRendererResolver) => resolvers.write([...resolvers.read(), resolver]),
  };
  const pi = double<ExtensionAPI>(api);
  toolRows(pi);
  footer(pi);
  chrome(pi);
  return {
    renderersFor: (toolName: string, native: ToolRenderers | undefined) => resolvers.read().reduce<ToolRenderers | undefined>((current, resolve) => resolve(toolName, () => current), native),
    transformers: () => transformers.read(),
    transformerOptions: () => registrations.read(),
    setThinking: (level: ThinkingLevel) => thinking.write(level),
    fire(name: string, ctx: ExtensionContext): void {
      for (const listener of listeners.read().get(name) ?? []) listener({}, ctx);
    },
  };
}
export type SnoopHost = ReturnType<typeof loadSnoop>;

export interface SessionOptions {
  readonly hasUI?: boolean;
  readonly cwd?: string;
  readonly model?: { readonly id: string; readonly reasoning: boolean } | undefined;
  readonly usagePercent?: number | undefined;
}
const DEFAULT_MODEL = { id: 'claude-test', reasoning: true };
const DEFAULT_USAGE_PERCENT = 18;
const DEFAULT_WORKSPACE = '/project/workspace';
const TUI_ROWS = 40;

/** Pi's session context: UI calls are recorded and the editor slot behaves like Pi's. */
export function createSession(theme: Theme, options: SessionOptions = {}) {
  const model = cell<SessionOptions['model']>('model' in options ? options.model : DEFAULT_MODEL);
  const usage = cell<number | undefined>('usagePercent' in options ? options.usagePercent : DEFAULT_USAGE_PERCENT);
  const currentTheme = cell(theme);
  const editor = cell<EditorFactory | undefined>(undefined);
  const ui = {
    get theme() {
      return currentTheme.read();
    },
    setFooter: vi.fn(),
    setHeader: vi.fn(),
    setWorkingIndicator: vi.fn(),
    setWorkingMessage: vi.fn(),
    setHiddenThinkingLabel: vi.fn(),
    getEditorComponent: () => editor.read(),
    setEditorComponent: vi.fn((factory: EditorFactory | undefined) => editor.write(factory)),
  };
  const ctx = {
    hasUI: options.hasUI ?? true,
    cwd: options.cwd ?? DEFAULT_WORKSPACE,
    get model() {
      return model.read();
    },
    getContextUsage: () => {
      const percent = usage.read();
      return percent === undefined ? undefined : { percent };
    },
    ui,
  };
  return {
    ctx: double<ExtensionContext>(ctx),
    ui,
    setUsage: (percent: number | undefined) => usage.write(percent),
    setModel: (next: SessionOptions['model']) => model.write(next),
    setTheme: (next: Theme) => currentTheme.write(next),
    editorFactory: () => editor.read(),
  };
}
export type Session = ReturnType<typeof createSession>;

export function createTui() {
  const repaints = vi.fn();
  return double<TUI & { readonly repaints: typeof repaints }>({ terminal: { rows: TUI_ROWS }, requestRender: repaints, repaints });
}

export function footerData() {
  const branch = cell<string | null>('main');
  const statuses = cell<ReadonlyMap<string, string>>(new Map());
  const data: ReadonlyFooterDataProvider = { getGitBranch: () => branch.read(), getExtensionStatuses: () => statuses.read(), getAvailableProviderCount: () => 1, onBranchChange: () => () => undefined };
  return {
    data,
    setBranch: (value: string | null) => branch.write(value),
    setStatus: (key: string, text: string) => statuses.write(new Map([...statuses.read(), [key, text]])),
    clearStatuses: () => statuses.write(new Map()),
  };
}

function lastCall<T>(mock: { mock: { calls: readonly (readonly unknown[])[] } }): T {
  const call = mock.mock.calls.at(-1);
  if (!call) throw new Error('Pi was never asked to install it');
  return double<T>(call[0]);
}
type Disposable = Component & { dispose?(): void };

/** Starts a session and mounts the footer Pi was handed, returning the component Pi renders. */
export function mountFooter(host: SnoopHost, session: Session, tui = createTui(), data = footerData()) {
  host.fire('session_start', session.ctx);
  const factory = lastCall<(tui: TUI, theme: Theme, data: ReadonlyFooterDataProvider) => Disposable>(session.ui.setFooter);
  return { footer: factory(tui, session.ui.theme, data.data), tui, data };
}
export function mountHeader(host: SnoopHost, session: Session): Component {
  host.fire('session_start', session.ctx);
  return lastCall<(tui: TUI, theme: Theme) => Component>(session.ui.setHeader)(double<TUI>({}), session.ui.theme);
}

const editorTheme = double<EditorTheme>({
  borderColor: (text: string) => text,
  selectList: { selectedPrefix: (t: string) => t, selectedText: (t: string) => t, description: (t: string) => t, scrollInfo: (t: string) => t, noMatch: (t: string) => t },
});
export function buildEditor(session: Session, tui: TUI = createTui()): CustomEditor {
  const factory = session.editorFactory();
  if (!factory) throw new Error('chrome installed no editor');
  return double<CustomEditor>(factory(tui, editorTheme, double<KeybindingsManager>({})));
}
/** Pi assigns the border color onto the editor instance, for example per thinking level. */
export function setBorderColor(editor: CustomEditor, color: (text: string) => string): void {
  Reflect.set(editor, 'borderColor', color);
}

// Pi's built-in tool definitions are the native renderers Pi hands to `registerToolRenderer`.
const NATIVE_DEFINITIONS = {
  read: createReadToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
  bash: createBashToolDefinition,
  grep: createGrepToolDefinition,
  find: createFindToolDefinition,
  ls: createLsToolDefinition,
};
export function piNative(toolName: keyof typeof NATIVE_DEFINITIONS, cwd: string): ToolRenderers {
  return double<ToolRenderers>(NATIVE_DEFINITIONS[toolName](cwd));
}

export interface RowEvent {
  /** Passing `undefined` explicitly models Pi calling a renderer before any arguments exist. */
  readonly args?: Record<string, unknown> | undefined;
  readonly executionStarted?: boolean;
  readonly result?: { readonly content: AgentToolResult<unknown>['content']; readonly details?: unknown; readonly isError?: boolean };
  readonly isPartial?: boolean;
  readonly expanded?: boolean;
  readonly invalidate?: boolean;
}
interface RowInputs {
  readonly args: Record<string, unknown> | undefined;
  readonly started: boolean;
  readonly partial: boolean;
  readonly expanded: boolean;
  readonly result: RowEvent['result'];
}
export const PROJECT = '/project';
export const ROOT_PATH = '/';
const KEY_TEXT = 'ctrl+o';
function rowContext(inputs: RowInputs, state: object, opts: RowOptions | undefined, lastComponent: Component | undefined): Context {
  return {
    args: inputs.args,
    state,
    toolCallId: 'test',
    invalidate: () => {
      throw new Error('recursive invalidation');
    },
    lastComponent,
    cwd: opts?.cwd ?? PROJECT,
    executionStarted: inputs.started,
    argsComplete: true,
    isPartial: inputs.partial,
    expanded: inputs.expanded,
    showImages: false,
    isError: inputs.result?.isError ?? false,
    durationMs: inputs.partial ? undefined : 10,
    outputPad: opts?.outputPad ?? 1,
    keyText: () => KEY_TEXT,
    keyHint: () => `${KEY_TEXT} to expand`,
  };
}
export interface RowOptions {
  readonly cwd?: string;
  readonly outputPad?: number;
  readonly theme?: Theme;
  /** Renderers Pi would supply for the tool. `undefined` means Pi has none; the default is an empty set. */
  readonly native?: ToolRenderers | undefined;
}
export const EMPTY_NATIVE: ToolRenderers = {};

/** Plays Pi's tool-call lifecycle against the renderers the tool-rows extension resolves for `toolName`. */
export function driveRow(host: SnoopHost, toolName: string, opts: RowOptions = {}) {
  const theme = opts.theme ?? loadTheme('snoop-dark');
  const native = 'native' in opts ? opts.native : EMPTY_NATIVE;
  const renderers = host.renderersFor(toolName, native);
  const state = {};
  const call = cell<Component | undefined>(undefined);
  const result = cell<Component | undefined>(undefined);
  const inputs = cell<RowInputs>({ args: {}, started: false, partial: true, expanded: false, result: undefined });
  return {
    renderers,
    apply(event: RowEvent): void {
      if (event.invalidate) {
        call.read()?.invalidate();
        result.read()?.invalidate();
      }
      const prev = inputs.read();
      const next: RowInputs = {
        args: 'args' in event ? event.args : prev.args,
        started: event.executionStarted ?? prev.started,
        partial: event.isPartial ?? prev.partial,
        expanded: event.expanded ?? prev.expanded,
        result: event.result ?? prev.result,
      };
      inputs.write(next);
      call.write(renderers?.renderCall?.(next.args, theme, rowContext(next, state, opts, call.read())));
      if (next.result) result.write(renderers?.renderResult?.({ content: next.result.content, details: next.result.details }, { expanded: next.expanded, isPartial: next.partial }, theme, rowContext(next, state, opts, result.read())));
    },
    lines: (width: number): string[] => [...(call.read()?.render(width) ?? []), ...(result.read()?.render(width) ?? [])],
    text: (width: number): string[] => plainLines([...(call.read()?.render(width) ?? []), ...(result.read()?.render(width) ?? [])]),
  };
}
export type Row = ReturnType<typeof driveRow>;

/** A native renderer that draws `lines` in the result slot. */
export function fakeNative(lines: readonly string[] = ['NATIVE 漢字 🙂']) {
  const native: ToolRenderers = { renderResult: () => new Text(lines.join('\n'), 0, 0) };
  return { native };
}
/** A native result renderer that returns the raw lines it is given, with no trimming of its own. */
export function rawNative(lines: readonly string[]): ToolRenderers {
  return { renderResult: () => ({ render: () => [...lines], invalidate: () => undefined }) };
}

export function output(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}
