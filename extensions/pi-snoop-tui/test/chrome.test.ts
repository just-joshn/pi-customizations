import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { buildEditor, createSession, loadSnoop, loadTheme, mountHeader, plainLines, ROOT_PATH, THEME_NAMES } from './harness.ts';

const NARROW = 80;
const SWEEP = 120;
const HEADER_LINES = 3;
const MIN_GUTTER_WIDTH = 3;
const LAST_HEADER_WIDTH = 119;
const ROOM_FOR_NAME = 6;
const ONE_COLUMN = 1;
const WIDE_CWD = '/project/workspace 漢字 🙂';
const TAB_CWD = '/p/a\tb';
const theme = loadTheme('snoop-dark');

describe('header', () => {
  test.for(THEME_NAMES)('shows the workspace folder under a blank line in %s', (name) => {
    const header = mountHeader(loadSnoop(), createSession(loadTheme(name)));
    expect(plainLines(header.render(NARROW))).toEqual(['', ' pi / workspace', '']);
  });

  test('colors the product name, the divider and the folder differently', () => {
    const header = mountHeader(loadSnoop(), createSession(theme));
    expect(header.render(NARROW)[1]).toBe(` ${theme.fg('accent', 'pi')}${theme.fg('dim', ' / ')}${theme.fg('muted', 'workspace')}`);
  });

  test('keeps the gutter, shortens wide text and never overflows at any width', () => {
    const header = mountHeader(loadSnoop(), createSession(theme, { cwd: WIDE_CWD }));
    for (let width = 0; width < SWEEP; width++) {
      const lines = header.render(width);
      expect(lines).toHaveLength(HEADER_LINES);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      if (width >= MIN_GUTTER_WIDTH) expect(plainLines(lines)[1]).toMatch(/^ \S/);
      if (width >= MIN_GUTTER_WIDTH) expect(visibleWidth(lines[1] ?? '')).toBeLessThanOrEqual(width - 1);
    }
  });

  test('shows only the product name when there is no room for a folder, and an ellipsis when even that does not fit', () => {
    const header = mountHeader(loadSnoop(), createSession(theme));
    expect(plainLines(header.render(ROOM_FOR_NAME))[1]).toBe(' pi');
    expect(plainLines(header.render(MIN_GUTTER_WIDTH))[1]).toBe(' …');
    expect(plainLines(header.render(ONE_COLUMN))[1]).toBe('…');
  });

  test('names the filesystem root by its path and puts no extra spaces in a folder name with tabs', () => {
    expect(plainLines(mountHeader(loadSnoop(), createSession(theme, { cwd: ROOT_PATH })).render(NARROW))[1]).toBe(' pi / /');
    expect(plainLines(mountHeader(loadSnoop(), createSession(theme, { cwd: TAB_CWD })).render(NARROW))[1]).toBe(' pi / a  b');
  });

  test('honours the outputPad gutter and repaints identically after an invalidate', () => {
    const header = mountHeader(loadSnoop({ outputPad: 3 }), createSession(theme));
    const first = header.render(LAST_HEADER_WIDTH);
    expect(plainLines(first)[1]).toBe('   pi / workspace');
    expect(header.render(LAST_HEADER_WIDTH)).toEqual(first);
    header.invalidate();
    expect(header.render(LAST_HEADER_WIDTH)).toEqual(first);
  });
});

describe('session start', () => {
  test('does nothing when Pi has no UI', () => {
    const host = loadSnoop();
    const session = createSession(theme, { hasUI: false });
    host.fire('session_start', session.ctx);
    expect(session.ui.setHeader).not.toHaveBeenCalled();
    expect(session.ui.setEditorComponent).not.toHaveBeenCalled();
    expect(session.ui.setWorkingMessage).not.toHaveBeenCalled();
  });

  test('replaces the spinner with a quiet "working" message and a "thinking" label', () => {
    const host = loadSnoop();
    const session = createSession(theme);
    host.fire('session_start', session.ctx);
    expect(session.ui.setWorkingIndicator).toHaveBeenCalledWith({ frames: [] });
    expect(session.ui.setWorkingMessage).toHaveBeenCalledWith('working');
    expect(session.ui.setHiddenThinkingLabel).toHaveBeenCalledWith('thinking');
  });

  test('installs a working prompt editor at session start', () => {
    const host = loadSnoop();
    const session = createSession(theme);
    host.fire('session_start', session.ctx);
    expect(buildEditor(session).render(NARROW).length).toBeGreaterThan(1);
  });

  test('mounts a working prompt editor again when a new session starts', () => {
    const host = loadSnoop();
    const session = createSession(theme);
    host.fire('session_start', session.ctx);
    host.fire('session_start', session.ctx);
    expect(buildEditor(session).render(NARROW).length).toBeGreaterThan(1);
  });

  test("leaves another extension's editor in place", () => {
    const host = loadSnoop();
    const session = createSession(theme);
    const foreign = () => ({}) as never;
    session.ui.setEditorComponent(foreign);
    host.fire('session_start', session.ctx);
    expect(session.editorFactory()).toBe(foreign);
  });
});

describe('user message marker', () => {
  const host = loadSnoop();
  const transform = (markdown: string) => {
    const [transformer] = host.transformers();
    if (!transformer) throw new Error('chrome registered no markdown transformer');
    return transformer(markdown, { messageType: 'user', isStreaming: false, availableWidth: NARROW });
  };

  test('applies to user messages only', () => {
    expect(host.transformerOptions()).toEqual([{ messageTypes: ['user'] }]);
  });

  test('prefixes plain prose with a prompt marker', () => {
    expect(transform('Make the cache refresh cancelable.')).toBe('› Make the cache refresh cancelable.');
    expect(transform('Fix it\n\n- then test')).toBe('› Fix it\n\n- then test');
  });

  test.for(['# Title', '- item', '* item', '+ item', '1. step', '2) step', '> quote', '```ts\ncode\n```', '~~~\ncode', '| a | b |', '    indented code', '\tcode', '  - nested', '', '  \n'])(
    'leaves %j alone because it starts with Markdown block syntax or is blank',
    (markdown) => {
      expect(transform(markdown)).toBe(markdown);
    },
  );
});
