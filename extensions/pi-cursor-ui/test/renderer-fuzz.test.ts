/**
 * Renderer fuzz: every exported call/result renderer and every width-taking UI
 * component is swept across a terminal-width ladder for a matrix of untrusted
 * inputs. Each combination asserts that rendering cannot throw, returns
 * `string[]`, stays within the terminal width, is deterministic, does not
 * accumulate rows, and never leaks `undefined`/`NaN`/`[object Object]`.
 *
 * The one proven overflow is a pi-tui `Text` limitation: a 2-cell grapheme
 * (CJK/emoji) rendered into a 1-column terminal wraps to a 2-cell line. That
 * combination is documented by `test.fails` at the bottom of this file and is
 * excluded from the passing sweep so a regression cannot hide behind it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ExtensionContext, ReadonlyFooterDataProvider, Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import { Theme as ThemeClass } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import { createPresentationStore } from '../src/state/presentation-store.ts';
import { renderEditCall, renderEditResult } from '../src/tools/render-edit.ts';
import { renderFindCall, renderFindResult } from '../src/tools/render-find.ts';
import { renderGrepCall, renderGrepResult } from '../src/tools/render-grep.ts';
import { renderLsCall, renderLsResult } from '../src/tools/render-ls.ts';
import { renderReadCall, renderReadResult } from '../src/tools/render-read.ts';
import type { ToolResultLike, ToolRowContext } from '../src/tools/render-shell.ts';
import { renderBashCall, renderBashResult, renderPowerShellCall, renderPowerShellResult } from '../src/tools/render-shell.ts';
import { renderWriteCall, renderWriteResult } from '../src/tools/render-write.ts';
import { createActivityComponent } from '../src/ui/activity-widget.ts';
import { createFooter } from '../src/ui/footer.ts';
import { createHeader } from '../src/ui/header.ts';

const HOME = '/tmp/fakehome';
const ESC = '\x1b';
const HAN = '資料';
const KATAKANA_MODEL = 'モデル';
const KATAKANA_BRANCH = 'ブランチ';
const EMOJI = '🎉';
const COMBINING = 'e\u0301';
const CJK = `${HAN}${EMOJI}${COMBINING}`;
const ANSI_SGR = `${ESC}[31mred${ESC}[0m`;
const LONG_STRING = 'x'.repeat(5000);
const MANY_NEWLINES = '\n'.repeat(2000);
const MANY_LINES = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n');

const WIDTHS = [1, 2, 3, 4, 5, 8, 12, 20, 39, 40, 41, 60, 79, 80, 81, 100, 110, 120, 199, 200] as const;

/** Real Theme built from this package's own theme JSON, matching pi's var resolution. */
function makeTheme(): Theme {
  const document: { vars: Record<string, string | number>; colors: Record<string, string | number> } = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/cursor-ui.json', import.meta.url)), 'utf8'));
  const resolve = (value: string | number): string | number => (typeof value === 'string' && value.length > 0 && !value.startsWith('#') ? (document.vars[value] ?? value) : value);
  const colors = Object.fromEntries(Object.entries(document.colors).map(([role, value]) => [role, resolve(value)]));
  return new ThemeClass(colors as never, colors as never, 'truecolor', { name: 'cursor-ui' });
}

const theme = makeTheme();

function rowContext(overrides: Partial<ToolRowContext> = {}): ToolRowContext {
  return { executionStarted: true, isPartial: false, isError: false, ...overrides };
}

// ---------------------------------------------------------------------------
// Fixture matrix
// ---------------------------------------------------------------------------

interface CallFixture {
  readonly name: string;
  readonly args: unknown;
  readonly valid?: boolean;
}

interface ResultFixture {
  readonly name: string;
  readonly result: ToolResultLike;
  /** Content carries a grapheme wider than one cell, which pi-tui `Text` cannot fit at width 1. */
  readonly wide?: boolean;
}

const GENERIC_CALL_FIXTURES: readonly CallFixture[] = [
  { name: 'empty-object', args: {} },
  { name: 'undefined', args: undefined },
  { name: 'null', args: null },
  { name: 'number-for-string', args: { path: 42, pattern: 42, command: 42, content: 42 } },
  { name: 'empty-string', args: { path: '', pattern: '', command: '', content: '' } },
  { name: '5000-char', args: { path: LONG_STRING, pattern: LONG_STRING, command: LONG_STRING, content: LONG_STRING } },
  { name: '2000-newlines', args: { path: MANY_NEWLINES, pattern: MANY_NEWLINES, command: MANY_NEWLINES, content: MANY_NEWLINES } },
  { name: 'cjk-emoji-combining', args: { path: CJK, pattern: CJK, command: CJK, content: CJK } },
  { name: 'ansi-sgr', args: { path: ANSI_SGR, pattern: ANSI_SGR, command: ANSI_SGR, content: ANSI_SGR } },
  { name: 'tab', args: { path: 'a\tb', pattern: 'a\tb', command: 'a\tb', content: 'a\tb' } },
  { name: 'absolute-home-path', args: { path: `${HOME}/proj/src/x.ts`, pattern: `${HOME}/proj/x`, command: `${HOME}/proj/x`, content: `${HOME}/proj/x` } },
];

const VALID_CALLS: Record<string, unknown> = {
  read: { path: 'src/server.ts', offset: 4, limit: 10 },
  bash: { command: 'npm test', timeout: 30 },
  powershell: { command: 'Get-ChildItem' },
  edit: { path: 'src/ui/editor.ts' },
  write: { path: 'src/new.ts', content: 'a\nb\nc' },
  grep: { pattern: 'ExtensionContext', path: 'src' },
  find: { pattern: '*.ts', path: 'src' },
  ls: { path: 'src' },
};

const CONTENT_FIXTURES: readonly ResultFixture[] = [
  { name: 'empty-content', result: { content: [] } },
  { name: 'empty-text', result: { content: [{ type: 'text', text: '' }] } },
  { name: 'trailing-newline', result: { content: [{ type: 'text', text: 'line one\n' }] } },
  { name: '5000-lines', result: { content: [{ type: 'text', text: MANY_LINES }] } },
  { name: 'image', result: { content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] } },
  { name: 'text-without-text-field', result: { content: [{ type: 'text' }] } },
  { name: 'null-content', result: { content: null as unknown as ToolResultLike['content'] } },
  { name: 'cjk-emoji-combining', result: { content: [{ type: 'text', text: CJK }] }, wide: true },
  { name: 'ansi-sgr', result: { content: [{ type: 'text', text: ANSI_SGR }] } },
  { name: 'tab', result: { content: [{ type: 'text', text: 'a\tb' }] } },
  { name: 'plain-text', result: { content: [{ type: 'text', text: 'hello world' }] } },
];

const DETAILS_FIXTURES: readonly ResultFixture[] = [
  { name: 'diff-real', result: { content: [{ type: 'text', text: 'body' }], details: { diff: '+++ a\n--- b\n+added\n-removed\n ctx' } } },
  { name: 'diff-empty', result: { content: [{ type: 'text', text: 'body' }], details: { diff: '' } } },
  { name: 'diff-nonstring', result: { content: [{ type: 'text', text: 'body' }], details: { diff: 42 } } },
  { name: 'no-details', result: { content: [{ type: 'text', text: 'body' }], details: undefined } },
  { name: 'diff-wide', result: { content: [{ type: 'text', text: `body ${HAN}` }], details: { diff: `+${HAN}${EMOJI}\n-rem` } }, wide: true },
];

const RESULT_FIXTURES: readonly ResultFixture[] = [...CONTENT_FIXTURES, ...DETAILS_FIXTURES];

const OPTION_PAIRS: readonly ToolRenderResultOptions[] = [
  { expanded: false, isPartial: false },
  { expanded: true, isPartial: false },
  { expanded: false, isPartial: true },
  { expanded: true, isPartial: true },
];

const CONTEXTS: readonly ToolRowContext[] = [
  { executionStarted: false, isPartial: false, isError: false },
  { executionStarted: true, isPartial: false, isError: false },
  { executionStarted: true, isPartial: true, isError: false },
  { executionStarted: true, isPartial: false, isError: true },
];

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

interface Violation {
  readonly width: number;
  readonly detail: string;
}

function formatViolations(violations: readonly Violation[]): string {
  const shown = violations.slice(0, 12).map((violation) => {
    const detail = violation.detail.length > 300 ? `${violation.detail.slice(0, 300)}...` : violation.detail;
    return `  w=${violation.width}: ${detail}`;
  });
  const extra = violations.length > shown.length ? `\n  (+${violations.length - shown.length} more)` : '';
  return `${violations.length} violation(s):\n${shown.join('\n')}${extra}`;
}

/** Every forbidden token and over-width line, with the width recorded. */
function checkComponent(label: string, component: Component, width: number, expectNonEmpty = false): Violation[] {
  const violations: Violation[] = [];

  let first: string[];
  try {
    first = component.render(width);
  } catch (error) {
    return [{ width, detail: `${label}: render(${width}) threw: ${String(error)}` }];
  }
  if (!Array.isArray(first) || first.some((line) => typeof line !== 'string')) {
    return [{ width, detail: `${label}: render(${width}) did not return a string[]` }];
  }

  let second: string[];
  try {
    second = component.render(width);
  } catch (error) {
    return [{ width, detail: `${label}: second render(${width}) threw: ${String(error)}` }];
  }
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    violations.push({ width, detail: `${label}: two consecutive renders differ` });
  }
  if (first.length !== second.length) {
    violations.push({ width, detail: `${label}: second render changed the row count from ${first.length} to ${second.length}` });
  }

  for (const line of first) {
    const lineWidth = visibleWidth(line);
    if (lineWidth > width) {
      violations.push({ width, detail: `${label}: line is ${lineWidth} cells wide, exceeds ${width}: ${JSON.stringify(line)}` });
    }
    if (/undefined|NaN|\[object Object\]/.test(line)) {
      violations.push({ width, detail: `${label}: line contains undefined/NaN/[object Object]: ${JSON.stringify(line)}` });
    }
  }

  if (expectNonEmpty && !first.some((line) => stripTerminalSequences(line).trim().length > 0)) {
    violations.push({ width, detail: `${label}: expected at least one non-empty line` });
  }

  return violations;
}

function plainLines(component: Component, width: number): string[] {
  return component.render(width).map((line) => stripTerminalSequences(line).trimEnd());
}

// ---------------------------------------------------------------------------
// Call renderers
// ---------------------------------------------------------------------------

const CALL_RENDERERS: ReadonlyArray<{ readonly name: string; readonly render: (args: unknown, theme: Theme, context: ToolRowContext) => Component }> = [
  { name: 'read', render: renderReadCall },
  { name: 'bash', render: renderBashCall },
  { name: 'powershell', render: renderPowerShellCall },
  { name: 'edit', render: renderEditCall },
  { name: 'write', render: renderWriteCall },
  { name: 'grep', render: renderGrepCall },
  { name: 'find', render: renderFindCall },
  { name: 'ls', render: renderLsCall },
];

const VALID_CALL_ROWS: Record<string, string> = {
  read: '◇ Read src/server.ts:4-13',
  bash: '◇ Bash npm test (timeout 30s)',
  powershell: '◇ PowerShell Get-ChildItem',
  edit: '◇ Edit src/ui/editor.ts',
  write: '◇ Write src/new.ts (3 lines)',
  grep: '◇ Search "ExtensionContext" in src',
  find: '◇ Find "*.ts" in src',
  ls: '◇ List src',
};

for (const renderer of CALL_RENDERERS) {
  describe(`call row: ${renderer.name}`, () => {
    const fixtures: readonly CallFixture[] = [{ name: 'valid', args: VALID_CALLS[renderer.name], valid: true }, ...GENERIC_CALL_FIXTURES];
    for (const fixture of fixtures) {
      test(`${renderer.name} call / ${fixture.name}`, () => {
        const label = `${renderer.name}-call/${fixture.name}`;
        const component = renderer.render(fixture.args, theme, rowContext());
        const violations: Violation[] = [];
        for (const width of WIDTHS) {
          violations.push(...checkComponent(label, component, width, fixture.valid === true));
        }
        expect(violations, formatViolations(violations)).toEqual([]);
        if (fixture.valid === true) {
          expect(plainLines(component, 80)[0]).toBe(VALID_CALL_ROWS[renderer.name]);
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Result renderers
// ---------------------------------------------------------------------------

const RESULT_RENDERERS: ReadonlyArray<{ readonly name: string; readonly render: (result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext) => Component }> = [
  { name: 'read', render: renderReadResult },
  { name: 'bash', render: renderBashResult },
  { name: 'powershell', render: renderPowerShellResult },
  { name: 'edit', render: renderEditResult },
  { name: 'write', render: renderWriteResult },
  { name: 'grep', render: renderGrepResult },
  { name: 'find', render: renderFindResult },
  { name: 'ls', render: renderLsResult },
];

const RESULT_WIDTHS = WIDTHS.filter((width) => width > 1);

for (const renderer of RESULT_RENDERERS) {
  describe(`result row: ${renderer.name}`, () => {
    for (const fixture of RESULT_FIXTURES) {
      for (const options of OPTION_PAIRS) {
        for (const context of CONTEXTS) {
          const optionLabel = `expanded=${options.expanded},partial=${options.isPartial}`;
          const contextLabel = `started=${context.executionStarted},partial=${context.isPartial},error=${context.isError}`;
          test(`${renderer.name} result / ${fixture.name} / ${optionLabel} / ${contextLabel}`, () => {
            const label = `${renderer.name}-result/${fixture.name}/${optionLabel}/${contextLabel}`;
            const component = renderer.render(fixture.result, options, theme, context);
            const ladder = fixture.wide === true ? RESULT_WIDTHS : WIDTHS;
            const violations: Violation[] = [];
            for (const width of ladder) {
              violations.push(...checkComponent(label, component, width));
            }
            expect(violations, formatViolations(violations)).toEqual([]);
            if (fixture.name === 'plain-text' && options.expanded && !options.isPartial && !context.isError) {
              expect(plainLines(component, 80)).toEqual(['hello world']);
            }
          });
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Width-taking UI components
// ---------------------------------------------------------------------------

function requestRenderOnly(): TUI {
  return { requestRender: () => {} } as unknown as TUI;
}

function footerData(branch: string | null): ReadonlyFooterDataProvider {
  return { getGitBranch: () => branch, onBranchChange: () => () => {} } as unknown as ReadonlyFooterDataProvider;
}

function footerContext(): ExtensionContext {
  return {
    cwd: `${HOME}/proj`,
    model: { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'openai' },
    thinkingLevel: 'high',
    getContextUsage: () => ({ tokens: 16000, contextWindow: 200000, percent: 8 }),
    ui: { theme },
  } as unknown as ExtensionContext;
}

function storeWithEditedFile(path: string): ReturnType<typeof createPresentationStore> {
  const store = createPresentationStore();
  store.startTool({ toolCallId: `edit:${path}`, toolName: 'edit', args: { path }, startedAt: 1 });
  store.finishTool({ toolCallId: `edit:${path}`, toolName: 'edit', isError: false, finishedAt: 2 });
  return store;
}

function storeWithRunningTools(tools: ReadonlyArray<{ toolName: string; args: unknown }>): ReturnType<typeof createPresentationStore> {
  const store = createPresentationStore();
  let index = 0;
  for (const tool of tools) {
    store.startTool({ toolCallId: `t${index}`, toolName: tool.toolName, args: tool.args, startedAt: 1 });
    index += 1;
  }
  return store;
}

interface UiCase {
  readonly name: string;
  readonly make: () => { component: Component; dispose?: () => void };
}

const UI_CASES: readonly UiCase[] = [
  {
    name: 'header/home-relative',
    make: () => {
      vi.stubEnv('HOME', HOME);
      return { component: createHeader({ cwd: `${HOME}/proj` } as unknown as ExtensionContext)(requestRenderOnly(), theme) };
    },
  },
  {
    name: 'header/cjk-directory',
    make: () => {
      vi.stubEnv('HOME', HOME);
      return { component: createHeader({ cwd: `${HOME}/資料/長い名前` } as unknown as ExtensionContext)(requestRenderOnly(), theme) };
    },
  },
  {
    name: 'footer/full',
    make: () => {
      const footer = createFooter(footerContext(), storeWithEditedFile('src/a.ts'))(requestRenderOnly(), theme, footerData('main'));
      return { component: footer, dispose: () => footer.dispose() };
    },
  },
  {
    name: 'footer/minimal',
    make: () => {
      const ctx = { cwd: `${HOME}/proj`, model: undefined, thinkingLevel: undefined, getContextUsage: () => undefined, ui: { theme } } as unknown as ExtensionContext;
      const footer = createFooter(ctx, createPresentationStore())(requestRenderOnly(), theme, footerData(null));
      return { component: footer, dispose: () => footer.dispose() };
    },
  },
  {
    name: 'footer/deactivated-session',
    make: () => {
      const deactivated = (): never => {
        throw new Error('session runtime is gone');
      };
      const ctx = {
        cwd: `${HOME}/proj`,
        get thinkingLevel() {
          return deactivated();
        },
        get model() {
          return deactivated();
        },
        getContextUsage: deactivated,
        ui: { theme },
      } as unknown as ExtensionContext;
      const footer = createFooter(ctx, createPresentationStore())(requestRenderOnly(), theme, footerData(null));
      return { component: footer, dispose: () => footer.dispose() };
    },
  },
  {
    name: 'footer/cjk-model',
    make: () => {
      const ctx = { ...footerContext(), model: { id: 'cjkt', name: `${HAN}${KATAKANA_MODEL}${EMOJI}`, provider: 'x' } } as unknown as ExtensionContext;
      const footer = createFooter(ctx, createPresentationStore())(requestRenderOnly(), theme, footerData(`${HAN}${KATAKANA_BRANCH}`));
      return { component: footer, dispose: () => footer.dispose() };
    },
  },
  {
    name: 'activity/empty',
    make: () => {
      const component = createActivityComponent({ tui: requestRenderOnly(), theme, store: createPresentationStore(), home: HOME });
      return { component, dispose: () => component.dispose() };
    },
  },
  {
    name: 'activity/single-read',
    make: () => {
      const component = createActivityComponent({ tui: requestRenderOnly(), theme, store: storeWithRunningTools([{ toolName: 'read', args: { path: `${HOME}/src/a.ts` } }]), home: HOME });
      return { component, dispose: () => component.dispose() };
    },
  },
  {
    name: 'activity/grep-quoted',
    make: () => {
      const component = createActivityComponent({ tui: requestRenderOnly(), theme, store: storeWithRunningTools([{ toolName: 'grep', args: { pattern: 'ExtensionContext' } }]), home: HOME });
      return { component, dispose: () => component.dispose() };
    },
  },
  {
    name: 'activity/many-mixed',
    make: () => {
      const tools = [
        { toolName: 'read', args: { path: '/tmp/a.ts' } },
        { toolName: 'read', args: { path: '/tmp/b.ts' } },
        { toolName: 'grep', args: { pattern: 'one' } },
        { toolName: 'grep', args: { pattern: 'two' } },
        { toolName: 'bash', args: { command: 'npm test' } },
        { toolName: 'frobnicate', args: {} },
      ];
      const component = createActivityComponent({ tui: requestRenderOnly(), theme, store: storeWithRunningTools(tools), home: HOME });
      return { component, dispose: () => component.dispose() };
    },
  },
  {
    name: 'activity/cjk-target',
    make: () => {
      const component = createActivityComponent({ tui: requestRenderOnly(), theme, store: storeWithRunningTools([{ toolName: 'read', args: { path: `${HOME}/資料/長い名前のファイル🎉.ts` } }]), home: HOME });
      return { component, dispose: () => component.dispose() };
    },
  },
  {
    name: 'activity/ansi-target',
    make: () => {
      const component = createActivityComponent({ tui: requestRenderOnly(), theme, store: storeWithRunningTools([{ toolName: 'bash', args: { command: ANSI_SGR } }]), home: HOME });
      return { component, dispose: () => component.dispose() };
    },
  },
];

describe('width-taking UI components', () => {
  for (const uiCase of UI_CASES) {
    test(`${uiCase.name} stays within every ladder width`, () => {
      const { component, dispose } = uiCase.make();
      try {
        const violations: Violation[] = [];
        for (const width of WIDTHS) {
          violations.push(...checkComponent(uiCase.name, component, width));
        }
        expect(violations, formatViolations(violations)).toEqual([]);
        if (uiCase.name === 'header/home-relative') {
          expect(plainLines(component, 80)).toEqual(['> agent', 'Pi Coding Agent', '~/proj']);
        }
      } finally {
        dispose?.();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Literal output (these assertions fail if a renderer returns undefined)
// ---------------------------------------------------------------------------

describe('literal call rows', () => {
  test('renders the documented collapsed row text', () => {
    expect(plainLines(renderReadCall({ path: 'src/server.ts', offset: 4, limit: 10 }, theme, rowContext()), 80)).toEqual(['◇ Read src/server.ts:4-13']);
    expect(plainLines(renderBashCall({ command: 'npm test', timeout: 30 }, theme, rowContext()), 80)).toEqual(['◇ Bash npm test (timeout 30s)']);
    expect(plainLines(renderPowerShellCall({ command: 'Get-ChildItem' }, theme, rowContext()), 80)).toEqual(['◇ PowerShell Get-ChildItem']);
    expect(plainLines(renderEditCall({ path: 'src/ui/editor.ts' }, theme, rowContext()), 80)).toEqual(['◇ Edit src/ui/editor.ts']);
    expect(plainLines(renderWriteCall({ path: 'src/new.ts', content: 'a\nb\nc' }, theme, rowContext()), 80)).toEqual(['◇ Write src/new.ts (3 lines)']);
    expect(plainLines(renderGrepCall({ pattern: 'ExtensionContext', path: 'src' }, theme, rowContext()), 80)).toEqual(['◇ Search "ExtensionContext" in src']);
    expect(plainLines(renderFindCall({ pattern: '*.ts', path: 'src' }, theme, rowContext()), 80)).toEqual(['◇ Find "*.ts" in src']);
    expect(plainLines(renderLsCall({ path: 'src' }, theme, rowContext()), 80)).toEqual(['◇ List src']);
  });

  test('counts write-file lines without a phantom trailing line', () => {
    expect(plainLines(renderWriteCall({ path: 'src/new.ts', content: 'a\n' }, theme, rowContext()), 80)).toEqual(['◇ Write src/new.ts (1 line)']);
    expect(plainLines(renderWriteCall({ path: 'src/new.ts', content: '' }, theme, rowContext()), 80)).toEqual(['◇ Write src/new.ts (0 lines)']);
  });
});

describe('literal result rows', () => {
  test('expands text results and normalizes untrusted content', () => {
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'hello\nworld' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['hello', 'world']);
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'line\n' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['line']);
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'a\tb' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['a   b']);
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: ANSI_SGR }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['red']);
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'a\rb' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['ab']);
    expect(
      plainLines(
        renderReadResult(
          {
            content: [
              { type: 'text', text: 'shot' },
              { type: 'image', data: 'x', mimeType: 'image/png' },
            ],
          },
          { expanded: true, isPartial: false },
          theme,
          rowContext(),
        ),
        80,
      ),
    ).toEqual(['shot', '[image]']);
  });

  test('hides collapsed success and partial results', () => {
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'file body' }] }, { expanded: false, isPartial: false }, theme, rowContext()), 80)).toEqual([]);
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'streaming' }] }, { expanded: true, isPartial: true }, theme, rowContext()), 80)).toEqual([]);
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'file body' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['file body']);
  });

  test('shows an error row only while collapsed', () => {
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'ENOENT: nope' }] }, { expanded: false, isPartial: false }, theme, rowContext({ isError: true })), 80)).toEqual(['Error: ENOENT: nope']);
    expect(plainLines(renderReadResult({ content: [{ type: 'text', text: 'ENOENT: nope' }] }, { expanded: true, isPartial: false }, theme, rowContext({ isError: true })), 80)).toEqual(['ENOENT: nope']);
  });

  test('renders the edit diff body', () => {
    const diff = renderEditResult({ content: [], details: { diff: '+++ a\n--- b\n+add\n-rem\n ctx' } }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(plainLines(diff, 80)).toEqual(['+++ a', '--- b', '+add', '-rem', ' ctx']);

    const fallback = renderEditResult({ content: [{ type: 'text', text: 'body' }], details: { diff: 42 } }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(plainLines(fallback, 80)).toEqual(['body']);
  });

  test('renders each text tool result family', () => {
    expect(plainLines(renderBashResult({ content: [{ type: 'text', text: 'one\ntwo' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['one', 'two']);
    expect(plainLines(renderPowerShellResult({ content: [{ type: 'text', text: 'a' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['a']);
    expect(plainLines(renderWriteResult({ content: [{ type: 'text', text: 'wrote 3 lines' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['wrote 3 lines']);
    expect(plainLines(renderGrepResult({ content: [{ type: 'text', text: 'src/a.ts:1:hit\nsrc/b.ts:9:hit' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['src/a.ts:1:hit', 'src/b.ts:9:hit']);
    expect(plainLines(renderFindResult({ content: [{ type: 'text', text: 'src/a.ts\nsrc/b.ts' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(plainLines(renderLsResult({ content: [{ type: 'text', text: 'a.ts\nb.ts' }] }, { expanded: true, isPartial: false }, theme, rowContext()), 80)).toEqual(['a.ts', 'b.ts']);
  });

  test('renders the header and footer literal rows', () => {
    vi.stubEnv('HOME', HOME);
    const header = createHeader({ cwd: `${HOME}/proj` } as unknown as ExtensionContext)(requestRenderOnly(), theme);
    expect(plainLines(header, 80)).toEqual(['> agent', 'Pi Coding Agent', '~/proj']);

    const footer = createFooter(footerContext(), storeWithEditedFile('src/a.ts'))(requestRenderOnly(), theme, footerData('main'));
    try {
      const lines = plainLines(footer, 80);
      expect(lines[0]).toBe('  High (shift+tab to cycle)');
      expect(lines[1]).toBe('  GPT-6 Sol · 8% · 1 file edited');
      expect(lines[2]).toBe('  ~/proj · main');
    } finally {
      footer.dispose();
    }
  });

  test('renders the activity widget literal row', () => {
    const store = storeWithRunningTools([
      { toolName: 'read', args: { path: '/tmp/a.ts' } },
      { toolName: 'grep', args: { pattern: 'one' } },
      { toolName: 'grep', args: { pattern: 'two' } },
    ]);
    const activity = createActivityComponent({ tui: requestRenderOnly(), theme, store, home: HOME });
    try {
      expect(plainLines(activity, 80)).toEqual(['● Reading file, Searching 2 matches']);
    } finally {
      activity.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Proven pi-tui limitation
// ---------------------------------------------------------------------------

describe('proven pi-tui width-1 limitation', () => {
  test.fails('an expanded text result with a 2-cell grapheme overflows a 1-column terminal', () => {
    const component = renderReadResult({ content: [{ type: 'text', text: '資料' }] }, { expanded: true, isPartial: false }, theme, rowContext());
    const widest = Math.max(...component.render(1).map((line) => visibleWidth(line)));
    expect(widest).toBeLessThanOrEqual(1);
  });

  test.fails('an edit diff with a 2-cell grapheme overflows a 1-column terminal', () => {
    const component = renderEditResult({ content: [], details: { diff: '+資料\n-rem' } }, { expanded: true, isPartial: false }, theme, rowContext());
    const widest = Math.max(...component.render(1).map((line) => visibleWidth(line)));
    expect(widest).toBeLessThanOrEqual(1);
  });

  test('documents the exact overflowing line produced by pi-tui Text', () => {
    const component = renderReadResult({ content: [{ type: 'text', text: '資料' }] }, { expanded: true, isPartial: false }, theme, rowContext());
    const wideLines = component
      .render(1)
      .map((line) => visibleWidth(line))
      .filter((width) => width > 1);
    expect(wideLines.length).toBeGreaterThan(0);
    expect(new Set(wideLines)).toEqual(new Set([2]));
  });

  test('a real terminal of width 2 does not overflow', () => {
    const component = renderReadResult({ content: [{ type: 'text', text: '資料🎉' }] }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(checkComponent('cjk-width-2', component, 2)).toEqual([]);
    expect(plainLines(component, 2)).toEqual(['資', '料', '🎉']);
  });
});
