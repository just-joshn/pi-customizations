import type { ToolRenderers } from '@earendil-works/pi-coding-agent';
import { Text, visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { driveRow, EMPTY_NATIVE, fakeNative, loadSnoop, loadTheme, output, PROJECT, plain, plainLines, type Row, rawNative } from './harness.ts';

const host = loadSnoop();
const NARROW = 80;
const WIDE = 100;
const RESIZED = 40;
const MAX_WIDTH = 120;
const REPEATS = 10;
const MAX_COLLAPSED_ROWS = 7;
const LONG_PATH = `${PROJECT}/a/very/long/path/漢字/🙂/filename.ts`;
const UNICODE_FILE = `${PROJECT}/漢字/🙂.ts`;
const HYPERLINK_BLANK = '\x1b]8;;https://example.com\x07 \x1b]8;;\x07';
const THEME = loadTheme('snoop-dark');

function expectFitsEveryWidth(row: Row): void {
  for (let width = 1; width <= MAX_WIDTH; width++) for (const line of row.lines(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
}

describe('expanding a row', () => {
  test('shows the native result detail under the header, indented past the marker', () => {
    const { native } = fakeNative();
    const row = driveRow(host, 'read', { native, outputPad: 2 });
    row.apply({ args: { path: 'a.ts' }, executionStarted: true, result: output('detail'), isPartial: false, expanded: true });
    expect(row.text(NARROW)[0]).toMatch(/^ {2}✓ {2}read {6}a\.ts\s+1 line$/);
    expect((row.text(NARROW)[1] ?? '').trimEnd()).toBe('      NATIVE 漢字 🙂');
  });

  test('keeps the same lines after an invalidate or a resize and back', () => {
    const { native } = fakeNative();
    const row = driveRow(host, 'read', { native, outputPad: 2 });
    row.apply({ result: output('detail'), isPartial: false, expanded: true });
    const first = row.text(NARROW);
    row.apply({ invalidate: true });
    expect(row.text(NARROW)).toEqual(first);
    expect(row.text(RESIZED).join('\n')).toContain('     NATIVE');
    expect(row.text(NARROW)).toEqual(first);
  });

  test('hides native call rendering and keeps the native result rendering consistently across re-renders', () => {
    let renders = 0;
    const native: ToolRenderers = {
      renderCall: () => {
        throw new Error('native renderCall must not run');
      },
      renderResult: (_result, _options, _theme, context) => {
        renders += 1;
        const shown = `render ${renders} pad ${context.outputPad} first ${context.lastComponent === undefined}`;
        const component = context.lastComponent instanceof Text ? context.lastComponent : new Text('', 0, 0);
        component.setText(shown);
        return component;
      },
    };
    const row = driveRow(host, 'edit', { native });
    row.apply({ executionStarted: true, result: output('done'), isPartial: false, expanded: true });
    expect(row.text(NARROW).join('\n')).toContain('render 1 pad 0 first true');
    row.apply({ expanded: false });
    row.apply({ expanded: true, invalidate: true });
    expect(row.text(NARROW).join('\n')).toContain('render 2 pad 0 first false');
  });
});

describe('expanded row fallbacks', () => {
  test('falls back to the arguments and plain text when Pi has no result renderer for the tool', () => {
    const row = driveRow(host, 'read', { native: EMPTY_NATIVE });
    row.apply({ args: { path: 'a.ts' }, result: output('plain \x1b[31mred\x1b[0m text'), isPartial: false, expanded: true });
    const lines = row.text(NARROW).map((line) => line.trim());
    expect(lines).toContain('{"path":"a.ts"}');
    expect(lines).toContain('plain red text');
    row.apply({ args: undefined, result: output('') });
    expect(row.text(NARROW).join('\n')).not.toContain('plain');
  });

  test('drops blank first and last lines of the native detail but keeps blank lines inside', () => {
    const row = driveRow(host, 'bash', { native: rawNative(['', '  ', 'PASS cache.test.ts', '', 'respects cancellation', '\x1b[0m', HYPERLINK_BLANK]) });
    row.apply({ args: { command: 'npm test' }, executionStarted: true, result: output('PASS'), isPartial: false, expanded: true });
    expect(
      row
        .text(NARROW)
        .slice(1)
        .map((line) => line.trim()),
    ).toEqual(['PASS cache.test.ts', '', 'respects cancellation']);
  });
});

describe('expanded row panels', () => {
  test('draws a pending background that turns to the error background when the same output fails', () => {
    const child = new Text('boom', 0, 0);
    const row = driveRow(host, 'bash', { native: { renderResult: () => child }, theme: THEME });
    row.apply({ args: { command: 'make' }, executionStarted: true, result: output('boom'), isPartial: false, expanded: true });
    expect(row.lines(60)[1]).toContain(THEME.getBgAnsi('toolPendingBg'));
    row.apply({ result: output('boom', true) });
    expect(row.lines(60)[1]).toContain(THEME.getBgAnsi('toolErrorBg'));
    row.apply({ result: output('boom') });
    expect(row.lines(60)[1]).toContain(THEME.getBgAnsi('toolPendingBg'));
  });

  test('collapsing again removes the detail and expanding twice in a row changes nothing', () => {
    const { native } = fakeNative();
    const row = driveRow(host, 'read', { native });
    row.apply({ args: { path: 'a.ts' }, result: output('a\nb'), isPartial: false, expanded: true });
    const expanded = row.text(NARROW);
    row.apply({ expanded: true });
    expect(row.text(NARROW)).toEqual(expanded);
    row.apply({ expanded: false });
    expect(row.text(NARROW)).toHaveLength(1);
  });
});

describe('rows over repeated updates', () => {
  test('look identical when nothing changed and after an invalidate', () => {
    const { native } = fakeNative();
    const row = driveRow(host, 'read', { native });
    row.apply({ args: { path: `${PROJECT}/cache.ts` }, executionStarted: true, result: output('a\nb'), isPartial: false });
    const first = row.text(NARROW);
    expect(first[0]).toMatch(/✓ {2}read\s+cache.ts\s+2 lines/);
    for (let i = 0; i < REPEATS; i++) {
      row.apply({});
      expect(row.text(NARROW)).toEqual(first);
    }
    row.apply({ invalidate: true });
    expect(row.text(NARROW)).toEqual(first);
  });

  test('tolerate toggling expansion before any result arrived', () => {
    const { native } = fakeNative();
    const row = driveRow(host, 'bash', { native });
    row.apply({ args: { command: 'echo hi' } });
    row.apply({ expanded: true });
    row.apply({ expanded: false });
    expect(row.text(NARROW)).toEqual([' ·  bash      echo hi']);
  });

  test('indent an open panel by the gutter Pi asks for', () => {
    const { native } = fakeNative();
    const narrowPad = driveRow(host, 'read', { native, outputPad: 0 });
    const widePad = driveRow(host, 'read', { native, outputPad: 3 });
    for (const row of [narrowPad, widePad]) row.apply({ args: { path: 'a.ts' }, result: output('a'), isPartial: false, expanded: true });
    expect((narrowPad.text(NARROW)[1] ?? '').trimEnd()).toBe('    NATIVE 漢字 🙂');
    expect((widePad.text(NARROW)[1] ?? '').trimEnd()).toBe('       NATIVE 漢字 🙂');
  });
});

describe('rows when Pi changes a setting mid-session', () => {
  const OPEN_PANEL = { args: { path: 'a.ts' }, result: output('a'), isPartial: false, expanded: true };

  test('an open panel whose lines ignore the width moves with the gutter at the same width, and back', () => {
    const row = driveRow(host, 'read', { native: rawNative(['NATIVE']), outputPad: 0 });
    row.apply(OPEN_PANEL);
    expect((row.text(NARROW)[1] ?? '').trimEnd()).toBe('    NATIVE');
    row.apply({ outputPad: 3 });
    expect((row.text(NARROW)[1] ?? '').trimEnd()).toBe('       NATIVE');
    row.apply({ outputPad: 0 });
    expect((row.text(NARROW)[1] ?? '').trimEnd()).toBe('    NATIVE');
  });

  test.for(['text', 'native'] as const)('an open %s panel takes the new theme colors without being rebuilt', (kind) => {
    const dark = loadTheme('snoop-dark');
    const light = loadTheme('snoop-light');
    const row = driveRow(host, 'read', { native: kind === 'native' ? fakeNative().native : EMPTY_NATIVE, theme: dark });
    row.apply(OPEN_PANEL);
    expect(row.lines(NARROW).join('\n')).toContain(dark.getBgAnsi('toolPendingBg'));
    row.apply({ theme: light });
    const shown = row.lines(NARROW).join('\n');
    expect(shown).toContain(light.getBgAnsi('toolPendingBg'));
    expect(shown).not.toContain(dark.getBgAnsi('toolPendingBg'));
  });

  test('the header and a collapsed preview take the new theme colors', () => {
    const dark = loadTheme('snoop-dark');
    const light = loadTheme('snoop-light');
    const row = driveRow(host, 'bash', { native: fakeNative().native, theme: dark });
    row.apply({ args: { command: 'make' }, executionStarted: true, result: output('boom\nCommand exited with code 1', true), isPartial: false });
    expect(row.lines(NARROW).join('\n')).toContain(dark.fg('error', 'boom'));
    row.apply({ theme: light });
    const shown = row.lines(NARROW).join('\n');
    expect(shown).toContain(light.fg('error', '✗'));
    expect(shown).toContain(light.fg('error', 'boom'));
    expect(shown).not.toContain(dark.fg('error', 'boom'));
  });
});

describe('rows within the terminal width', () => {
  test('collapsed headers and expanded panels fit every width with any gutter', () => {
    for (const outputPad of [0, 1, 2]) {
      const row = driveRow(host, 'read', { native: fakeNative().native, outputPad });
      row.apply({ args: { path: LONG_PATH }, result: output('one\ntwo'), isPartial: false });
      for (const expanded of [false, true]) {
        row.apply({ expanded });
        expectFitsEveryWidth(row);
      }
      expect(row.lines(NARROW).length).toBeGreaterThan(0);
    }
  });

  test.for(['bash', 'read'])('wide glyphs in %s previews, running tails and failures always fit and stay bounded', (tool) => {
    const row = driveRow(host, tool, { native: fakeNative().native, outputPad: 2 });
    for (const event of [
      { args: { path: UNICODE_FILE, command: 'echo 漢字 🙂' } },
      { executionStarted: true, result: output('漢字 🙂\n'.repeat(REPEATS)) },
      { result: output('漢字 🙂\n'.repeat(REPEATS), true), isPartial: false },
      { expanded: true },
      { expanded: false },
    ]) {
      row.apply(event);
      expectFitsEveryWidth(row);
    }
    expect(row.lines(NARROW).length).toBeLessThanOrEqual(MAX_COLLAPSED_ROWS);
    expect(plainLines(row.lines(NARROW)).join('\n')).toContain('ctrl+o');
  });

  test.for([1, 2])('metadata ends one gutter (%i) from the right edge', (outputPad) => {
    const row = driveRow(host, 'read', { native: fakeNative().native, outputPad });
    row.apply({ args: { path: `${PROJECT}/src/cache.ts` }, executionStarted: true, result: output('a\nb'), isPartial: false });
    const line = plain(row.lines(WIDE)[0] ?? '');
    expect(line.endsWith('2 lines')).toBe(true);
    expect(visibleWidth(line)).toBe(WIDE - outputPad);
  });
});
