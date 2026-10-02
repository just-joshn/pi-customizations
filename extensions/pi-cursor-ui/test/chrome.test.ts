import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ExtensionContext, ReadonlyFooterDataProvider } from '@earendil-works/pi-coding-agent';
import { Theme } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import { createPresentationStore } from '../src/state/presentation-store.ts';
import { createFooter } from '../src/ui/footer.ts';
import { createHeader, TIPS } from '../src/ui/header.ts';

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

function footerContext(level: ThinkingLevel | undefined = 'high'): ExtensionContext {
  return {
    cwd: '/home/u/proj',
    model: { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'openai' },
    thinkingLevel: level,
    getContextUsage: () => ({ tokens: 16000, contextWindow: 200000, percent: 8 }),
    ui: { theme: makeTheme() },
  } as never;
}

/** A context whose thinking level can change after the footer captures its starting level. */
function mutableLevelContext(): { ctx: ExtensionContext; set(level: ThinkingLevel): void } {
  let level: ThinkingLevel = 'high';
  const base = footerContext();
  const ctx = {
    ...base,
    get thinkingLevel() {
      return level;
    },
  } as never;
  return {
    ctx,
    set: (next) => {
      level = next;
    },
  };
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

/** The banner the installed reference prints: title, build, and one tip, indented two columns. */
const REFERENCE_IDLE_BANNER = readFileSync(fileURLToPath(new URL('../reference/cursor-agent-2026.09.28-64d2043/01-idle.txt', import.meta.url)), 'utf8').split('\n');

/** Read pi's version from its own installed manifest, not from the constant the code under test uses. */
function installedPiVersion(): string {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url)), 'utf8')) as { version: string };
  return manifest.version;
}

describe('header', () => {
  test('renders the reference banner shape', () => {
    vi.stubEnv('HOME', '/home/u');
    // The reference frame is the spec, so assert its own shape before the match.
    expect(REFERENCE_IDLE_BANNER[0]).toBe('  Cursor Agent');
    expect(REFERENCE_IDLE_BANNER[1]).toMatch(/^ {2}v\d/);
    expect(REFERENCE_IDLE_BANNER[2]).toMatch(/^ {2}Tip: \S/);

    const plain = headerFor('/home/u/proj')
      .render(80)
      .map((line) => stripTerminalSequences(line));
    expect(plain).toHaveLength(3);
    expect(plain[0]).toBe('  Pi Coding Agent');
    expect(plain[1]).toBe(`  v${installedPiVersion()}`);
    expect(TIPS.map((tip) => `  Tip: ${tip}`)).toContain(plain[2]);
  });

  test('drops the old `> agent` and working-directory rows', () => {
    vi.stubEnv('HOME', '/home/u');
    const plain = headerFor('/home/u/proj')
      .render(80)
      .map((line) => stripTerminalSequences(line));
    expect(plain.some((line) => line.includes('> agent'))).toBe(false);
    expect(plain.some((line) => line.includes('~/proj'))).toBe(false);
  });

  test('keeps the banner indent from the reference at a narrow width', () => {
    const lines = headerFor('/home/u/very/long/project/directory').render(20);
    expect(stripTerminalSequences(lines[0] ?? '').startsWith('  ')).toBe(true);
    expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
  });
});

describe('footer', () => {
  test('hides the mode row until the thinking level leaves the session default', () => {
    vi.stubEnv('HOME', '/home/u');
    const { ctx, set } = mutableLevelContext();
    const footer = createFooter(ctx, createPresentationStore())({ requestRender: () => {} } as never, makeTheme(), footerData('main'));

    expect(footer.render(80).map(stripTerminalSequences)).toEqual(['  GPT-6 Sol · 8%', '  ~/proj · main']);

    set('max');
    expect(footer.render(80).map(stripTerminalSequences)).toEqual(['  Max (shift+tab to cycle)', '  GPT-6 Sol · 8%', '  ~/proj · main']);
  });

  test('hides the context percentage while context is unused', () => {
    vi.stubEnv('HOME', '/home/u');
    const ctx = { ...footerContext(), getContextUsage: () => ({ tokens: 0, contextWindow: 200000, percent: 0 }) } as never;
    const footer = createFooter(ctx, createPresentationStore())({ requestRender: () => {} } as never, makeTheme(), footerData(null));
    expect(stripTerminalSequences(footer.render(80)[0] ?? '')).toBe('  GPT-6 Sol');
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
    expect(footer.render(80).map(stripTerminalSequences)).toEqual(['  ', '  ~/proj']);
  });

  test('uses the model id when the model has no display name', () => {
    vi.stubEnv('HOME', '/home/u');
    const ctx = { ...footerContext(), model: { id: 'gpt-6-sol', provider: 'openai' } } as never;
    const footer = createFooter(ctx, storeWithOneEdit())({ requestRender: () => {} } as never, makeTheme(), footerData('main'));
    expect(stripTerminalSequences(footer.render(80)[0] ?? '')).toBe('  gpt-6-sol · 8%');
  });
});

describe('footer with missing or unusual inputs', () => {
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
    expect(footer.render(80).map(stripTerminalSequences)).toEqual(['  ', '  ~/proj']);
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
