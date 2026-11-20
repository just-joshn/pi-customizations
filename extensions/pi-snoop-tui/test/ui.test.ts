import type { ExtensionAPI, ExtensionContext, MarkdownTransformer, ReadonlyFooterDataProvider, ToolRendererResolver } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { expect, test, vi } from 'vitest';
import { cell } from '../src/cell.ts';
import chrome, { headerLine } from '../src/chrome.ts';
import footer, { type FooterSnapshot, fitSegments, readSnapshot, SEGMENT_ORDER, sameSnapshot, snoopFooter, statusText } from '../src/footer.ts';
import toolRows from '../src/tool-rows.ts';
import { plain, stubTheme } from './harness.ts';

function events() {
  const handlers = cell<ReadonlyMap<string, (event: unknown, ctx: ExtensionContext) => void>>(new Map());
  const transformers = cell<readonly MarkdownTransformer[]>([]);
  const api = {
    on: vi.fn((name: string, listener: (event: unknown, ctx: ExtensionContext) => void) => {
      handlers.write(new Map([...handlers.read(), [name, listener]]));
    }),
    getThinkingLevel: () => 'medium',
    getSettings: () => ({ outputPad: 1 }),
    registerMarkdownTransformer: vi.fn((transformer: MarkdownTransformer) => {
      transformers.write([...transformers.read(), transformer]);
    }),
  } as unknown as ExtensionAPI;
  return {
    api,
    get transformers() {
      return transformers.read();
    },
    fire(name: string, ctx: ExtensionContext) {
      const handler = handlers.read().get(name);
      expect(handler).toBeDefined();
      handler?.({}, ctx);
    },
  };
}
function context(hasUI = true) {
  return {
    hasUI,
    cwd: WORKSPACE_PATH,
    model: { id: 'model', reasoning: true },
    getContextUsage: vi.fn(() => ({ percent: 18 })),
    ui: {
      theme: stubTheme(),
      setFooter: vi.fn(),
      setHeader: vi.fn(),
      setWorkingIndicator: vi.fn(),
      setWorkingMessage: vi.fn(),
      setHiddenThinkingLabel: vi.fn(),
      getEditorComponent: vi.fn(() => undefined),
      setEditorComponent: vi.fn(),
    },
  } as unknown as ExtensionContext;
}
function dataProvider() {
  let branch: string | null = 'main';
  const statuses = cell<ReadonlyMap<string, string>>(new Map());
  const data: ReadonlyFooterDataProvider = { getGitBranch: () => branch, getExtensionStatuses: () => statuses.read(), getAvailableProviderCount: () => 1, onBranchChange: () => vi.fn() };
  return {
    data,
    setStatus(key: string, text: string) {
      statuses.write(new Map([...statuses.read(), [key, text]]));
    },
    clearStatuses() {
      statuses.write(new Map());
    },
    branch(value: string | null) {
      branch = value;
    },
  };
}
const WIDE = 120;
const NARROW = 80;
const GUTTER_WIDTH = 100;
const SWEEP_WIDTH = 160;
const HEADER_SWEEP = 120;
const LAST_HEADER_WIDTH = 119;
const HEADER_LINES = 3;
const MIN_GUTTER_WIDTH = 3;
const WARNING_PERCENT = 71;
const ERROR_PERCENT = 91;
const PROJECT_PATH = '/project';
const WORKSPACE_PATH = '/project/workspace';
const ROOT_PATH = '/';
const snapshot: FooterSnapshot = { workspace: 'test test 漢字🙂', model: 'model', thinking: 'medium', ctxPercent: 18 };

test('fits footer segments in priority order without wrapping', () => {
  const texts = { workspace: 'test test 漢字🙂', branch: 'long-branch-name', statuses: 'status text 漢字🙂', model: 'model-name', thinking: 'medium', ctx: 'ctx 18%' };
  const segments = SEGMENT_ORDER.map((s) => ({ ...s, text: texts[s.id] }));
  const theme = stubTheme();
  const provider = dataProvider();
  provider.setStatus('test', texts.statuses);
  const footer = snoopFooter(theme, provider.data, () => snapshot, vi.fn(), 0);
  for (let width = 0; width < SWEEP_WIDTH; width++) {
    const fitted = fitSegments(segments, width);
    expect(fitted.map((s) => s.id)).toEqual(segments.filter((s) => fitted.some((f) => f.id === s.id)).map((s) => s.id));
    const lines = footer.render(width);
    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0] ?? '')).toBeLessThanOrEqual(width);
  }
  expect(fitSegments(segments, 1).map((s) => s.id)).toEqual(['workspace']);
  expect(fitSegments([], 0)).toEqual([]);
  expect(fitSegments([{ id: 'branch', side: 'left', priority: 4, text: '' }], 0)).toEqual([]);
});

test('footer caches snapshot and reads branch and statuses live', () => {
  const theme = stubTheme();
  const provider = dataProvider();
  let current: FooterSnapshot | undefined = snapshot;
  const disposed = vi.fn();
  const footer = snoopFooter(theme, provider.data, () => current, disposed, 0);
  const first = footer.render(WIDE);
  const count = vi.mocked(theme.fg).mock.calls.length;
  expect(footer.render(WIDE)).toEqual(first);
  expect(vi.mocked(theme.fg).mock.calls).toHaveLength(count);
  provider.branch('feature');
  expect(plain(footer.render(WIDE)[0] ?? '')).toContain('feature');
  provider.setStatus('task', '\x1b[31ma\nb');
  expect(plain(footer.render(WIDE)[0] ?? '')).toContain('a b');
  footer.invalidate();
  footer.render(WIDE);
  expect(vi.mocked(theme.fg).mock.calls.length).toBeGreaterThan(count);
  for (const [ctxPercent, color] of [
    [null, 'dim'],
    [WARNING_PERCENT, 'warning'],
    [ERROR_PERCENT, 'error'],
  ] as const) {
    current = { ...snapshot, ctxPercent };
    footer.render(WIDE);
    expect(theme.fg).toHaveBeenCalledWith(color, ctxPercent === null ? 'ctx ?' : `ctx ${ctxPercent}%`);
  }
  current = undefined;
  provider.branch(null);
  provider.clearStatuses();
  expect(plain(footer.render(WIDE)[0] ?? '')).toBe('ctx ?');
  footer.dispose();
  expect(disposed).toHaveBeenCalledOnce();
});

test('snapshots omit thinking on non-reasoning models and tolerate unknown usage', () => {
  const ctx = context();
  expect(readSnapshot(ctx, 'medium')).toEqual({ workspace: 'workspace', model: 'model', thinking: 'medium', ctxPercent: 18 });
  const empty = readSnapshot({ cwd: ROOT_PATH, model: undefined, getContextUsage: () => undefined }, 'off');
  expect(empty).toEqual({ workspace: ROOT_PATH, model: undefined, thinking: undefined, ctxPercent: null });
  expect(sameSnapshot(snapshot, { ...snapshot })).toBe(true);
  for (const difference of [{ workspace: 'other' }, { model: 'other' }, { thinking: 'off' as const }, { ctxPercent: null }]) expect(sameSnapshot(snapshot, { ...snapshot, ...difference })).toBe(false);
  expect(
    statusText(
      new Map([
        ['z', 'last\nline'],
        ['a', '\x1b[31mtext'],
        ['b', '  '],
      ]),
    ),
  ).toBe('text · last line');
});

test('footer events refresh only on changes and dispose stops render requests', () => {
  const ev = events();
  footer(ev.api);
  const nonUI = context(false);
  ev.fire('session_start', nonUI);
  ev.fire('turn_end', nonUI);
  expect(nonUI.getContextUsage).not.toHaveBeenCalled();
  expect(nonUI.ui.setFooter).not.toHaveBeenCalled();
  const ctx = context();
  ev.fire('session_start', ctx);
  const factory = vi.mocked(ctx.ui.setFooter).mock.calls[0]?.[0];
  expect(factory).toBeTypeOf('function');
  const tui = { requestRender: vi.fn() };
  const component = factory?.(tui as never, ctx.ui.theme, dataProvider().data);
  for (const name of ['model_select', 'thinking_level_select', 'turn_end', 'agent_end', 'session_compact', 'session_tree']) ev.fire(name, ctx);
  expect(tui.requestRender).not.toHaveBeenCalled();
  vi.mocked(ctx.getContextUsage).mockReturnValue({ percent: 20 } as ReturnType<ExtensionContext['getContextUsage']>);
  ev.fire('turn_end', ctx);
  expect(tui.requestRender).toHaveBeenCalledOnce();
  component?.dispose?.();
  vi.mocked(ctx.getContextUsage).mockReturnValue(undefined);
  ev.fire('agent_end', ctx);
  expect(tui.requestRender).toHaveBeenCalledOnce();
});

test('chrome is UI-only and installs a quiet working state, inset header, and the rule editor', () => {
  const ev = events();
  chrome(ev.api);
  const nonUI = context(false);
  ev.fire('session_start', nonUI);
  expect(nonUI.ui.setHeader).not.toHaveBeenCalled();
  expect(nonUI.ui.setEditorComponent).not.toHaveBeenCalled();
  const ctx = context();
  ev.fire('session_start', ctx);
  expect(ctx.ui.setWorkingIndicator).toHaveBeenCalledWith({ frames: [] });
  expect(ctx.ui.setWorkingMessage).toHaveBeenCalledWith('working');
  expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalledWith('thinking');
  const factory = vi.mocked(ctx.ui.setHeader).mock.calls[0]?.[0];
  expect(
    factory?.({} as never, ctx.ui.theme)
      .render(NARROW)
      .map(plain),
  ).toEqual(['', ' pi / workspace', '']);
  expect(ctx.ui.setEditorComponent).toHaveBeenCalledOnce();
});

test('chrome replaces its own editor on a new session and leaves another extension editor in place', () => {
  const ev = events();
  chrome(ev.api);
  const ctx = context();
  ev.fire('session_start', ctx);
  const own = vi.mocked(ctx.ui.setEditorComponent).mock.calls[0]?.[0];
  vi.mocked(ctx.ui.getEditorComponent).mockReturnValue(own);
  ev.fire('session_start', ctx);
  expect(ctx.ui.setEditorComponent).toHaveBeenCalledTimes(2);
  vi.mocked(ctx.ui.getEditorComponent).mockReturnValue(() => ({}) as never);
  ev.fire('session_start', ctx);
  expect(ctx.ui.setEditorComponent).toHaveBeenCalledTimes(2);
});

test('user messages get a prompt marker unless they start with Markdown block syntax', () => {
  const ev = events();
  chrome(ev.api);
  expect(vi.mocked(ev.api.registerMarkdownTransformer).mock.calls[0]?.[1]).toEqual({ messageTypes: ['user'] });
  const transform = ev.transformers[0];
  if (!transform) throw new Error('no transformer');
  const run = (markdown: string) => transform(markdown, { messageType: 'user', isStreaming: false, availableWidth: NARROW });
  expect(run('Make the cache refresh cancelable.')).toBe('› Make the cache refresh cancelable.');
  expect(run('Fix it\n\n- then test')).toBe('› Fix it\n\n- then test');
  for (const markdown of ['# Title', '- item', '* item', '+ item', '1. step', '2) step', '> quote', '```ts\ncode\n```', '~~~\ncode', '| a | b |', '    indented code', '\tcode', '  - nested', '', '  \n'])
    expect(run(markdown)).toBe(markdown);
});

test('header keeps the gutter, fits wide text, and invalidates theme cache', () => {
  const theme = stubTheme();
  const header = headerLine(theme, 'workspace 漢字 🙂', 1);
  for (let width = 0; width < HEADER_SWEEP; width++) {
    const lines = header.render(width);
    expect(lines).toHaveLength(HEADER_LINES);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    if (width >= MIN_GUTTER_WIDTH) expect(plain(lines[1] ?? '')).toMatch(/^ \S/);
    if (width >= MIN_GUTTER_WIDTH) expect(visibleWidth(lines[1] ?? '')).toBeLessThanOrEqual(width - 1);
  }
  const count = vi.mocked(theme.fg).mock.calls.length;
  header.render(LAST_HEADER_WIDTH);
  expect(vi.mocked(theme.fg).mock.calls).toHaveLength(count);
  header.invalidate();
  header.render(LAST_HEADER_WIDTH);
  expect(vi.mocked(theme.fg).mock.calls.length).toBeGreaterThan(count);
});

test('footer keeps the same gutter on both sides', () => {
  const provider = dataProvider();
  const footer = snoopFooter(stubTheme(), provider.data, () => snapshot, vi.fn(), 1);
  const line = plain(footer.render(GUTTER_WIDTH)[0] ?? '');
  expect(line.startsWith(' test test')).toBe(true);
  expect(line.endsWith('ctx 18%')).toBe(true);
  expect(visibleWidth(line)).toBe(GUTTER_WIDTH - 1);
  for (let width = MIN_GUTTER_WIDTH; width < HEADER_SWEEP; width++) {
    const fitted = plain(footer.render(width)[0] ?? '');
    expect(fitted.startsWith(' ')).toBe(true);
    expect(visibleWidth(fitted)).toBeLessThanOrEqual(width - 1);
  }
});

test('resolver keeps tool renderers and compacts tools without one', () => {
  let resolver: ToolRendererResolver | undefined;
  const api = {
    registerToolRenderer: (value: ToolRendererResolver) => {
      resolver = value;
    },
  } as ExtensionAPI;
  toolRows(api);
  const own = { renderCall: () => ({ render: () => ['own'], invalidate: vi.fn() }) };
  const ownResult = { renderResult: () => ({ render: () => ['own'], invalidate: vi.fn() }) };
  expect(resolver?.('mcp__custom', () => own)).toBe(own);
  expect(resolver?.('mcp__custom', () => ownResult)).toBe(ownResult);
  for (const native of [undefined, {}]) {
    const row = resolver?.('codemode', () => native);
    expect(row?.renderShell).toBe('self');
    const ctx = { args: { code: 'return 1;' }, state: {}, cwd: PROJECT_PATH, outputPad: 1, isPartial: true, executionStarted: true, isError: false } as unknown as Parameters<NonNullable<NonNullable<typeof row>['renderCall']>>[2];
    expect(plain(row?.renderCall?.(ctx.args, stubTheme(), ctx).render(NARROW)[0] ?? '')).toMatch(/^ • {2}codemode {2}return 1;/);
  }
  expect(resolver?.('read', () => undefined)).toBeUndefined();
  expect(resolver?.('read', () => ({}))?.renderShell).toBe('self');
});
