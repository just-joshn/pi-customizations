import { Theme, type ThemeColor, type ToolRenderers } from '@earendil-works/pi-coding-agent';
import { Box, stripTerminalSequences, Text, visibleWidth } from '@earendil-works/pi-tui';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { adaptRenderers, RestyleComponent, restyleLines, THEME } from '../../extensions/adapters/restyle.ts';
import { parse } from '../../extensions/adapters/sgr.ts';
import reference from '../../themes/claude-default-dark.json' with { type: 'json' };

const makeTheme = (mode: 'truecolor' | '256color' = 'truecolor', name = 'claude-default-dark') =>
  new Theme({ ...reference.colors, toolDiffAdded: '#50c850', toolDiffRemoved: '#dc5a5a' }, reference.colors, mode, { name, appearance: 'dark' });
const context = { expanded: true, isError: false, isPartial: false };
const ESC = '\x1b';
const options = { seed: 20261113, numRuns: 1000 };
const word = fc.array(fc.constantFrom('a', 'b', ' ', '日', '🚀', 'é', 'e\u0301', '\t', '1', '_', '='), { maxLength: 20 }).map((chars) => chars.join('').replaceAll('\t', '   '));
const scenarios = fc.record({ old: fc.array(word, { minLength: 1, maxLength: 4 }), next: fc.array(word, { minLength: 1, maxLength: 4 }), path: word, output: word, width: fc.integer({ min: 30, max: 120 }) });

function rendered(data: { old: string[]; next: string[]; path: string; output: string; width: number }, theme: Theme) {
  const diff = [theme.fg('toolDiffContext', ' 1 context'), ...data.old.map((text, index) => theme.fg('toolDiffRemoved', `-${index + 2} ${text}`)), ...data.next.map((text, index) => theme.fg('toolDiffAdded', `+${index + 2} ${text}`))];
  return [
    { tool: 'edit', slot: 'result' as const, lines: diff, context },
    { tool: 'read', slot: 'call' as const, lines: [`${theme.fg('toolTitle', '\x1b[1mread\x1b[22m')} ${theme.fg('accent', data.path)}`], context },
    { tool: 'bash', slot: 'result' as const, lines: [theme.fg('toolOutput', data.output), theme.fg('muted', 'Took 0.0s')], context: { ...context, isError: true } },
    { tool: 'bash', slot: 'call' as const, lines: [theme.fg('toolTitle', theme.bold(`$ ${data.output}`))], context: { ...context, expanded: false } },
  ];
}

const stripAnsi = stripTerminalSequences;
const boxed = (text: string, pad: number, width: number) => {
  const box = new Box(pad, 0);
  box.addChild(new Text(text, 0, 0));
  return box.render(width);
};
const inverseGutter = (text: string) => text.replace(/^(\s*\d+ )([+\- ])/u, (_whole, number: string, sign: string) => sign + number);

test('P1/P2/P4 preserve text and terminal width modulo the reversible diff gutter', () => {
  fc.assert(
    fc.property(scenarios, (data) => {
      const theme = makeTheme();
      for (const scenario of rendered(data, theme)) {
        const input = new Text(scenario.lines.join('\n'), 0, 0).render(data.width);
        const output = restyleLines(input, scenario.tool, scenario.slot, theme, scenario.context);
        expect(output).toHaveLength(input.length);
        output.forEach((line, index) => {
          const source = input[index] ?? '';
          const actual = stripAnsi(line);
          expect(scenario.tool === 'edit' ? inverseGutter(actual) : actual).toBe(stripAnsi(source));
          expect(visibleWidth(line)).toBe(visibleWidth(source));
          expect(visibleWidth(line)).toBeLessThanOrEqual(data.width);
        });
      }
    }),
    options,
  );
});

test('P3 inactive wrappers return the original component in both renderer slots', () => {
  fc.assert(
    fc.property(word, (text) => {
      const inner = new Text(text, 0, 0);
      const base: ToolRenderers = { renderCall: () => inner, renderResult: () => inner };
      const theme = makeTheme('truecolor', 'dark');
      const renderContext = {
        ...context,
        args: {},
        toolCallId: 'x',
        invalidate() {},
        lastComponent: undefined,
        state: {},
        cwd: '/',
        executionStarted: true,
        argsComplete: true,
        showImages: false,
        durationMs: 1,
        outputPad: 1,
        keyText: () => '',
        keyHint: () => '',
      };
      const wrapped = adaptRenderers('bash', base);
      expect(wrapped?.renderCall?.({}, theme, renderContext)).toBe(inner);
      expect(wrapped?.renderResult?.({ content: [], details: {} }, { expanded: true, isPartial: false }, theme, renderContext)).toBe(inner);
      expect(restyleLines([text], 'bash', 'result', theme, { ...context, isError: true })).toEqual([text]);
    }),
    options,
  );
});

test('P5 adapters are idempotent', () => {
  fc.assert(
    fc.property(scenarios, (data) => {
      const theme = makeTheme();
      for (const s of rendered(data, theme)) {
        const once = restyleLines(s.lines, s.tool, s.slot, theme, s.context);
        expect(restyleLines(once, s.tool, s.slot, theme, s.context)).toEqual(once);
      }
    }),
    options,
  );
});

test('P6/P9 transformed lines finish at default SGR state and use the export vocabulary', () => {
  fc.assert(
    fc.property(scenarios, (data) => {
      const theme = makeTheme();
      for (const s of rendered(data, theme)) {
        for (const line of restyleLines(s.lines, s.tool, s.slot, theme, s.context)) {
          const final = parse(`${line}x`).at(-1);
          expect(final).toMatchObject({ fg: '\x1b[39m', bg: '\x1b[49m', bold: false, dim: false, italic: false, underline: false, inverse: false });
          for (const match of line.matchAll(new RegExp(`${ESC}\\[([0-9;]*)m`, 'g'))) {
            expect(match[1]).toMatch(/^(?:0|1|2|3|4|22|23|24|39|49|(?:38|48);(?:2;\d+;\d+;\d+|5;\d+))$/);
          }
        }
      }
    }),
    options,
  );
});

test('P7 foreign renderer output without theme-role escapes is byte-identical', () => {
  fc.assert(
    fc.property(word, (text) => {
      const foreign = `\x1b[38;2;1;2;3m${text}\x1b[0m`;
      const theme = makeTheme();
      for (const tool of ['read', 'edit', 'bash']) {
        for (const slot of ['call', 'result'] as const) expect(restyleLines([foreign], tool, slot, theme, { ...context, expanded: false, isError: true })).toEqual([foreign]);
      }
    }),
    options,
  );
});

test('P8 256-color mode never emits truecolor', () => {
  fc.assert(
    fc.property(scenarios, (data) => {
      const theme = makeTheme('256color');
      for (const s of rendered(data, theme)) expect(restyleLines(s.lines, s.tool, s.slot, theme, s.context).join('\n')).not.toMatch(new RegExp(`${ESC}\\[(?:38|48);2;`));
    }),
    options,
  );
});

test('single-line inverse changes become stronger backgrounds and N by N pairs gain word highlights', () => {
  const theme = makeTheme();
  const lines = [theme.fg('toolDiffRemoved', '-2 const n = 3;'), theme.fg('toolDiffRemoved', '-3 old();'), theme.fg('toolDiffAdded', '+2 const n = 5;'), theme.fg('toolDiffAdded', '+3 next();')];
  const styled = restyleLines(lines, 'edit', 'result', theme, context);
  expect(styled[0]).toContain('\x1b[48;2;92;2;0m');
  expect(styled[2]).toContain('\x1b[48;2;4;71;0m');
  const inverse = theme.fg('toolDiffRemoved', '-2 old \x1b[7mword\x1b[27m');
  expect(restyleLines([inverse], 'edit', 'result', theme, context)[0]).toContain('\x1b[48;2;92;2;0m');
});

test('changed rows and their wrapped continuations carry the line background up to the right padding', () => {
  const long = fc.array(fc.constantFrom('alpha', 'beta', '日本', '🚀', 'x_y', '=', '(i)'), { minLength: 1, maxLength: 24 }).map((words) => words.join(' '));
  fc.assert(
    fc.property(fc.array(long, { minLength: 1, maxLength: 3 }), fc.array(long, { minLength: 1, maxLength: 3 }), fc.integer({ min: 20, max: 100 }), fc.integer({ min: 0, max: 2 }), (old, next, width, pad) => {
      const theme = makeTheme();
      const body = [theme.fg('toolDiffContext', ' 1 context'), ...old.map((text, index) => theme.fg('toolDiffRemoved', `-${index + 2} ${text}`)), ...next.map((text, index) => theme.fg('toolDiffAdded', `+${index + 2} ${text}`))].join('\n');
      const input = boxed(body, pad, width);
      const output = restyleLines(input, 'edit', 'result', theme, context);
      const lineBg = new Set(['\x1b[48;2;61;1;0m', '\x1b[48;2;2;40;0m']);
      let sign = '';
      input.forEach((source, index) => {
        const head = /^\s*([+\- ])\d+ /.exec(stripAnsi(source))?.[1];
        if (head !== undefined) sign = head;
        const cells = parse(output[index] ?? '');
        expect(visibleWidth(output[index] ?? '')).toBe(width);
        if (sign !== '+' && sign !== '-') return;
        const painted = cells.slice(pad, cells.length - pad);
        expect(painted.length).toBeGreaterThan(0);
        expect(painted.every((cell) => lineBg.has(cell.bg) || cell.bg === '\x1b[48;2;92;2;0m' || cell.bg === '\x1b[48;2;4;71;0m')).toBe(true);
        expect([...cells.slice(0, pad), ...cells.slice(cells.length - pad)].every((cell) => !lineBg.has(cell.bg))).toBe(true);
      });
    }),
    { ...options, numRuns: 300 },
  );
});

test('word highlights follow a changed word onto the wrapped row', () => {
  const theme = makeTheme();
  const body = [theme.fg('toolDiffRemoved', '-2 same same same same old'), theme.fg('toolDiffRemoved', '-3 x'), theme.fg('toolDiffAdded', '+2 same same same same new'), theme.fg('toolDiffAdded', '+3 x')].join('\n');
  const styled = restyleLines(boxed(body, 1, 24), 'edit', 'result', theme, context);
  const strongText = (line: string | undefined, strong: string) =>
    parse(line ?? '')
      .filter((cell) => cell.bg === strong)
      .map((cell) => cell.text)
      .join('');
  expect(stripAnsi(styled[1] ?? '').trim()).toBe('old');
  expect(strongText(styled[1], '\x1b[48;2;92;2;0m')).toBe('old');
  expect(strongText(styled[0], '\x1b[48;2;92;2;0m')).toBe('');
  expect(strongText(styled[4], '\x1b[48;2;4;71;0m')).toBe('new');
});

describe('diff syntax colors', () => {
  const theme = makeTheme();
  const roles = new Map<string, ThemeColor>([
    ['export', 'syntaxKeyword'],
    ['const', 'syntaxKeyword'],
    ['return', 'syntaxKeyword'],
    ['load', 'syntaxFunction'],
    ['(arg)', 'syntaxVariable'],
    ['// note 2', 'syntaxComment'],
  ]);
  const fakeHighlight = (code: string) => [
    code.replace(/\/\/ note 2|\(arg\)|\b\w+\b/g, (token) => {
      const role = roles.get(token) ?? (/^\d+$/.test(token) ? 'syntaxNumber' : undefined);
      return role ? theme.fg(role, token) : token;
    }),
  ];
  const fgOf = (line: string | undefined, text: string) => {
    const cells = parse(line ?? '');
    const at = cells
      .map((cell) => cell.text)
      .join('')
      .indexOf(text);
    return cells[at]?.fg;
  };
  const hex = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;

  test('added and context rows take Claude diff token colors, removed rows stay plain', () => {
    const lines = [theme.fg('toolDiffContext', ' 1 export load(arg) // note 2'), theme.fg('toolDiffRemoved', '-2 const n = 3;'), theme.fg('toolDiffAdded', '+2 return 5;')];
    const styled = restyleLines(lines, 'edit', 'call', theme, context, fakeHighlight);
    expect(fgOf(styled[0], 'export')).toBe(hex(249, 38, 114));
    expect(fgOf(styled[0], 'load')).toBe(hex(166, 226, 46));
    expect(fgOf(styled[0], 'arg')).toBe(hex(166, 226, 46));
    expect(fgOf(styled[0], 'note')).toBe(hex(248, 248, 242));
    expect(
      parse(styled[0] ?? '')
        .filter((cell) => cell.text === '2')
        .at(-1)?.fg,
    ).toBe(hex(248, 248, 242));
    expect(fgOf(styled[0], '(')).toBe(hex(248, 248, 242));
    expect(fgOf(styled[1], 'const')).toBe(hex(248, 248, 242));
    expect(fgOf(styled[1], '3')).toBe(hex(248, 248, 242));
    expect(fgOf(styled[2], 'return')).toBe(hex(249, 38, 114));
    expect(fgOf(styled[2], '5')).toBe(hex(190, 132, 255));
    expect(parse(styled[2] ?? '').find((cell) => cell.text === '5')?.bg).toBe('\x1b[48;2;2;40;0m');
  });

  test('a failing highlighter leaves plain diff text', () => {
    const styled = restyleLines([theme.fg('toolDiffAdded', '+2 return 5;')], 'edit', 'call', theme, context, () => {
      throw new Error('no theme');
    });
    expect(fgOf(styled[0], 'return')).toBe(hex(248, 248, 242));
  });
});

describe('wrapped diff rows', () => {
  const theme = makeTheme();
  const plain = (line: string | undefined) => stripAnsi(line ?? '').trimEnd();

  test('a wrapped removed row that starts like "-2 " stays a continuation', () => {
    const body = [theme.fg('toolDiffRemoved', '-3 aaaaaaaaaaaaaaa -2 xyz'), theme.fg('toolDiffAdded', '+3 b')].join('\n');
    const styled = restyleLines(boxed(body, 0, 20), 'edit', 'result', theme, context);
    expect(plain(styled[1])).toBe('-2 xyz');
    expect(parse(styled[1] ?? '').at(0)?.bg).toBe('\x1b[48;2;61;1;0m');
  });

  test('a real next row after a full row is still a head', () => {
    const body = [theme.fg('toolDiffRemoved', '-3 aaaaaaaaaaaaaaaa'), theme.fg('toolDiffRemoved', '-4 xyz')].join('\n');
    const styled = restyleLines(boxed(body, 0, 19), 'edit', 'result', theme, context);
    expect(plain(styled[1])).toBe('4 -xyz');
  });

  test('a long word broken across rows is highlighted as one word', () => {
    const theme2 = makeTheme();
    const long = 'abcdefghijklmnopqrstuvwxyz';
    const hl = (code: string) => [code.replace(new RegExp(long), (word) => theme2.fg('syntaxKeyword', word))];
    const styled = restyleLines(boxed(theme2.fg('toolDiffAdded', `+2 ${long}`), 0, 20), 'edit', 'result', theme2, context, hl);
    const keyword = '\x1b[38;2;249;38;114m';
    const colored = styled
      .flatMap((line) =>
        parse(line)
          .filter((cell) => cell.fg === keyword)
          .map((cell) => cell.text),
      )
      .join('');
    expect(colored).toBe(long);
  });

  test('syntax colors stay aligned after an emoji', () => {
    const hl = (code: string) => [code.replace(/\breturn\b/, (word) => theme.fg('syntaxKeyword', word))];
    const styled = restyleLines([theme.fg('toolDiffAdded', '+2 🚀 return x;')], 'edit', 'result', theme, context, hl);
    const keyword = '\x1b[38;2;249;38;114m';
    expect(
      parse(styled[0] ?? '')
        .filter((cell) => cell.fg === keyword)
        .map((cell) => cell.text)
        .join(''),
    ).toBe('return');
  });
});

test('wrapper forwards invalidation and falls back to the exact raw lines on unknown escapes', () => {
  let invalidations = 0;
  const lines = ['\x1b[9mforeign\x1b[29m'];
  const input: string[] = [];
  const wrapper = new RestyleComponent(
    {
      render: () => lines,
      invalidate: () => {
        invalidations++;
      },
      handleInput: (data) => {
        input.push(data);
      },
      wantsKeyRelease: true,
      capturesViewportInput: true,
    },
    () => {
      throw new Error('unknown');
    },
  );
  expect(wrapper.render(80)).toBe(lines);
  wrapper.invalidate();
  expect(invalidations).toBe(1);
  wrapper.handleInput('x');
  expect(input).toEqual(['x']);
  expect(wrapper.wantsKeyRelease).toBe(true);
  expect(wrapper.capturesViewportInput).toBe(true);
});

test('wrapper reuses its result while the inner lines and width are unchanged', () => {
  let current = ['a', 'b'];
  let transforms = 0;
  const wrapper = new RestyleComponent({ render: () => [...current], invalidate: () => {} }, (lines) => {
    transforms++;
    return lines.map((line) => `${line}!`);
  });
  const first = wrapper.render(80);
  expect(wrapper.render(80)).toBe(first);
  expect(transforms).toBe(1);
  expect(wrapper.render(60)).toEqual(['a!', 'b!']);
  expect(transforms).toBe(2);
  current = ['a', 'c'];
  expect(wrapper.render(60)).toEqual(['a!', 'c!']);
  expect(transforms).toBe(3);
  wrapper.invalidate();
  wrapper.render(60);
  expect(transforms).toBe(4);
});

test('wrapper recomputes when the active theme changes without an invalidation', () => {
  const theme = { name: THEME };
  const wrapper = new RestyleComponent(
    { render: () => ['x'], invalidate: () => {} },
    (lines) => (theme.name === THEME ? lines.map((line) => `${line}!`) : lines),
    () => theme.name,
  );
  expect(wrapper.render(80)).toEqual(['x!']);
  theme.name = 'dark';
  expect(wrapper.render(80)).toEqual(['x']);
});
