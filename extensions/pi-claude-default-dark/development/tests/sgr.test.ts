import { describe, expect, test } from 'vitest';
import { cellWidth, parseCapture } from '../lib/sgr.ts';

const ESC = '\x1b';

describe('parseCapture', () => {
  test('keeps foreground and background as separate directions', () => {
    const [run] = parseCapture(`${ESC}[38;2;248;248;242m${ESC}[48;2;2;40;0m+ added${ESC}[0m\n`);
    expect(run).toMatchObject({ text: '+ added', style: { fg: { kind: 'rgb', hex: '#f8f8f2' }, bg: { kind: 'rgb', hex: '#022800' } } });
  });

  test('records 256-color and ANSI16 codes without resolving them', () => {
    const runs = parseCapture(`${ESC}[38;5;174ma${ESC}[34mb\n`);
    expect(runs.map((r) => r.style.fg)).toEqual([
      { kind: 'ansi256', index: 174 },
      { kind: 'ansi256', index: 4 },
    ]);
  });

  test('tracks attributes and their resets', () => {
    const runs = parseCapture(`${ESC}[1mbold${ESC}[22m${ESC}[2mdim${ESC}[22m${ESC}[3;4mit${ESC}[23;24mplain${ESC}[7mrev\n`);
    expect(
      runs.map((r) => [
        r.text,
        Object.entries(r.style.attrs)
          .filter(([, on]) => on)
          .map(([k]) => k),
      ]),
    ).toEqual([
      ['bold', ['bold']],
      ['dim', ['dim']],
      ['it', ['italic', 'underline']],
      ['plain', []],
      ['rev', ['inverse']],
    ]);
  });

  test('carries style across lines until reset, as tmux emits it', () => {
    const runs = parseCapture(`${ESC}[38;2;1;2;3mone\ntwo${ESC}[39m\nthree\n`);
    expect(runs.map((r) => [r.row, r.text, r.style.fg.kind])).toEqual([
      [0, 'one', 'rgb'],
      [1, 'two', 'rgb'],
      [2, 'three', 'default'],
    ]);
  });

  test('marks OSC 8 hyperlinked text and drops the link escape itself', () => {
    const runs = parseCapture(`see ${ESC}]8;id=x;https://example.com${ESC}\\docs${ESC}]8;;${ESC}\\ now\n`);
    expect(runs.map((r) => [r.text, r.style.link])).toEqual([
      ['see ', false],
      ['docs', true],
      [' now', false],
    ]);
  });

  test('advances columns by display width for wide characters', () => {
    const runs = parseCapture(`日本${ESC}[1mX\n`);
    expect(runs.map((r) => [r.text, r.col, r.width])).toEqual([
      ['日本', 0, 4],
      ['X', 4, 1],
    ]);
  });

  test.for([`${ESC}[38;3;1m`, `${ESC}[53m`, `${ESC}[?25l`])('fails closed on unsupported escape %j', (sequence) => {
    expect(() => parseCapture(`${sequence}x\n`)).toThrow();
  });
});

describe('parseCapture line endings and colon colors', () => {
  test('CRLF line endings leave no carriage-return cells', () => {
    const runs = parseCapture('\x1b[48;2;61;1;0mab\r\ncd\r\n');
    expect(runs.map((run) => run.text)).toEqual(['ab', 'cd']);
  });
  test('colon-form colors fail closed instead of being misread', () => {
    expect(() => parseCapture('\x1b[38:2::255:0:0mx\n')).toThrow();
  });
});

describe('parseCapture trailing blanks', () => {
  test('drops trailing spaces that a terminal would show as empty, as tmux capture-pane does without -N', () => {
    const runs = parseCapture('\x1b[31mred\x1b[39m   \x1b[0m\n');
    expect(runs.map((run) => run.text)).toEqual(['red']);
  });
  test('keeps trailing spaces that paint a background', () => {
    const runs = parseCapture('ab\x1b[48;2;61;1;0m    \x1b[0m   \n');
    expect(runs.map((run) => run.text)).toEqual(['ab', '    ']);
  });
  test('keeps trailing inverse spaces', () => {
    expect(parseCapture('a\x1b[7m  \x1b[0m\n').map((run) => run.text)).toEqual(['a', '  ']);
  });
});

describe('cellWidth', () => {
  test.for([
    ['a', 1],
    ['中', 2],
    ['한', 2],
    ['🚀', 2],
    ['\u0301', 0],
  ] satisfies [string, number][])('%s is %i cells', ([char, width]) => {
    expect(cellWidth(char)).toBe(width);
  });
});
