import type { KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent';
import { type EditorTheme, type TUI, visibleWidth } from '@earendil-works/pi-tui';
import { expect, test, vi } from 'vitest';
import { RuleEditor } from '../src/editor.ts';
import { compactRenderers } from '../src/rows/row.ts';
import { TOOL_SPECS } from '../src/rows/specs.ts';
import { driveRow, output, plain, recordingNative, stubTheme } from './harness.ts';

type Indicator = Parameters<RuleEditor['setWorkingStatusIndicator']>[0];
const CURSOR = /\x1b_pi:c\x07/g;

function editor(gutter = 1, theme: Theme = stubTheme()) {
  const tui = { terminal: { rows: 40 }, requestRender: vi.fn() } as unknown as TUI;
  const editorTheme = {
    borderColor: (text: string) => text,
    selectList: { selectedPrefix: (t: string) => t, selectedText: (t: string) => t, description: (t: string) => t, scrollInfo: (t: string) => t, noMatch: (t: string) => t },
  } as unknown as EditorTheme;
  const instance = new RuleEditor(tui, editorTheme, {} as KeybindingsManager, () => theme, gutter);
  return { instance, theme };
}
function view(lines: readonly string[]): string[] {
  return lines.map((line) => plain(line.replace(CURSOR, '')).replace(/\x1b\[[0-9;]*m/g, ''));
}
function indicator(kind: 'working' | 'retry', text: string): Indicator {
  return { kind, renderInBorder: (width: number) => text.slice(0, width) } as unknown as Indicator;
}

test('top rule ends with ready, working, or Pi status inside the gutter', () => {
  const { instance } = editor();
  const top = () => view(instance.render(100))[0] ?? '';
  expect(top()).toMatch(/^ ─+ ready $/);
  instance.setWorkingStatusIndicator(indicator('working', 'Working...'));
  expect(top()).toMatch(/^ ─+ ● working $/);
  instance.setWorkingStatusIndicator(indicator('retry', 'Retrying (1/3) in 2s'));
  expect(top()).toMatch(/^ ─+ Retrying \(1\/3\) in 2s $/);
  instance.setWorkingStatusIndicator(undefined);
  expect(top()).toMatch(/ ready $/);
  for (const line of [top(), view(instance.render(100)).at(-1) ?? '']) expect(visibleWidth(line)).toBe(100);
});

test('prompt marker sits in the gutter and text starts at the tool verb column', () => {
  const { instance } = editor();
  instance.setText('Add a test');
  instance.setPaddingX(0);
  const [, prompt] = view(instance.render(100));
  const row = driveRow(compactRenderers(TOOL_SPECS.read, recordingNative()), stubTheme(), { outputPad: 1 });
  row.apply({ args: { path: '/project/src/cache.ts' }, executionStarted: true, result: output('a\nb'), isPartial: false });
  const header = plain(row.lines(100)[0] ?? '');
  expect(prompt?.startsWith(' ›  Add a test')).toBe(true);
  expect(prompt?.indexOf('Add')).toBe(header.indexOf('read'));
});

test('every editor line fits every width from 1 to 120', () => {
  const { instance } = editor();
  // Pi's word wrap recurses without end when a wide glyph is wider than the layout, so the sweep uses narrow text.
  instance.setText('Add a test for cancellation during retry\nsecond line');
  for (const status of [undefined, indicator('working', 'Working...'), indicator('retry', 'Retrying (1/3) in 2s')]) {
    instance.setWorkingStatusIndicator(status);
    for (let width = 1; width <= 120; width++) {
      const lines = instance.render(width).map((line) => visibleWidth(line.replace(CURSOR, '')));
      // At width 1 Pi's own cursor cell overflows the content row, in the stock editor too.
      const checked = width === 1 ? [lines[0] ?? 0, lines.at(-1) ?? 0] : lines;
      for (const size of checked) expect(size).toBeLessThanOrEqual(width);
    }
  }
});

test('rules are restyled only when width, status, scroll, border, or theme change', () => {
  const { instance, theme } = editor();
  instance.render(100);
  const calls = () => vi.mocked(theme.fg).mock.calls.length;
  const settled = calls();
  instance.render(100);
  instance.render(100);
  expect(calls()).toBe(settled);
  instance.render(90);
  expect(calls()).toBeGreaterThan(settled);
  const resized = calls();
  instance.setWorkingStatusIndicator(indicator('working', 'Working...'));
  instance.render(90);
  expect(calls()).toBeGreaterThan(resized + 1);
  const bash = (text: string) => `<${text}>`;
  instance.borderColor = bash;
  expect(instance.render(90)[0]).toContain('<─');
  const before = calls();
  instance.invalidate();
  instance.render(90);
  expect(calls()).toBeGreaterThan(before + 1);
});

test('scroll counts move into the rules', () => {
  const { instance } = editor();
  instance.setText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'));
  const lines = view(instance.render(80));
  expect(lines[0]).toMatch(/^ ↑ \d+ ─+ ready $/);
  expect(lines[0]?.length).toBe(80);
});
