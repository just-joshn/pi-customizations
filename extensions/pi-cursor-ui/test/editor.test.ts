import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { createPresentationStore } from '../src/state/presentation-store.ts';
import { CursorStyleEditor, createEditorFactory } from '../src/ui/editor.ts';

const ANSI = {
  success: '\u001b[32m',
  borderAccent: '\u001b[35m',
  dim: '\u001b[90m',
} as const;

const ESC = '\x1b';
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function styled(color: keyof typeof ANSI, text: string): string {
  return `${ANSI[color]}${text}\u001b[0m`;
}

function editorHarness(options: { borderColor?: (text: string) => string; rows?: number } = {}) {
  const store = createPresentationStore();
  const tui = { requestRender: () => {}, terminal: { rows: options.rows ?? 40, columns: 120 } } as never;
  const editorTheme = { borderColor: options.borderColor ?? ((text: string) => text) } as never;
  const appTheme = { fg: (color: keyof typeof ANSI, text: string) => styled(color, text) } as never;
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS as never) as never;
  const editor = new CursorStyleEditor(tui, editorTheme, keybindings, store, appTheme);
  editor.focused = true;
  return { editor, store };
}

describe('CursorStyleEditor', () => {
  test('idle empty editor shows the idle placeholder', () => {
    const { editor } = editorHarness();
    const lines = editor.render(60);
    expect(lines.length).toBe(3);
    expect(lines[1]?.includes('→ Ask, build, or change anything')).toBe(true);
    expect(lines[1]?.includes(CURSOR_MARKER)).toBe(true);
    expect(visibleWidth(lines[1] ?? '')).toBe(60);
  });

  test('running empty editor shows the follow-up placeholder', () => {
    const { editor, store } = editorHarness();
    store.setAgentRunning(1);
    const lines = editor.render(60);
    expect(lines[1]?.includes('→ Add a follow-up')).toBe(true);
    expect(lines[2]?.includes('esc to stop')).toBe(true);
    expect(visibleWidth(lines[2] ?? '')).toBe(60);
  });

  test('typed text replaces the placeholder', () => {
    const { editor } = editorHarness();
    editor.setText('hello world');
    const content = editor.render(60)[1] ?? '';
    expect(content.includes('hello world')).toBe(true);
    expect(content.includes('Ask, build, or change anything')).toBe(false);
  });

  test('text accessors round trip', () => {
    const { editor } = editorHarness();
    expect(editor.getText()).toBe('');
    editor.setText('a\nb');
    expect(editor.getText()).toBe('a\nb');
  });

  test('running editor keeps the hidden-line indicator in the bottom border', () => {
    const { editor, store } = editorHarness({ rows: 20 });
    const text = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n');
    (editor as unknown as { setTextInternal(text: string, cursor: 'start' | 'end'): void }).setTextInternal(text, 'start');
    const strip = (line: string): string => line.replace(ANSI_PATTERN, '');

    const bottom = (): string => {
      const lines = editor.render(60);
      return strip(lines[lines.length - 1] ?? '');
    };
    const idle = bottom();
    expect(idle).toContain('more');

    store.setAgentRunning(1);
    const running = bottom();
    expect(running).toContain('more');
    expect(running).toContain('esc to stop');
    const rendered = editor.render(60);
    expect(visibleWidth(rendered[rendered.length - 1] ?? '')).toBe(60);
  });

  test('inherits the pi input handler', () => {
    expect(Object.hasOwn(CursorStyleEditor.prototype, 'handleInput')).toBe(false);
    expect(CursorStyleEditor.prototype.handleInput).toBe(CustomEditor.prototype.handleInput);
  });

  test('fits every line into a narrow width', () => {
    const { editor, store } = editorHarness();
    store.setAgentRunning(1);
    const lines = editor.render(20);
    expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
  });

  test('unfocused editor omits the cursor marker', () => {
    const { editor } = editorHarness();
    editor.focused = false;
    const content = editor.render(60)[1] ?? '';
    expect(content.includes(CURSOR_MARKER)).toBe(false);
    expect(content.includes('→ Ask, build, or change anything')).toBe(true);
    expect(visibleWidth(content)).toBe(60);
  });

  test('drops the stop hint when the rule cannot fit', () => {
    const { editor, store } = editorHarness();
    store.setAgentRunning(1);
    const lines = editor.render(10);
    expect(lines[2]).toBe(styled('borderAccent', '──────────'));
    expect(lines.some((line) => line.includes('esc to stop'))).toBe(false);
  });

  test('idle editor draws both borders in the success green', () => {
    const { editor } = editorHarness();
    const lines = editor.render(60);
    expect(lines[0]?.startsWith(ANSI.success)).toBe(true);
    expect(lines[2]?.startsWith(ANSI.success)).toBe(true);
  });

  test('running editor draws both borders in the accent color', () => {
    const { editor, store } = editorHarness();
    store.setAgentRunning(1);
    const lines = editor.render(60);
    expect(lines[0]?.startsWith(ANSI.borderAccent)).toBe(true);
    expect(lines[2]?.startsWith(ANSI.borderAccent)).toBe(true);
  });

  test('bash mode keeps the border color the editor was given', () => {
    const bashBorder = (text: string) => `BASH${text}`;
    const { editor } = editorHarness({ borderColor: bashBorder });
    editor.setText('!ls');
    const lines = editor.render(60);
    expect(lines[0]?.startsWith('BASH')).toBe(true);
    expect(lines[2]?.startsWith('BASH')).toBe(true);
  });

  test('factory builds an editor bound to the store', () => {
    const store = createPresentationStore();
    const ctx = { ui: { theme: { fg: (_color: string, text: string) => text } } } as never;
    const build = createEditorFactory(ctx, store);
    const tui = { requestRender: () => {}, terminal: { rows: 40, columns: 120 } } as never;
    const editor = build(tui, { borderColor: (text: string) => text } as never, new KeybindingsManager(TUI_KEYBINDINGS as never) as never);
    store.setAgentRunning(1);
    expect(editor.render(60)[1]?.includes('→ Add a follow-up')).toBe(true);
  });
});
