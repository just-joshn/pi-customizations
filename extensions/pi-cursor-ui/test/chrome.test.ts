import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ExtensionContext, ReadonlyFooterDataProvider } from '@earendil-works/pi-coding-agent';
import { Theme } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import { createPresentationStore } from '../src/state/presentation-store.ts';
import { createFooter } from '../src/ui/footer.ts';
import { createHeader } from '../src/ui/header.ts';

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
function makeTheme(): Theme {
  const document: { vars: Record<string, string | number>; colors: Record<string, string | number> } = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/cursor-ui.json', import.meta.url)), 'utf8'));
  const resolve = (value: string | number): string | number => (typeof value === 'string' && value.length > 0 && !value.startsWith('#') ? (document.vars[value] ?? value) : value);
  const fg = Object.fromEntries(FG_ROLES.map((role) => [role, resolve(document.colors[role] ?? '')]));
  const bg = Object.fromEntries(BG_ROLES.map((role) => [role, resolve(document.colors[role] ?? '')]));
  return new Theme(fg as never, bg as never, 'truecolor', { name: 'cursor-ui' });
}

function footerContext(): ExtensionContext {
  return {
    cwd: '/home/u/proj',
    model: { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'openai' },
    thinkingLevel: 'high',
    getContextUsage: () => ({ tokens: 16000, contextWindow: 200000, percent: 8 }),
    ui: { theme: makeTheme() },
  } as never;
}

function footerData(branch: string | null): ReadonlyFooterDataProvider {
  return { getGitBranch: () => branch, onBranchChange: () => () => {} } as never;
}

function storeWithOneEdit(): ReturnType<typeof createPresentationStore> {
  const store = createPresentationStore();
  store.startTool({ toolCallId: 'a', toolName: 'edit', args: { path: 'src/a.ts' }, startedAt: 1 });
  store.finishTool({ toolCallId: 'a', toolName: 'edit', isError: false, finishedAt: 2 });
  return store;
}

function headerFor(cwd: string): ReturnType<ReturnType<typeof createHeader>> {
  return createHeader({ cwd } as never)({} as never, makeTheme());
}

describe('header', () => {
  test('renders the startup block', () => {
    vi.stubEnv('HOME', '/home/u');
    const header = headerFor('/home/u/proj');
    const lines = header.render(80);
    expect(lines.length).toBe(3);
    expect(stripTerminalSequences(lines[0] ?? '')).toBe('> agent');
    expect(stripTerminalSequences(lines[1] ?? '')).toBe('Pi Coding Agent');
    expect(stripTerminalSequences(lines[2] ?? '')).toBe('~/proj');
  });

  test('fits a long directory into a narrow width', () => {
    vi.stubEnv('HOME', '/home/u');
    const header = headerFor('/home/u/very/long/project/directory');
    const lines = header.render(20);
    expect(stripTerminalSequences(lines[2] ?? '')).toBe('~/very/long/project…');
    expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
  });
});

describe('footer', () => {
  test('renders the three footer lines', () => {
    vi.stubEnv('HOME', '/home/u');
    const store = storeWithOneEdit();
    const footer = createFooter(footerContext(), store)({ requestRender: () => {} } as never, makeTheme(), footerData('main'));
    const lines = footer.render(80);
    expect(lines.length).toBe(3);
    expect(stripTerminalSequences(lines[0] ?? '')).toBe('  High (shift+tab to cycle)');
    expect(stripTerminalSequences(lines[1] ?? '')).toBe('  GPT-6 Sol · 8% · 1 file edited');
    expect(stripTerminalSequences(lines[2] ?? '')).toBe('  ~/proj · main');
  });

  test('omits the thinking label when the level is unknown', () => {
    const store = createPresentationStore();
    const ctx = { ...footerContext(), thinkingLevel: undefined } as never;
    const footer = createFooter(ctx, store)({ requestRender: () => {} } as never, makeTheme(), footerData(null));
    expect(stripTerminalSequences(footer.render(80)[0] ?? '')).toBe('  ');
  });

  test('stops requesting renders after dispose', () => {
    const store = createPresentationStore();
    const requests = vi.fn();
    const footer = createFooter(footerContext(), store)({ requestRender: requests } as never, makeTheme(), footerData('main'));
    footer.dispose();
    footer.dispose();
    store.setAgentRunning(1);
    expect(requests.mock.calls.length).toBe(0);
  });

  test('omits every optional footer segment', () => {
    vi.stubEnv('HOME', '/home/u');
    const ctx = { cwd: '/home/u/proj', model: undefined, thinkingLevel: undefined, getContextUsage: () => undefined, ui: { theme: makeTheme() } } as never;
    const footer = createFooter(ctx, createPresentationStore())({ requestRender: () => {} } as never, makeTheme(), footerData(null));

    const lines = footer.render(80);
    expect(stripTerminalSequences(lines[0] ?? '')).toBe('  ');
    expect(stripTerminalSequences(lines[1] ?? '')).toBe('  ');
    expect(stripTerminalSequences(lines[2] ?? '')).toBe('  ~/proj');
  });

  test('uses the model id with a plural edit count', () => {
    vi.stubEnv('HOME', '/home/u');
    const store = createPresentationStore();
    store.startTool({ toolCallId: 'a', toolName: 'edit', args: { path: 'src/a.ts' }, startedAt: 1 });
    store.finishTool({ toolCallId: 'a', toolName: 'edit', isError: false, finishedAt: 2 });
    store.startTool({ toolCallId: 'b', toolName: 'edit', args: { path: 'src/b.ts' }, startedAt: 3 });
    store.finishTool({ toolCallId: 'b', toolName: 'edit', isError: false, finishedAt: 4 });
    const ctx = { ...footerContext(), model: { id: 'gpt-6-sol', provider: 'openai' } } as never;

    const footer = createFooter(ctx, store)({ requestRender: () => {} } as never, makeTheme(), footerData('main'));
    expect(stripTerminalSequences(footer.render(80)[1] ?? '')).toBe('  gpt-6-sol · 8% · 2 files edited');
  });

  test('survives a deactivated session runtime', () => {
    vi.stubEnv('HOME', '/home/u');
    const deactivated = () => {
      throw new Error('session runtime is gone');
    };
    const ctx = {
      cwd: '/home/u/proj',
      get thinkingLevel() {
        return deactivated();
      },
      get model() {
        return deactivated();
      },
      getContextUsage: deactivated,
      ui: { theme: makeTheme() },
    } as never;

    const footer = createFooter(ctx, createPresentationStore())({ requestRender: () => {} } as never, makeTheme(), footerData(null));
    const lines = footer.render(80);
    expect(stripTerminalSequences(lines[0] ?? '')).toBe('  ');
    expect(stripTerminalSequences(lines[1] ?? '')).toBe('  ');
    expect(stripTerminalSequences(lines[2] ?? '')).toBe('  ~/proj');
  });

  test('requests a render from both subscriptions', () => {
    const store = createPresentationStore();
    const requests = vi.fn();
    let branchListener: () => void = () => {};
    const provider = {
      getGitBranch: () => 'main',
      onBranchChange: (listener: () => void) => {
        branchListener = listener;
        return () => {};
      },
    } as never;
    const footer = createFooter(footerContext(), store)({ requestRender: requests } as never, makeTheme(), provider);

    branchListener();
    expect(requests.mock.calls.length).toBe(1);
    store.setAgentRunning(1);
    expect(requests.mock.calls.length).toBe(2);
    footer.dispose();
  });
});
