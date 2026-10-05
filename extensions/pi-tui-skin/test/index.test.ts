import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import tuiSkin from '../src/index.ts';

type Handler = (event: unknown, ctx: unknown) => void;

function fakePi() {
  const tools: string[] = [];
  const handlers = new Map<string, Handler>();
  const pi = {
    registerToolRenderer: vi.fn(),
    registerTool: (definition: { name: string }) => {
      tools.push(definition.name);
    },
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
      return () => {};
    },
  } as unknown as ExtensionAPI;
  return { pi, tools, handlers };
}

function fakeUi() {
  return {
    theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
    setTitle: vi.fn(),
    setTheme: vi.fn(),
    setHeader: vi.fn(),
    setFooter: vi.fn(),
    setEditorComponent: vi.fn(),
    setWidget: vi.fn(),
    setWorkingIndicator: vi.fn(),
    setWorkingMessage: vi.fn(),
    setHiddenThinkingLabel: vi.fn(),
    setWorkingVisible: vi.fn(),
  };
}

function sessionContext(mode: 'tui' | 'print', hasUI = mode === 'tui') {
  const ui = { ...fakeUi(), notify: vi.fn() };
  const ctx = { mode, hasUI, cwd: '/tmp/workspace', ui, thinkingLevel: 'medium', model: undefined, getContextUsage: () => undefined };
  return { ctx, ui };
}

const themeStub = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const footerDataStub = { getGitBranch: () => 'main', onBranchChange: () => () => {} };

describe('tui-skin extension entry point', () => {
  test('registers the default renderers and every lifecycle event it reads', () => {
    const { pi, tools, handlers } = fakePi();
    tuiSkin(pi);

    expect(tools).toEqual([]);
    expect(pi.registerToolRenderer).toHaveBeenCalledOnce();
    expect([...handlers.keys()].sort()).toEqual(['agent_settled', 'agent_start', 'model_select', 'session_shutdown', 'session_start', 'thinking_level_select', 'tool_execution_end', 'tool_execution_start']);
  });

  test('a print-mode session leaves presentation unchanged', () => {
    const { pi, handlers } = fakePi();
    tuiSkin(pi);
    const printed = sessionContext('print');

    handlers.get('session_start')?.({}, printed.ctx);

    expect(printed.ui.setHeader.mock.calls).toEqual([]);
    expect(printed.ui.setWidget.mock.calls).toEqual([]);
    expect([...handlers.keys()]).toContain('session_start');
  });

  test('a TUI session installs the header', () => {
    const { pi, handlers } = fakePi();
    tuiSkin(pi);
    const tui = sessionContext('tui');
    handlers.get('session_start')?.({}, tui.ctx);
    const headerFactory = tui.ui.setHeader.mock.calls[0]?.[0] as ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
    if (headerFactory === undefined) throw new Error('no header factory was installed');
    const lines = headerFactory({}, themeStub).render(40);
    const plain = lines.map((line) => stripTerminalSequences(line).trimEnd());
    expect(plain).toHaveLength(3);
    expect(plain[0]).toBe('  Pi Coding Agent');
    expect(plain[1]).toMatch(/^ {2}v\S+$/);
    expect(plain[2]).toMatch(/^ {2}Tip: \S/);
  });
});

describe('tui-skin extension chrome lifecycle', () => {
  test('a TUI session installs chrome and shutdown restores every setter', () => {
    const { pi, handlers } = fakePi();
    tuiSkin(pi);
    const { ctx, ui } = sessionContext('tui');

    handlers.get('session_start')?.({}, ctx);
    expect(ui.setTitle).toHaveBeenCalledWith('agent');
    expect(ui.setTheme).toHaveBeenCalledWith('tui-skin');
    expect(ui.setHeader).toHaveBeenCalledTimes(1);
    expect(ui.setFooter).toHaveBeenCalledTimes(1);
    expect(ui.setEditorComponent).toHaveBeenCalledTimes(1);
    expect(ui.setWidget).toHaveBeenCalledTimes(1);
    expect(ui.setWorkingIndicator).toHaveBeenCalledTimes(1);
    expect(ui.setWorkingMessage).toHaveBeenCalledWith('Working');
    expect(ui.setHiddenThinkingLabel).toHaveBeenCalledWith('Thinking');

    handlers.get('session_shutdown')?.({}, ctx);
    expect(ui.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(ui.setFooter).toHaveBeenLastCalledWith(undefined);
    expect(ui.setEditorComponent).toHaveBeenLastCalledWith(undefined);
    expect(ui.setWidget).toHaveBeenLastCalledWith('tui-skin.activity', undefined);
    expect(ui.setWorkingMessage).toHaveBeenLastCalledWith();
    expect(ui.setWorkingIndicator).toHaveBeenLastCalledWith();
    expect(ui.setHiddenThinkingLabel).toHaveBeenLastCalledWith();
  });

  test('a second session_start keeps the installed chrome working', () => {
    const { pi, handlers } = fakePi();
    tuiSkin(pi);
    const { ctx, ui } = sessionContext('tui');

    handlers.get('session_start')?.({}, ctx);
    handlers.get('session_start')?.({}, ctx);

    expect(ui.setHeader).toHaveBeenCalledTimes(1);
    const footerFactory = ui.setFooter.mock.calls[0]?.[0] as ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
    if (footerFactory === undefined) throw new Error('no footer factory was installed');
    const lines = footerFactory({ requestRender: () => {} }, themeStub, footerDataStub).render(80);
    expect(stripTerminalSequences(lines[1] ?? '').trimEnd()).toBe('  /tmp/workspace · main');
  });
});

test('tui-skin clears activity when chrome restoration fails', ({ onTestFinished }) => {
  const consoleError = vi.spyOn(console, 'error');
  onTestFinished(() => consoleError.mockRestore());
  const { pi, handlers } = fakePi();
  tuiSkin(pi);
  const { ctx, ui } = sessionContext('tui');
  handlers.get('session_start')?.({}, ctx);
  const widgetFactory = ui.setWidget.mock.calls[0]?.[1] as ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
  if (widgetFactory === undefined) throw new Error('no activity widget was installed');
  const widget = widgetFactory({ requestRender: () => {} }, themeStub);
  handlers.get('tool_execution_start')?.({ toolCallId: 'a', toolName: 'read', args: { path: '/tmp/a.ts' } }, ctx);
  expect(widget.render(80)).toHaveLength(1);

  ui.setFooter.mockImplementation(() => {
    throw new Error('footer boom');
  });
  expect(() => handlers.get('session_shutdown')?.({}, ctx)).toThrow('footer boom');

  expect(widget.render(80)).toEqual([]);
  expect(consoleError.mock.calls).toEqual([]);
});

describe('tui-skin extension footer rows', () => {
  test('the mode row appears only after the thinking level moves off its starting value', () => {
    const { pi, handlers } = fakePi();
    tuiSkin(pi);
    const { ctx, ui } = sessionContext('tui');
    handlers.get('session_start')?.({}, ctx);

    const footerFactory = ui.setFooter.mock.calls[0]?.[0] as ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
    if (footerFactory === undefined) throw new Error('no footer factory was installed');
    const footer = footerFactory({ requestRender: () => {} }, themeStub, footerDataStub);
    expect(footer.render(80)).toHaveLength(2);

    ctx.thinkingLevel = 'max';
    const rows = footer.render(80).map((line) => stripTerminalSequences(line).trimEnd());
    expect(rows[0]).toBe('  Max (shift+tab to cycle)');
    expect(rows[2]).toBe('  /tmp/workspace · main');
  });

  test('an edit tool finishing leaves the footer rows unchanged', () => {
    const { pi, handlers } = fakePi();
    tuiSkin(pi);
    const { ctx, ui } = sessionContext('tui');
    handlers.get('session_start')?.({}, ctx);

    handlers.get('agent_start')?.({}, ctx);
    handlers.get('tool_execution_start')?.({ toolCallId: 'a', toolName: 'edit', args: { path: 'note.txt' } }, ctx);
    handlers.get('tool_execution_end')?.({ toolCallId: 'a', toolName: 'edit', isError: false }, ctx);
    handlers.get('agent_settled')?.({}, ctx);

    const footerFactory = ui.setFooter.mock.calls[0]?.[0] as ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
    if (footerFactory === undefined) throw new Error('no footer factory was installed');
    const lines = footerFactory({ requestRender: () => {} }, themeStub, footerDataStub).render(80);
    expect(lines).toHaveLength(2);
    expect(stripTerminalSequences(lines[1] ?? '')).not.toContain('edited');
  });
});
