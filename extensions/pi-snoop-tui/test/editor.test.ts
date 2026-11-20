import type { CustomEditor } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { buildEditor, CURSOR, createSession, double, driveRow, loadSnoop, loadTheme, output, PROJECT, piNative, plain, plainLines, type Session, setBorderColor, THEME_NAMES } from './harness.ts';

const WIDE = 100;
const MEDIUM = 90;
const NARROW = 80;
const MAX_WIDTH = 120;
const BARE_RULE_WIDTH = 8;
const SCROLL_LINES = 30;
const theme = loadTheme('snoop-dark');
type Indicator = Parameters<CustomEditor['setWorkingStatusIndicator']>[0];

function started(outputPad = 1, name: 'snoop-dark' | 'snoop-light' = 'snoop-dark') {
  const host = loadSnoop({ outputPad });
  const session = createSession(loadTheme(name));
  host.fire('session_start', session.ctx);
  return { session, editor: buildEditor(session) };
}
function indicator(kind: 'working' | 'retry', text: string): Indicator {
  return double<Indicator>({ kind, renderInBorder: (width: number) => text.slice(0, width) });
}
const view = (lines: readonly string[]) => plainLines(lines);

describe('the prompt editor rules', () => {
  test.for(THEME_NAMES)('the top rule ends with ready, working, or Pi status inside the gutter in %s', (name) => {
    const { editor } = started(1, name);
    const top = () => view(editor.render(WIDE))[0] ?? '';
    expect(top()).toMatch(/^ ─+ ready $/);
    editor.setWorkingStatusIndicator(indicator('working', 'Working...'));
    expect(top()).toMatch(/^ ─+ ● working $/);
    editor.setWorkingStatusIndicator(indicator('retry', 'Retrying (1/3) in 2s'));
    expect(top()).toMatch(/^ ─+ Retrying \(1\/3\) in 2s $/);
    editor.setWorkingStatusIndicator(undefined);
    expect(top()).toMatch(/ ready $/);
    for (const line of [top(), view(editor.render(WIDE)).at(-1) ?? '']) expect(visibleWidth(line)).toBe(WIDE);
  });

  test('colors the ready label muted and the working dot accent', () => {
    const { editor } = started();
    expect(editor.render(WIDE)[0]).toContain(theme.fg('muted', 'ready'));
    editor.setWorkingStatusIndicator(indicator('working', 'Working...'));
    expect(editor.render(WIDE)[0]).toContain(`${theme.fg('accent', '●')} ${theme.fg('muted', 'working')}`);
  });

  test('every line fits every width from 1 to 120 in every status', () => {
    const { editor } = started();
    // Pi's word wrap recurses without end when a wide glyph is wider than the layout, so the sweep uses narrow text.
    editor.setText('Add a test for cancellation during retry\nsecond line');
    for (const status of [undefined, indicator('working', 'Working...'), indicator('retry', 'Retrying (1/3) in 2s')]) {
      editor.setWorkingStatusIndicator(status);
      for (let width = 1; width <= MAX_WIDTH; width++) {
        const sizes = editor.render(width).map((line) => visibleWidth(line.replace(CURSOR, '')));
        // At width 1 Pi's own cursor cell overflows the content row, in the stock editor too.
        const checked = width === 1 ? [sizes[0] ?? 0, sizes.at(-1) ?? 0] : sizes;
        for (const size of checked) expect(size).toBeLessThanOrEqual(width);
      }
    }
  });

  test('the border label gives way to the bare rule when there is no room for it', () => {
    const { editor } = started();
    expect(view(editor.render(NARROW))[0]).toMatch(/ready $/);
    expect(view(editor.render(BARE_RULE_WIDTH))[0]).toBe(' ────── ');
  });

  test('scroll counts move into the rules', () => {
    const { editor } = started();
    editor.setText(Array.from({ length: SCROLL_LINES }, (_, i) => `line ${i}`).join('\n'));
    const lines = view(editor.render(NARROW));
    expect(lines[0]).toMatch(/^ ↑ \d+ ─+ ready $/);
    expect(lines[0]?.length).toBe(NARROW);
  });
});

describe('the prompt marker', () => {
  test('sits in the gutter and the text starts at the tool verb column', () => {
    const { editor } = started();
    editor.setText('Add a test');
    editor.setPaddingX(0);
    const [, prompt] = view(editor.render(WIDE));
    const row = driveRow(loadSnoop(), 'read', { native: piNative('read', PROJECT), outputPad: 1 });
    row.apply({ args: { path: `${PROJECT}/src/cache.ts` }, executionStarted: true, result: output('a\nb'), isPartial: false });
    const header = plain(row.lines(WIDE)[0] ?? '');
    expect(prompt?.startsWith(' ›  Add a test')).toBe(true);
    expect(prompt?.indexOf('Add')).toBe(header.indexOf('read'));
  });

  test('is drawn in the accent color', () => {
    const { editor } = started();
    expect(editor.render(WIDE)[1]).toContain(theme.fg('accent', '›'));
  });

  test('is left out when the terminal is too narrow for the gutter and inset', () => {
    const { editor } = started(2);
    expect(view(editor.render(WIDE))[1]).toMatch(/^ {2}›/);
    expect(editor.render(2).join('')).not.toContain('›');
  });
});

describe('restyling', () => {
  function top(session: Session, editor: ReturnType<typeof buildEditor>, width = MEDIUM) {
    return { session, line: editor.render(width)[0] ?? '' };
  }

  test('follows a change of terminal width, status, border color and theme', () => {
    const { session, editor } = started();
    const before = top(session, editor).line;
    expect(editor.render(MEDIUM)[0]).toBe(before);
    expect(plain(editor.render(WIDE)[0] ?? '')).not.toBe(plain(before));
    editor.setWorkingStatusIndicator(indicator('working', 'Working...'));
    expect(plain(editor.render(MEDIUM)[0] ?? '')).toMatch(/● working $/);
    setBorderColor(editor, (text: string) => `<${text}>`);
    expect(editor.render(MEDIUM)[0]).toContain('<─');
    setBorderColor(editor, (text: string) => text);
    const dark = editor.render(MEDIUM)[0] ?? '';
    session.setTheme(loadTheme('snoop-light'));
    expect(editor.render(MEDIUM)[0]).not.toBe(dark);
    expect(plain(editor.render(MEDIUM)[0] ?? '')).toBe(plain(dark));
  });

  test('repaints identically after Pi invalidates the editor', () => {
    const { editor } = started();
    editor.setText('hello');
    const first = editor.render(MEDIUM);
    editor.invalidate();
    expect(editor.render(MEDIUM)).toEqual(first);
  });

  test('keeps a retry label unchanged until its text changes', () => {
    const { editor } = started();
    editor.setWorkingStatusIndicator(indicator('retry', 'Retrying (1/3) in 2s'));
    const first = editor.render(WIDE)[0];
    expect(editor.render(WIDE)[0]).toBe(first);
    editor.setWorkingStatusIndicator(indicator('retry', 'Retrying (1/3) in 1s'));
    expect(plain(editor.render(WIDE)[0] ?? '')).toMatch(/Retrying \(1\/3\) in 1s $/);
  });
});
