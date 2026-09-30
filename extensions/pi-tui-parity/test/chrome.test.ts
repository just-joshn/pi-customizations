import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { splitThemeColors } from './theme-colors.ts';

const ThemeCtor = (await import('@earendil-works/pi-coding-agent')).Theme;
type Theme = InstanceType<typeof ThemeCtor>;
const { renderHeaderLine } = await import('../src/chrome/header.ts');
const { countEditedFiles, formatContextPercent, formatContextWindow, renderFooterRows } = await import('../src/chrome/footer.ts');
const { spinnerFrames } = await import('../src/chrome/working.ts');
const { createSessionState: createState } = await import('../src/state.ts');

const themeJson = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/tui-dark.json', import.meta.url)), 'utf8'));

function darkTheme(): Theme {
  const { fg, bg } = splitThemeColors(themeJson.colors as Record<string, string>);
  return new ThemeCtor(fg as never, bg as never, 'truecolor', { name: 'tui-dark' });
}

const ESC = '\x1b';
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string) => s.replace(ANSI, '');

describe('header', () => {
  it('renders the bold title and dim version', () => {
    const theme = darkTheme();
    const line = renderHeaderLine(theme, '0.99.2');
    expect(strip(line)).toBe('pi v0.99.2');
    expect(line.includes('\x1b[1mpi')).toBe(true);
    expect(line.includes('38;2;110;110;112m')).toBe(true);
  });
});

describe('footer helpers', () => {
  it('formats context percent like the reference CLI', () => {
    expect(formatContextPercent(42, 999)).toBe('42%');
    expect(formatContextPercent(42.44, 999)).toBe('42.4%');
    expect(formatContextPercent(42.45, 999)).toBe('42.5%');
    expect(formatContextPercent(null, 1230)).toBe('1.23k');
    expect(formatContextPercent(null, null)).toBe('-');
  });

  it('formats the context window as a k summary', () => {
    expect(formatContextWindow(200000)).toBe('200k');
    expect(formatContextWindow(1000000)).toBe('1000k');
  });

  it('counts distinct edited files from assistant tool calls', () => {
    const entries = [
      {
        type: 'message',
        message: {
          role: 'assistant',
          toolCalls: [
            { name: 'edit', arguments: { path: '/a.ts' } },
            { name: 'write', arguments: { path: '/b.ts' } },
          ],
        },
      },
      { type: 'message', message: { role: 'assistant', toolCalls: [{ name: 'edit', arguments: `{"path":"/a.ts"}` }] } },
      { type: 'message', message: { role: 'assistant', toolCalls: [{ name: 'read', arguments: { path: '/c.ts' } }] } },
      { type: 'message', message: { role: 'assistant', toolCalls: [{ name: 'edit', arguments: '{not json' }] } },
      { type: 'message', message: { role: 'user', content: 'hi' } },
    ];
    expect(countEditedFiles(entries)).toBe(2);
    expect(countEditedFiles([])).toBe(0);
  });
});

describe('footer rows', () => {
  const theme = darkTheme();
  const base = {
    theme,
    modelName: 'Test Model',
    contextWindow: 200000,
    contextPercent: 42,
    contextTokens: null as number | null,
    filesEdited: 2,
    cwd: '/home/u/proj',
    home: '/home/u',
    branch: 'main' as string | undefined,
    width: 80,
  };

  it('renders headline, status row and location row', () => {
    const state = createState({ mode: 'plan', autoReview: true });
    const lines = renderFooterRows({ ...base, state });
    expect(lines.length).toBe(3);
    expect(strip(lines[0] ?? '')).toBe('  Plan (shift+tab to cycle)');
    const rowB = strip(lines[1] ?? '');
    expect(rowB.includes('Test Model · 200k')).toBe(true);
    expect(rowB.includes('42%')).toBe(true);
    expect(rowB.includes('2 files edited')).toBe(true);
    expect(rowB.includes('Auto-review')).toBe(true);
    expect(lines[1]?.includes('\x1b[35m')).toBe(true);
    expect(rowB.trimEnd().endsWith('-- INSERT --')).toBe(true);
    const rowC = strip(lines[2] ?? '');
    expect(rowC).toBe('  ~/proj · main');
  });

  it('hides headline in default mode and empty location bits when absent', () => {
    const state = createState();
    const lines = renderFooterRows({ ...base, state, branch: undefined });
    expect(lines.length).toBe(2);
    const rowC = strip(lines[1] ?? '');
    expect(rowC).toBe('  ~/proj');
  });

  it('right-aligns the right group of row B', () => {
    const state = createState({ runEverything: true });
    const lines = renderFooterRows({ ...base, state, filesEdited: 0 });
    const rowB = lines[0] ?? '';
    const rightGroup = 'Run Everything · -- INSERT --';
    const stripped = strip(rowB);
    expect(stripped.endsWith(rightGroup)).toBe(true);
    expect(stripped.length).toBe(79);
    const rightStart = strip(rowB.slice(0, rowB.indexOf('\x1b[35mRun Everything'))).length;
    expect(rightStart).toBe(79 - rightGroup.length);
  });
});

describe('working indicator', () => {
  it('colors the eight braille frames green', () => {
    const frames = spinnerFrames('truecolor', 'tui-dark');
    expect(frames.length).toBe(8);
    expect(frames.every((f) => f.includes('38;2;88;214;141m'))).toBe(true);
    expect(strip(frames[0] ?? '')).toBe('⠀⠞');
  });
});
