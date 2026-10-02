import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import { registerToolRenderers, TOOL_OVERRIDES_ENV } from '../src/tools/register-tool-renderers.ts';
import { renderEditCall, renderEditResult } from '../src/tools/render-edit.ts';
import { renderFindCall, renderFindResult } from '../src/tools/render-find.ts';
import { renderGrepCall, renderGrepResult } from '../src/tools/render-grep.ts';
import { renderLsCall, renderLsResult } from '../src/tools/render-ls.ts';
import { renderReadCall, renderReadResult } from '../src/tools/render-read.ts';
import type { ToolRowContext } from '../src/tools/render-shell.ts';
import { renderBashCall, renderBashResult, renderPowerShellCall, renderPowerShellResult } from '../src/tools/render-shell.ts';
import { renderWriteCall, renderWriteResult } from '../src/tools/render-write.ts';
import { createThemeFixture } from './theme-fixture.ts';

const theme = createThemeFixture();
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (text: string): string => text.replace(ANSI, '');

function rowContext(overrides: Partial<ToolRowContext> = {}): ToolRowContext {
  return { executionStarted: true, isPartial: false, isError: false, ...overrides };
}

function renderLines(component: Component, width: number): string[] {
  return component.render(width);
}

function plainLine(component: Component, width: number): string {
  return strip(renderLines(component, width)[0] ?? '').trimEnd();
}

describe('cursor-ui tool renderers', () => {
  test('read call row carries path plus request range', () => {
    const plain = renderReadCall({ path: 'src/server.ts' }, theme, rowContext());
    expect(plainLine(plain, 80)).toBe('◇ Read src/server.ts');
    expect(plainLine(plain, 20)).toBe('◇ Read src/server.ts');
    expect(plainLine(plain, 80).length).toBe(20);

    const ranged = renderReadCall({ path: 'x.ts', offset: 4, limit: 10 }, theme, rowContext());
    expect(plainLine(ranged, 80)).toBe('◇ Read x.ts:4-13');
  });

  test('read call row colors its marker by execution state', () => {
    const pending = renderReadCall({ path: 'src/server.ts' }, theme, rowContext({ executionStarted: false }));
    expect((renderLines(pending, 80)[0] ?? '').startsWith(theme.fg('dim', '◇'))).toBe(true);

    const running = renderReadCall({ path: 'src/server.ts' }, theme, rowContext({ isPartial: true }));
    expect((renderLines(running, 80)[0] ?? '').startsWith(theme.fg('dim', '◇'))).toBe(true);

    const done = renderReadCall({ path: 'src/server.ts' }, theme, rowContext());
    expect((renderLines(done, 80)[0] ?? '').startsWith(theme.fg('success', '◇'))).toBe(true);

    const failed = renderReadCall({ path: 'src/server.ts' }, theme, rowContext({ isError: true }));
    expect((renderLines(failed, 80)[0] ?? '').startsWith(theme.fg('error', '◇'))).toBe(true);
  });

  test('read result row hides output until it is needed', () => {
    const success = renderReadResult({ content: [{ type: 'text', text: 'file body' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext());
    expect(renderLines(success, 80).length).toBe(0);

    const partial = renderReadResult({ content: [{ type: 'text', text: 'streaming' }], details: undefined }, { expanded: true, isPartial: true }, theme, rowContext());
    expect(renderLines(partial, 80).length).toBe(0);

    const error = renderReadResult({ content: [{ type: 'text', text: 'ENOENT: no such file' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext({ isError: true }));
    expect(plainLine(error, 80)).toBe('Error: ENOENT: no such file');
    expect(renderLines(error, 80).length).toBe(1);

    const expanded = renderReadResult({ content: [{ type: 'text', text: 'hello\nworld' }], details: undefined }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(renderLines(expanded, 80).map((line) => strip(line).trimEnd())).toEqual(['hello', 'world']);
  });
});

describe('cursor-ui image and shell tool rows', () => {
  test('read result row marks an image instead of rendering it', () => {
    const image = renderReadResult(
      {
        content: [
          { type: 'text', text: 'shot' },
          { type: 'image', data: 'data', mimeType: 'image/png' },
        ],
      },
      { expanded: true, isPartial: false },
      theme,
      rowContext(),
    );
    expect(renderLines(image, 80).map((line) => strip(line).trimEnd())).toEqual(['shot', '[image]']);
  });

  test('shell tool call rows show the first command line', () => {
    const bash = renderBashCall({ command: 'echo one\necho two' }, theme, rowContext());
    expect(plainLine(bash, 80)).toBe('◇ Bash echo one');

    const timed = renderBashCall({ command: 'npm test', timeout: 30 }, theme, rowContext());
    expect(plainLine(timed, 80)).toBe('◇ Bash npm test (timeout 30s)');

    const powershell = renderPowerShellCall({ command: 'Get-ChildItem' }, theme, rowContext());
    expect(plainLine(powershell, 80)).toBe('◇ PowerShell Get-ChildItem');
  });

  test('bash result row shows error line or expanded output', () => {
    const failed = renderBashResult({ content: [{ type: 'text', text: 'Command exited with code 3' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext({ isError: true }));
    expect(plainLine(failed, 80)).toBe('Error: Command exited with code 3');

    const expanded = renderBashResult({ content: [{ type: 'text', text: 'one\ntwo' }], details: undefined }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(renderLines(expanded, 80).map((line) => strip(line).trimEnd())).toEqual(['one', 'two']);
  });
});

describe('cursor-ui edit, write, search and list call rows', () => {
  test('edit call row shows path with diff coloring', () => {
    const call = renderEditCall({ path: 'src/ui/editor.ts' }, theme, rowContext());
    expect(plainLine(call, 80)).toBe('◇ Edit src/ui/editor.ts');

    const expanded = renderEditResult({ content: [{ type: 'text', text: 'ok' }], details: { diff: '+1 added\n-1 removed\n 1 context' } }, { expanded: true, isPartial: false }, theme, rowContext());
    const lines = renderLines(expanded, 80);
    expect(lines.map((line) => strip(line).trimEnd())).toEqual(['+1 added', '-1 removed', ' 1 context']);
    expect((lines[0] ?? '').startsWith(theme.fg('toolDiffAdded', '+1 added'))).toBe(true);
    expect((lines[1] ?? '').startsWith(theme.fg('toolDiffRemoved', '-1 removed'))).toBe(true);
    expect((lines[2] ?? '').startsWith(theme.fg('toolDiffContext', ' 1 context'))).toBe(true);
  });

  test('edit result row falls back to the result text without a diff', () => {
    const fallback = renderEditResult({ content: [{ type: 'text', text: 'edited two files' }], details: undefined }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(renderLines(fallback, 80).map((line) => strip(line).trimEnd())).toEqual(['edited two files']);
  });

  test('write call row carries the line count', () => {
    const call = renderWriteCall({ path: 'src/new.ts', content: 'a\nb\nc' }, theme, rowContext());
    expect(plainLine(call, 80)).toBe('◇ Write src/new.ts (3 lines)');
  });

  test('search tool call rows quote pattern with path note', () => {
    expect(plainLine(renderGrepCall({ pattern: 'ExtensionContext' }, theme, rowContext()), 80)).toBe('◇ Search "ExtensionContext"');
    expect(plainLine(renderGrepCall({ pattern: 'foo', path: 'src' }, theme, rowContext()), 80)).toBe('◇ Search "foo" in src');
    expect(plainLine(renderGrepCall({ pattern: 'foo', path: '.' }, theme, rowContext()), 80)).toBe('◇ Search "foo"');

    expect(plainLine(renderFindCall({ pattern: '*.ts', path: 'src' }, theme, rowContext()), 80)).toBe('◇ Find "*.ts" in src');
    expect(plainLine(renderFindCall({ pattern: '*.ts' }, theme, rowContext()), 80)).toBe('◇ Find "*.ts"');
  });

  test('ls call row defaults to the current directory', () => {
    expect(plainLine(renderLsCall({ path: 'src' }, theme, rowContext()), 80)).toBe('◇ List src');
    expect(plainLine(renderLsCall({}, theme, rowContext()), 80)).toBe('◇ List .');
  });
});

describe('cursor-ui long paths and write and grep result rows', () => {
  test('long paths truncate to one line at the terminal width', () => {
    const longPath = renderReadCall({ path: '/Users/someone/projects/very-long-directory-name/src/components/JapaneseButton.tsx' }, theme, rowContext());
    expect(plainLine(longPath, 20)).toBe('◇ Read /Users/som...');
    expect(renderLines(longPath, 20).length).toBe(1);

    const widePath = renderReadCall(
      // biome-ignore lint/security/noSecrets: a wide-character path fixture, not a secret.
      { path: '資料/長い名前のファイル.ts' },
      theme,
      rowContext(),
    );
    expect(plainLine(widePath, 20)).toBe('◇ Read 資料/長い...');
    expect(renderLines(widePath, 20).length).toBe(1);
  });

  test('write result row hides output until it is needed', () => {
    const partial = renderWriteResult({ content: [{ type: 'text', text: 'wrote 3 lines' }], details: undefined }, { expanded: true, isPartial: true }, theme, rowContext());
    expect(renderLines(partial, 80).length).toBe(0);

    const collapsed = renderWriteResult({ content: [{ type: 'text', text: 'wrote 3 lines' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext());
    expect(renderLines(collapsed, 80).length).toBe(0);

    const error = renderWriteResult({ content: [{ type: 'text', text: 'EACCES: permission denied' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext({ isError: true }));
    expect(plainLine(error, 80)).toBe('Error: EACCES: permission denied');
    expect(renderLines(error, 80).length).toBe(1);

    const expanded = renderWriteResult({ content: [{ type: 'text', text: 'wrote 3 lines' }], details: undefined }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(renderLines(expanded, 80).map((line) => strip(line).trimEnd())).toEqual(['wrote 3 lines']);
  });

  test('grep result row hides output until it is needed', () => {
    const partial = renderGrepResult({ content: [{ type: 'text', text: 'src/a.ts:1:hit' }], details: undefined }, { expanded: true, isPartial: true }, theme, rowContext());
    expect(renderLines(partial, 80).length).toBe(0);

    const collapsed = renderGrepResult({ content: [{ type: 'text', text: 'src/a.ts:1:hit' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext());
    expect(renderLines(collapsed, 80).length).toBe(0);

    const error = renderGrepResult({ content: [{ type: 'text', text: 'ripgrep is not installed' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext({ isError: true }));
    expect(plainLine(error, 80)).toBe('Error: ripgrep is not installed');
    expect(renderLines(error, 80).length).toBe(1);

    const expanded = renderGrepResult({ content: [{ type: 'text', text: 'src/a.ts:1:hit\nsrc/b.ts:9:hit' }], details: undefined }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(renderLines(expanded, 80).map((line) => strip(line).trimEnd())).toEqual(['src/a.ts:1:hit', 'src/b.ts:9:hit']);
  });
});

describe('cursor-ui find, ls and powershell result rows', () => {
  test('find result row hides output until it is needed', () => {
    const partial = renderFindResult({ content: [{ type: 'text', text: 'src/a.ts' }], details: undefined }, { expanded: true, isPartial: true }, theme, rowContext());
    expect(renderLines(partial, 80).length).toBe(0);

    const collapsed = renderFindResult({ content: [{ type: 'text', text: 'src/a.ts' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext());
    expect(renderLines(collapsed, 80).length).toBe(0);

    const error = renderFindResult({ content: [{ type: 'text', text: 'invalid pattern' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext({ isError: true }));
    expect(plainLine(error, 80)).toBe('Error: invalid pattern');
    expect(renderLines(error, 80).length).toBe(1);

    const expanded = renderFindResult({ content: [{ type: 'text', text: 'src/a.ts\nsrc/b.ts' }], details: undefined }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(renderLines(expanded, 80).map((line) => strip(line).trimEnd())).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('ls result row hides output until it is needed', () => {
    const partial = renderLsResult({ content: [{ type: 'text', text: 'a.ts' }], details: undefined }, { expanded: true, isPartial: true }, theme, rowContext());
    expect(renderLines(partial, 80).length).toBe(0);

    const collapsed = renderLsResult({ content: [{ type: 'text', text: 'a.ts' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext());
    expect(renderLines(collapsed, 80).length).toBe(0);

    const error = renderLsResult({ content: [{ type: 'text', text: 'ENOENT: no such directory' }], details: undefined }, { expanded: false, isPartial: false }, theme, rowContext({ isError: true }));
    expect(plainLine(error, 80)).toBe('Error: ENOENT: no such directory');
    expect(renderLines(error, 80).length).toBe(1);

    const expanded = renderLsResult({ content: [{ type: 'text', text: 'a.ts\nb.ts' }], details: undefined }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(renderLines(expanded, 80).map((line) => strip(line).trimEnd())).toEqual(['a.ts', 'b.ts']);
  });

  test('powershell result row marks an image instead of output', () => {
    const image = renderPowerShellResult({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }], details: undefined }, { expanded: true, isPartial: false }, theme, rowContext());
    expect(renderLines(image, 80).map((line) => strip(line).trimEnd())).toEqual(['[image]']);
  });
});

describe('cursor-ui tool renderer registration', () => {
  test('registration replaces shell with both renderers', () => {
    const captured = new Map<string, ToolDefinition>();
    const fakePi = {
      registerTool: (definition: ToolDefinition) => {
        captured.set(definition.name, definition);
      },
    } as unknown as ExtensionAPI;
    vi.stubEnv(TOOL_OVERRIDES_ENV, 'grep,find,ls,powershell');
    try {
      registerToolRenderers(fakePi);
    } finally {
      vi.unstubAllEnvs();
    }

    expect([...captured.keys()].sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'powershell', 'read', 'write']);
    for (const definition of captured.values()) {
      expect(definition.renderShell).toBe('self');
      expect(typeof definition.renderCall).toBe('function');
      expect(typeof definition.renderResult).toBe('function');
    }

    const read = captured.get('read');
    if (!read) throw new Error('read is not registered');
    const component = read.renderCall?.({ path: 'src/server.ts' }, theme, {
      args: { path: 'src/server.ts' },
      toolCallId: 'call-1',
      invalidate: () => {},
      lastComponent: undefined,
      state: {},
      cwd: '/tmp',
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: true,
      isError: false,
    });
    if (!component) throw new Error('read has no renderCall');
    expect(plainLine(component, 80)).toBe('◇ Read src/server.ts');
  });
});

const ESC = '\x1b';
const plainLines = (component: Component, width: number): string[] => renderLines(component, width).map((line) => strip(line).trimEnd());
const expanded = { expanded: true, isPartial: false };
const collapsed = { expanded: false, isPartial: false };
const body = (text: string) => ({ content: [{ type: 'text', text }], details: undefined });

describe('cursor-ui tool row fidelity', () => {
  test('write row counts the lines a file has', () => {
    const cases: [string, string][] = [
      ['x', '(1 line)'],
      ['x\n', '(1 line)'],
      ['a\nb', '(2 lines)'],
      ['a\n\n', '(2 lines)'],
      ['', '(0 lines)'],
    ];
    for (const [content, expected] of cases) {
      expect(plainLine(renderWriteCall({ path: 'note.txt', content }, theme, rowContext()), 80)).toBe(`◇ Write note.txt ${expected}`);
    }
  });

  test('expanded output drops trailing blank lines and carriage returns', () => {
    expect(plainLines(renderBashResult(body('a\nb\n'), expanded, theme, rowContext()), 80)).toEqual(['a', 'b']);
    expect(plainLines(renderBashResult(body('a\r\nb\r\n'), expanded, theme, rowContext()), 80)).toEqual(['a', 'b']);
  });

  test('expanded output cannot carry terminal control sequences', () => {
    expect(plainLines(renderBashResult(body(`${ESC}[31mred${ESC}[0m`), expanded, theme, rowContext()), 80)).toEqual(['red']);
    expect(plainLines(renderBashResult(body(`${ESC}[2Jx`), expanded, theme, rowContext()), 80)).toEqual(['x']);
    expect(plainLines(renderBashResult(body('a\u0007b'), expanded, theme, rowContext()), 80)).toEqual(['ab']);
    expect(plainLines(renderBashResult(body('a\tb'), expanded, theme, rowContext()), 80)).toEqual(['a   b']);
    expect(renderLines(renderBashResult(body(`${ESC}[2Jx`), expanded, theme, rowContext()), 80).join('')).not.toContain(`${ESC}[2J`);
  });
});

describe('cursor-ui tool row fidelity for diffs and errors', () => {
  test('call rows and diffs carry no carriage returns or terminal escapes', () => {
    const crlf = renderBashCall({ command: 'echo one\r\necho two' }, theme, rowContext());
    expect(plainLines(crlf, 80)).toEqual(['◇ Bash echo one']);
    expect(renderLines(crlf, 80).join('')).not.toContain('\r');

    const bare = renderBashCall({ command: 'echo one\rsecond' }, theme, rowContext());
    expect(plainLines(bare, 80)).toEqual(['◇ Bash echo onesecond']);

    const clear = renderReadCall({ path: `notes${ESC}[2Jx.txt` }, theme, rowContext());
    expect(plainLines(clear, 80)).toEqual(['◇ Read notesx.txt']);
    expect(renderLines(clear, 80).join('')).not.toContain(`${ESC}[2J`);

    const diff = renderEditResult({ content: [{ type: 'text', text: 'ok' }], details: { diff: '+one\r\n-two' } }, expanded, theme, rowContext());
    expect(plainLines(diff, 80)).toEqual(['+one', '-two']);
    expect(renderLines(diff, 80).join('')).not.toContain('\r');
  });

  test('a successful result whose text starts with Error stays a success', () => {
    const text = 'Error: nothing bad\nsecond line';
    expect(plainLines(renderBashResult(body(text), collapsed, theme, rowContext()), 80)).toEqual([]);
    expect(plainLines(renderBashResult(body(text), expanded, theme, rowContext()), 80)).toEqual(['Error: nothing bad', 'second line']);
  });

  test('expanded errors show the whole body', () => {
    const result = body('boom\nstack line\n');
    expect(plainLines(renderBashResult(result, collapsed, theme, rowContext({ isError: true })), 80)).toEqual(['Error: boom']);
    expect(plainLines(renderBashResult(result, expanded, theme, rowContext({ isError: true })), 80)).toEqual(['boom', 'stack line']);
  });
});
