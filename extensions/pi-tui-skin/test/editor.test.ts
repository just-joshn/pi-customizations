import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { createPresentationStore } from '../src/state/presentation-store.ts';
import { createEditorFactory, SkinStyleEditor } from '../src/ui/editor.ts';

const ANSI = {
  success: '\u001b[32m',
  borderMuted: '\u001b[36m',
  bashMode: '\u001b[33m',
  dim: '\u001b[90m',
} as const;

const ESC = '\x1b';
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function styled(color: keyof typeof ANSI, text: string): string {
  return `${ANSI[color]}${text}\u001b[0m`;
}

function strip(line: string): string {
  return line.replace(CURSOR_MARKER, '').replace(ANSI_PATTERN, '');
}

function editorHarness(options: { borderColor?: (text: string) => string; rows?: number; onInvalidate?: () => void } = {}) {
  const store = createPresentationStore();
  const tui = { requestRender: () => {}, terminal: { rows: options.rows ?? 40, columns: 120 } } as never;
  const editorTheme = { borderColor: options.borderColor ?? ((text: string) => text) } as never;
  const appTheme = { fg: (color: keyof typeof ANSI, text: string) => styled(color, text) } as never;
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS as never) as never;
  const editor = new SkinStyleEditor(tui, editorTheme, keybindings, store, appTheme, options.onInvalidate ?? (() => {}));
  editor.focused = true;
  return { editor, store };
}

function bandText(lines: readonly string[], glyph: string): string[] {
  return lines.filter((line) => strip(line).includes(glyph)).map(strip);
}

describe('SkinStyleEditor', () => {
  test('idle empty editor shows the reference placeholder behind a half-block band', () => {
    const { editor } = editorHarness();
    const lines = editor.render(60);
    expect(lines.length).toBe(3);
    expect(strip(lines[0] ?? '')).toBe(` ${'▄'.repeat(58)} `);
    expect(strip(lines[1] ?? '')).toContain('→ Plan, search, build anything');
    expect(strip(lines[2] ?? '')).toBe(` ${'▀'.repeat(58)} `);
    expect(lines[1], 'focused row carries the hardware cursor marker').toContain(CURSOR_MARKER);
    expect(lines.every((line) => visibleWidth(line) === 60)).toBe(true);
  });

  test('running empty editor switches the placeholder and adds the flush-right stop hint', () => {
    const { editor, store } = editorHarness();
    store.setAgentRunning(1);
    const lines = editor.render(60);
    const row = strip(lines[1] ?? '');
    expect(strip(row)).toContain('→ Add a follow-up');
    expect(row).toContain('esc to stop');
    expect(row.trimEnd()).toMatch(/esc to stop$/);
    expect(lines[2]).not.toContain('esc to stop');
  });

  test('typed text keeps the reference glyph at column two and the text at column four', () => {
    const { editor } = editorHarness();
    editor.setText('hello world');
    const content = editor.render(60)[1] ?? '';
    expect(strip(content)).toMatch(/^ {2}→ hello world/);
    expect(strip(content).indexOf('hello world')).toBe(4);
    expect(content).not.toContain('Plan, search, build anything');
  });

  test('continuation rows keep the reference indent and no glyph', () => {
    const { editor } = editorHarness();
    editor.addToHistory('first\nsecond');
    editor.handleInput('\x1b[A');
    const rows = editor.render(60).map(strip);
    expect(rows[1]).toMatch(/^ {2}→ first/);
    expect(rows[2]).toMatch(/^ {4}second/);
    expect(rows[2]).not.toContain('→');
  });

  test('wrapped input keeps the glyph and the reference marker inside the pane', () => {
    const { editor } = editorHarness();
    editor.setText('w'.repeat(80));
    const lines = editor.render(24);
    expect(lines.map(strip).some((row) => row.startsWith('  → w'))).toBe(true);
    expect(lines.some((line) => line.includes(CURSOR_MARKER))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) === 24)).toBe(true);
  });
});

describe('SkinStyleEditor layout', () => {
  test("glyph and text columns follow Pi's clamped padding across the width ladder", () => {
    const { editor } = editorHarness();
    editor.setText('h');
    for (const width of [5, 6, 7, 8, 9, 12, 24, 40, 110, 200]) {
      const line = editor.render(width)[1] ?? '';
      const padding = Math.min(4, Math.floor((width - 1) / 2));
      expect(strip(line).indexOf('h'), `text column at width ${width}`).toBe(padding);
      expect(strip(line).includes('→'), `glyph at width ${width}`).toBe(padding >= 1);
      expect(visibleWidth(line), `row width at width ${width}`).toBe(width);
    }
  });

  test('below the band threshold the editor delegates to Pi', () => {
    const { editor } = editorHarness();
    const lines = editor.render(4);
    expect(lines.every((line) => visibleWidth(line) <= 4)).toBe(true);
    expect(lines.some((line) => line.includes('▄'))).toBe(false);
  });

  test('scrolled input keeps its visible rows plain so the glyph is not read as a fresh prompt', () => {
    const { editor } = editorHarness({ rows: 20 });
    const text = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n');
    editor.setText(text);
    const lines = editor.render(60);
    expect(strip(lines[0] ?? ''), 'the frame is scrolled above the first input row').toContain('↑');
    expect(lines.map(strip).some((line) => line.includes('→'))).toBe(false);
    expect(lines.every((line) => visibleWidth(line) === 60)).toBe(true);
  });
});

describe('SkinStyleEditor shell, scrolling', () => {
  test('leaves the band in whatever accent Pi set for a shell prefix', () => {
    const { editor } = editorHarness();
    editor.setText('!ls');
    // Pi repaints the editor border in its bash accent once the text starts with `!`.
    editor.borderColor = (text) => `X${text}`;
    const shellLine = editor.render(60)[0] ?? '';
    expect(shellLine).toMatch(/^ X/);
    expect(strip(shellLine).trim()).toMatch(/^X/);
    expect(strip(shellLine)).toContain('▄');
    expect(strip(editor.render(60)[1] ?? '')).toMatch(/^ {2}→ !ls/);

    editor.setText('plain');
    const idleLine = editor.render(60)[0] ?? '';
    expect(idleLine).not.toContain('X');
    expect(strip(idleLine).trim()).toBe('▄'.repeat(58));
  });

  test('text accessors round trip', () => {
    const { editor } = editorHarness();
    expect(editor.getText()).toBe('');
    editor.setText('a\nb');
    expect(editor.getText()).toBe('a\nb');
  });
});

describe('SkinStyleEditor running state', () => {
  test('running editor keeps the hidden-line indicator in the bottom band', () => {
    const { editor, store } = editorHarness({ rows: 20 });
    const text = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n');
    editor.addToHistory(text);
    editor.handleInput('\x1b[A');

    const bottom = (): string => {
      const lines = editor.render(60);
      return strip(lines[lines.length - 1] ?? '');
    };
    expect(bottom()).toContain('more');

    store.setAgentRunning(1);
    // The reference shows its right placeholder only while the input is empty.
    expect(bottom()).toContain('more');
    expect(bottom()).not.toContain('esc to stop');
    const rendered = editor.render(60);
    expect(visibleWidth(rendered[rendered.length - 1] ?? '')).toBe(60);
  });

  test('accepts text through the Pi input handler', () => {
    const { editor } = editorHarness();

    editor.handleInput('hello');
    editor.handleInput('\x1b[D');
    editor.handleInput('!');

    expect(editor.getText()).toBe('hell!o');
  });

  test('fits the running prompt into a narrow width', () => {
    const { editor, store } = editorHarness();
    store.setAgentRunning(1);

    const lines = editor.render(20).map(strip);

    expect(lines).toEqual([' ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ ', '  → Add a follow-…  ', ' ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ']);
  });

  test('unfocused editor omits the reference marker', () => {
    const { editor } = editorHarness();
    editor.focused = false;
    const content = editor.render(60)[1] ?? '';
    expect(content).not.toContain(CURSOR_MARKER);
    expect(strip(content)).toContain('→ Plan, search, build anything');
    expect(strip(content).indexOf('→')).toBe(2);
    expect(visibleWidth(content)).toBe(60);
  });
});

describe('SkinStyleEditor narrow widths', () => {
  test('drops the stop hint when the row cannot fit it', () => {
    const { editor, store } = editorHarness();
    store.setAgentRunning(1);
    const lines = editor.render(12);
    expect(lines.some((line) => line.includes('esc to stop'))).toBe(false);
    expect(lines.every((line) => visibleWidth(line) === 12)).toBe(true);
  });

  test('idle band is drawn in the composer fill role', () => {
    const { editor } = editorHarness();
    const lines = editor.render(60);
    expect(lines[0]).toContain(`${ANSI.borderMuted}▄`);
    expect(lines[2]).toContain(`${ANSI.borderMuted}▀`);
  });

  test('keeps the text column aligned with the padding Pi subtracts for mouse hits', () => {
    const { editor } = editorHarness();
    editor.setText('hello world');
    expect(editor.getPaddingX()).toBe(4);
    expect(strip(editor.render(60)[1] ?? '').indexOf('hello world')).toBe(editor.getPaddingX());
  });
});

describe('SkinStyleEditor padding, band geometry', () => {
  test('turns a host setPaddingX into indent the text column still matches', () => {
    for (const userPadding of [0, 1, 3]) {
      const { editor } = editorHarness();
      editor.setText('hello world');
      // Pi re-applies the editorPaddingX setting to whichever editor is mounted.
      editor.setPaddingX(userPadding);
      expect(editor.getPaddingX()).toBe(4 + userPadding);
      expect(strip(editor.render(40)[1] ?? '').indexOf('hello world')).toBe(editor.getPaddingX());
    }
  });
});

describe('SkinStyleEditor row geometry', () => {
  test('every row is exactly the requested width across a width sweep', () => {
    const { editor, store } = editorHarness();
    for (const width of [6, 8, 12, 20, 40, 79, 120, 200]) {
      for (const running of [false, true]) {
        if (running) store.setAgentRunning(1);
        else store.setAgentIdle();
        const lines = editor.render(width);
        expect(
          lines.every((line) => visibleWidth(line) === width),
          `width ${width} running ${running}`,
        ).toBe(true);
      }
    }
  });

  test('leaves one column of margin each side of the band', () => {
    const { editor } = editorHarness();
    const lines = editor.render(40).map(strip);
    const [top, bottom] = [lines[0] ?? '', lines[lines.length - 1] ?? ''];
    expect(top).toMatch(/^ /);
    expect(top).toMatch(/ $/);
    expect(top.trim()).toBe('▄'.repeat(38));
    expect(bottom.trim()).toBe('▀'.repeat(38));
    expect(bandText(lines, '▄').length).toBe(1);
    expect(bandText(lines, '▀').length).toBe(1);
  });

  test('factory builds an editor bound to the store', () => {
    const store = createPresentationStore();
    const ctx = { ui: { theme: { fg: (_color: string, text: string) => text } } } as never;
    let synced = 0;
    const build = createEditorFactory(ctx, store, () => {
      synced += 1;
    });
    const tui = { requestRender: () => {}, terminal: { rows: 40, columns: 120 } } as never;
    const editor = build(tui, { borderColor: (text: string) => text } as never, new KeybindingsManager(TUI_KEYBINDINGS as never) as never);
    store.setAgentRunning(1);
    expect(editor.render(60)[1]).toContain('Add a follow-up');
    expect(synced).toBe(1);
    editor.render(60);
    expect(synced).toBe(2);
  });
});
