import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Theme } from '@earendil-works/pi-coding-agent';
import { KeybindingsManager, stripTerminalSequences, TUI_KEYBINDINGS } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import { createPresentationStore } from '../src/state/presentation-store.ts';
import { createUiController } from '../src/ui/install-ui.ts';
import { installWorkingIndicator } from '../src/ui/working-indicator.ts';

const FG_ROLES = [
  'accent',
  'bashMode',
  'border',
  'borderAccent',
  'borderMuted',
  'customMessageLabel',
  'customMessageText',
  'dim',
  'error',
  'mdCode',
  'mdCodeBlock',
  'mdCodeBlockBorder',
  'mdHeading',
  'mdHr',
  'mdLink',
  'mdLinkUrl',
  'mdListBullet',
  'mdQuote',
  'mdQuoteBorder',
  'muted',
  'success',
  'syntaxComment',
  'syntaxFunction',
  'syntaxKeyword',
  'syntaxNumber',
  'syntaxOperator',
  'syntaxPunctuation',
  'syntaxString',
  'syntaxType',
  'syntaxVariable',
  'text',
  'thinkingHigh',
  'thinkingLow',
  'thinkingMax',
  'thinkingMedium',
  'thinkingMinimal',
  'thinkingOff',
  'thinkingText',
  'thinkingXhigh',
  'toolDiffAdded',
  'toolDiffContext',
  'toolDiffRemoved',
  'toolOutput',
  'toolTitle',
  'userMessageText',
  'warning',
];
const BG_ROLES = ['customMessageBg', 'searchMatchBg', 'selectedBg', 'toolErrorBg', 'toolPendingBg', 'toolSuccessBg', 'userMessageBg'];

/** Real Theme built from this package's theme JSON, matching pi's var resolution. */
function makeTheme(overrides: Record<string, string> = {}): Theme {
  const document: { vars: Record<string, string | number>; colors: Record<string, string | number> } = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/tui-skin.json', import.meta.url)), 'utf8'));
  const resolve = (value: string | number): string | number => (typeof value === 'string' && value.length > 0 && !value.startsWith('#') ? (document.vars[value] ?? value) : value);
  const fg = Object.fromEntries(FG_ROLES.map((role) => [role, overrides[role] ?? resolve(document.colors[role] ?? '')]));
  const bg = Object.fromEntries(BG_ROLES.map((role) => [role, resolve(document.colors[role] ?? '')]));
  return new Theme(fg as never, bg as never, 'truecolor', { name: 'tui-skin' });
}

type UiCall = { method: string; args: unknown[] };

const UI_METHODS = ['setTitle', 'setTheme', 'setHeader', 'setFooter', 'setEditorComponent', 'setWidget', 'setWorkingIndicator', 'setWorkingMessage', 'setWorkingVisible', 'setHiddenThinkingLabel'];

const INSTALL_METHODS = ['setTheme', 'setHeader', 'setFooter', 'setEditorComponent', 'setWorkingIndicator', 'setWorkingMessage', 'setWidget', 'setHiddenThinkingLabel'];
const UNINSTALL_METHODS = ['setWidget', 'setEditorComponent', 'setFooter', 'setHeader', 'setWorkingMessage', 'setWorkingIndicator', 'setWorkingVisible', 'setHiddenThinkingLabel'];

function fakeContext(mode: string) {
  const calls: UiCall[] = [];
  const failures = new Map<string, string>();
  const ui: Record<string, unknown> = { theme: makeTheme() };
  for (const method of UI_METHODS) {
    ui[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      const failure = failures.get(method);
      if (failure !== undefined) throw new Error(failure);
    };
  }
  const ctx = {
    mode,
    cwd: '/home/u/proj',
    thinkingLevel: 'high',
    model: { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'openai' },
    getContextUsage: () => ({ tokens: 16000, contextWindow: 200000, percent: 8 }),
    ui,
  } as never;
  const failOn = (method: string, message: string): void => {
    failures.set(method, message);
  };
  return { ctx, calls, failOn };
}

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function callsFor(calls: readonly UiCall[], method: string): UiCall[] {
  return calls.filter((call) => call.method === method);
}

function factoryFor(calls: readonly UiCall[], method: string): (...args: unknown[]) => unknown {
  const call = callsFor(calls, method)[0];
  if (call === undefined) throw new Error(`${method} was not recorded`);
  return call.args[0] as (...args: unknown[]) => unknown;
}

function buildEditor(calls: readonly UiCall[]): { render(width: number): string[] } {
  const build = factoryFor(calls, 'setEditorComponent');
  return build(fakeTui(), { borderColor: (text: string) => text }, new KeybindingsManager(TUI_KEYBINDINGS as never)) as { render(width: number): string[] };
}

function setTheme(ctx: unknown, theme: Theme): void {
  (ctx as { ui: { theme: Theme } }).ui.theme = theme;
}

function fakeTui() {
  return { requestRender: vi.fn(), terminal: { rows: 40, columns: 120 } };
}

describe('install-ui controller', () => {
  test('installs nothing outside tui mode', () => {
    for (const mode of ['print', 'rpc', 'json']) {
      const { ctx, calls } = fakeContext(mode);
      const controller = createUiController(createPresentationStore());
      controller.install(ctx);
      controller.uninstall(ctx);
      expect(calls.length).toBe(0);
    }
  });

  test('installs each replacement once in order', () => {
    const { ctx, calls } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);

    expect(calls.map((call) => call.method)).toEqual(INSTALL_METHODS);
    expect(callsFor(calls, 'setTitle')).toEqual([]);
    expect(callsFor(calls, 'setTheme')[0]?.args).toEqual(['tui-skin']);
    expect(callsFor(calls, 'setHiddenThinkingLabel')[0]?.args).toEqual(['Thinking']);
    const widget = callsFor(calls, 'setWidget')[0];
    expect(widget?.args[0]).toBe('tui-skin.activity');
    expect(widget?.args[2]).toEqual({ placement: 'aboveEditor' });
  });

  test('ignores a second install in tui mode', () => {
    const { ctx, calls } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);
    controller.install(ctx);

    expect(calls.length).toBe(INSTALL_METHODS.length);
  });

  test('restores each replacement in reverse order', () => {
    const { ctx, calls } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);
    controller.uninstall(ctx);

    expect(calls.map((call) => call.method)).toEqual([...INSTALL_METHODS, ...UNINSTALL_METHODS]);
    expect(callsFor(calls, 'setWorkingVisible').at(-1)?.args).toEqual([true]);
    expect(callsFor(calls, 'setWidget').at(-1)?.args).toEqual(['tui-skin.activity', undefined]);
    expect(callsFor(calls, 'setWorkingMessage').at(-1)?.args).toEqual([]);
  });
});

describe('install-ui controller removal failures', () => {
  test('a failing step lets later steps run, then one error names each failure', ({ onTestFinished }) => {
    const consoleError = vi.spyOn(console, 'error');
    onTestFinished(() => consoleError.mockRestore());
    const { ctx, calls, failOn } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);
    const installedCalls = calls.length;
    failOn('setFooter', 'footer boom');
    failOn('setWorkingMessage', 'message boom');

    const failure = thrownBy(() => controller.uninstall(ctx));

    expect(calls.slice(installedCalls).map((call) => call.method)).toEqual(UNINSTALL_METHODS);
    expect(failure).toBeInstanceOf(AggregateError);
    const aggregate = failure as AggregateError;
    expect(aggregate.message).toBe('tui-skin presentation cleanup failed: setFooter: footer boom; setWorkingMessage: message boom');
    expect(aggregate.errors.map((error: Error) => error.message)).toEqual(['footer boom', 'message boom']);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('a failed removal still counts as removed, so a repeat does nothing', () => {
    const { ctx, calls, failOn } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);
    failOn('setHeader', 'header boom');
    thrownBy(() => controller.uninstall(ctx));
    const afterFailure = calls.length;

    controller.uninstall(ctx);

    expect(calls.length).toBe(afterFailure);
  });

  test('a removal that fails with a non-Error value reports its text', () => {
    const { ctx } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);
    (ctx as unknown as { ui: { setHeader(): void } }).ui.setHeader = () => {
      throw 'plain text';
    };

    const failure = thrownBy(() => controller.uninstall(ctx)) as AggregateError;

    expect(failure.message).toBe('tui-skin presentation cleanup failed: setHeader: plain text');
  });
});

describe('install-ui controller removal, rendering', () => {
  test('ignores a repeated or never-installed removal', () => {
    const { ctx, calls } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());

    controller.uninstall(ctx);
    expect(calls.length).toBe(0);

    controller.install(ctx);
    controller.uninstall(ctx);
    controller.uninstall(ctx);
    expect(calls.length).toBe(INSTALL_METHODS.length + UNINSTALL_METHODS.length);
  });

  test('requests a render until uninstalled', () => {
    const store = createPresentationStore();
    const { ctx, calls } = fakeContext('tui');
    const controller = createUiController(store);
    controller.install(ctx);

    const tui = fakeTui();
    factoryFor(calls, 'setHeader')(tui, makeTheme());
    store.setAgentRunning(1);
    expect(tui.requestRender.mock.calls.length).toBe(1);

    controller.uninstall(ctx);
    store.setAgentRunning(2);
    expect(tui.requestRender.mock.calls.length).toBe(1);
  });

  test('installs the working frames when called directly', () => {
    const { ctx, calls } = fakeContext('tui');
    installWorkingIndicator(ctx);

    const indicator = callsFor(calls, 'setWorkingIndicator')[0]?.args[0] as { frames: string[]; intervalMs: number };
    expect(indicator.intervalMs).toBe(120);
    expect(indicator.frames.map((frame) => stripTerminalSequences(frame))).toEqual(['·', '•', '●', '•']);
    // biome-ignore lint/security/noSecrets: the escape a terminal shows for the theme's success role
    expect(indicator.frames[2]).toBe('\u001b[38;2;62;208;122m●\u001b[39m');
    expect(callsFor(calls, 'setWorkingMessage')[0]?.args).toEqual(['Working']);
  });
});

describe('install-ui controller working frames on render', () => {
  test('a render with an unchanged theme leaves the frames alone', () => {
    const { ctx, calls } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);
    const editor = buildEditor(calls);

    editor.render(60);
    editor.render(60);

    expect(callsFor(calls, 'setWorkingIndicator').length).toBe(1);
  });

  test('a render after a theme change re-derives the working frames', () => {
    const { ctx, calls } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);
    const editor = buildEditor(calls);

    const odd = makeTheme({ success: '#8cc265' });
    setTheme(ctx, odd);
    editor.render(60);

    const installed = callsFor(calls, 'setWorkingIndicator');
    expect(installed.length).toBe(2);
    const reinstalled = installed[1];
    if (reinstalled === undefined) throw new Error('the frames were not reinstalled');
    const frames = (reinstalled.args[0] as { frames: string[] }).frames;
    // biome-ignore lint/security/noSecrets: the escape a terminal shows for the switched theme's success role
    expect(frames[2]).toBe('\u001b[38;2;140;194;101m●\u001b[39m');
    expect(frames[0]).toBe(odd.fg('dim', '·'));
  });

  test('a render after uninstall does not reinstate the working frames', () => {
    const { ctx, calls } = fakeContext('tui');
    const controller = createUiController(createPresentationStore());
    controller.install(ctx);
    const editor = buildEditor(calls);

    controller.uninstall(ctx);
    setTheme(ctx, makeTheme({ success: '#8cc265' }));
    editor.render(60);

    expect(callsFor(calls, 'setWorkingIndicator').length).toBe(2);
    const reset = callsFor(calls, 'setWorkingIndicator')[1];
    expect(reset?.args).toEqual([]);
  });
});
