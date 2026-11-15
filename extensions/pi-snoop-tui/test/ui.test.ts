import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, ToolRendererResolver } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { expect, test, vi } from 'vitest';
import chrome, { HeaderLine } from '../src/chrome.ts';
import footer, { type FooterSnapshot, fitSegments, readSnapshot, SEGMENT_ORDER, SnoopFooter, sameSnapshot, statusText } from '../src/footer.ts';
import toolRows from '../src/tool-rows.ts';
import { plain, stubTheme } from './harness.ts';

function events() {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
  const api = { on: vi.fn((name: string, handler: (event: unknown, ctx: ExtensionContext) => void) => handlers.set(name, handler)), getThinkingLevel: () => 'medium' } as unknown as ExtensionAPI;
  return {
    api,
    fire(name: string, ctx: ExtensionContext) {
      const handler = handlers.get(name);
      expect(handler).toBeDefined();
      handler?.({}, ctx);
    },
  };
}
function context(hasUI = true) {
  return {
    hasUI,
    cwd: '/project/workspace',
    model: { id: 'model', reasoning: true },
    getContextUsage: vi.fn(() => ({ percent: 18 })),
    ui: { theme: stubTheme(), setFooter: vi.fn(), setHeader: vi.fn(), setWorkingIndicator: vi.fn() },
  } as unknown as ExtensionContext;
}
function dataProvider() {
  let branch: string | null = 'main';
  const statuses = new Map<string, string>();
  const data: ReadonlyFooterDataProvider = { getGitBranch: () => branch, getExtensionStatuses: () => statuses, getAvailableProviderCount: () => 1, onBranchChange: () => () => {} };
  return {
    data,
    statuses,
    branch(value: string | null) {
      branch = value;
    },
  };
}
const snapshot: FooterSnapshot = { workspace: 'workspace漢字🙂', model: 'model', thinking: 'medium', ctxPercent: 18 };

test('fits footer segments in priority order without wrapping', () => {
  const texts = { workspace: 'workspace漢字🙂', branch: 'long-branch-name', statuses: 'status text 漢字🙂', model: 'model-name', thinking: 'medium', ctx: 'ctx 18%' };
  const segments = SEGMENT_ORDER.map((s) => ({ ...s, text: texts[s.id] }));
  const theme = stubTheme();
  const provider = dataProvider();
  provider.statuses.set('test', texts.statuses);
  const footer = new SnoopFooter(
    theme,
    provider.data,
    () => snapshot,
    () => {},
  );
  for (let width = 0; width < 160; width++) {
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
  const footer = new SnoopFooter(theme, provider.data, () => current, disposed);
  const first = footer.render(120);
  const count = vi.mocked(theme.fg).mock.calls.length;
  expect(footer.render(120)).toEqual(first);
  expect(vi.mocked(theme.fg).mock.calls).toHaveLength(count);
  provider.branch('feature');
  expect(plain(footer.render(120)[0] ?? '')).toContain('feature');
  provider.statuses.set('task', '\x1b[31mworking\nnext');
  expect(plain(footer.render(120)[0] ?? '')).toContain('working next');
  footer.invalidate();
  footer.render(120);
  expect(vi.mocked(theme.fg).mock.calls.length).toBeGreaterThan(count);
  for (const [ctxPercent, color] of [
    [null, 'dim'],
    [71, 'warning'],
    [91, 'error'],
  ] as const) {
    current = { ...snapshot, ctxPercent };
    footer.render(120);
    expect(theme.fg).toHaveBeenCalledWith(color, ctxPercent === null ? 'ctx ?' : `ctx ${ctxPercent}%`);
  }
  current = undefined;
  provider.branch(null);
  provider.statuses.clear();
  expect(plain(footer.render(120)[0] ?? '')).toBe('ctx ?');
  footer.dispose();
  expect(disposed).toHaveBeenCalledOnce();
});

test('snapshots omit thinking on non-reasoning models and tolerate unknown usage', () => {
  const ctx = context();
  expect(readSnapshot(ctx, 'medium')).toEqual({ workspace: 'workspace', model: 'model', thinking: 'medium', ctxPercent: 18 });
  const empty = readSnapshot({ cwd: '/', model: undefined, getContextUsage: () => undefined }, 'off');
  expect(empty).toEqual({ workspace: '/', model: undefined, thinking: undefined, ctxPercent: null });
  expect(sameSnapshot(snapshot, { ...snapshot })).toBe(true);
  for (const difference of [{ workspace: 'other' }, { model: 'other' }, { thinking: 'off' as const }, { ctxPercent: null }]) expect(sameSnapshot(snapshot, { ...snapshot, ...difference })).toBe(false);
  expect(
    statusText(
      new Map([
        ['z', 'last\nline'],
        ['a', '\x1b[31mfirst'],
        ['b', '  '],
      ]),
    ),
  ).toBe('first · last line');
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

test('chrome is UI-only and resets its static indicator on each agent start', () => {
  const ev = events();
  chrome(ev.api);
  const nonUI = context(false);
  ev.fire('session_start', nonUI);
  ev.fire('agent_start', nonUI);
  expect(nonUI.ui.setHeader).not.toHaveBeenCalled();
  expect(nonUI.ui.setWorkingIndicator).not.toHaveBeenCalled();
  const ctx = context();
  ev.fire('session_start', ctx);
  ev.fire('agent_start', ctx);
  expect(ctx.ui.setWorkingIndicator).toHaveBeenCalledTimes(2);
  expect(vi.mocked(ctx.ui.setWorkingIndicator).mock.calls[0]?.[0]?.frames).toHaveLength(1);
  const factory = vi.mocked(ctx.ui.setHeader).mock.calls[0]?.[0];
  expect(
    factory?.({} as never, ctx.ui.theme)
      .render(80)
      .map(plain),
  ).toEqual(['pi / workspace']);
});

test('header fits wide text and invalidates theme cache', () => {
  const theme = stubTheme();
  const header = new HeaderLine(theme, 'workspace 漢字 🙂');
  for (let width = 0; width < 120; width++) expect(visibleWidth(header.render(width)[0] ?? '')).toBeLessThanOrEqual(width);
  const count = vi.mocked(theme.fg).mock.calls.length;
  header.render(119);
  expect(vi.mocked(theme.fg).mock.calls).toHaveLength(count);
  header.invalidate();
  header.render(119);
  expect(vi.mocked(theme.fg).mock.calls.length).toBeGreaterThan(count);
});

test('resolver preserves unknown tools and absent native renderers', () => {
  let resolver: ToolRendererResolver | undefined;
  const api = {
    registerToolRenderer: (value: ToolRendererResolver) => {
      resolver = value;
    },
  } as ExtensionAPI;
  toolRows(api);
  const native = {};
  expect(resolver?.('mcp__custom', () => native)).toBe(native);
  expect(resolver?.('read', () => undefined)).toBeUndefined();
  expect(resolver?.('read', () => native)?.renderShell).toBe('self');
});
