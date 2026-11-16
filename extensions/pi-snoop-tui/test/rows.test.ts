import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import { compactRenderers, derivePhase, layoutHeader } from '../src/rows/row.ts';
import { genericSpec, isCompactTool, type ResultInput, TOOL_SPECS } from '../src/rows/specs.ts';
import { countLines, fitPath, fitPlain, headLines, sanitizeLine, tailLines } from '../src/text.ts';
import { driveRow, output, plain, recordingNative, stubTheme } from './harness.ts';

const input = (text: string, extra: Partial<ResultInput> = {}): ResultInput => ({ args: {}, text, images: 0, details: undefined, isError: false, isPartial: false, ...extra });

describe('text', () => {
  test.for(['', 'one', 'one\n', '\n', '\n\n', 'one\r\ntwo\r\n', 'one\n\ntwo', 'a\nb\nc\nd'])('scans bounded lines in %j', (text) => {
    const expected =
      text === ''
        ? []
        : text
            .replace(/\n$/, '')
            .split('\n')
            .map((s) => s.replace(/\r$/, ''));
    expect(countLines(text)).toBe(expected.length);
    for (const max of [0, 1, 2, 5]) {
      expect(headLines(text, max)).toEqual({ lines: expected.slice(0, max), hidden: Math.max(0, expected.length - max) });
      expect(tailLines(text, max)).toEqual({ lines: max === 0 ? [] : expected.slice(-max), hidden: Math.max(0, expected.length - max) });
    }
  });
  test('bounds a large output preview', () => {
    const text = 'line\n'.repeat(1_000_000);
    expect(headLines(text, 3)).toEqual({ lines: ['line', 'line', 'line'], hidden: 999_997 });
    expect(tailLines(text, 3)).toEqual({ lines: ['line', 'line', 'line'], hidden: 999_997 });
  });
  test('sanitizes terminal output to a single line', () => {
    expect(sanitizeLine('\x1b[31mred\x1b[0m\tline\nnext')).toBe('red  line next');
  });
  test('fits wide paths and plain text over all widths', () => {
    for (const text of ['src/session/cache.ts', 'src/漢字/🙂/file.ts', 'short', 'filename-that-is-too-long.ts']) {
      for (let width = 0; width <= 120; width++) {
        expect(visibleWidth(fitPath(text, width))).toBeLessThanOrEqual(width);
        expect(visibleWidth(fitPlain(text, width))).toBeLessThanOrEqual(width);
      }
    }
    expect(fitPath('src/session/cache.ts', 15)).toBe('src/…/cache.ts');
  });
});

describe('specs', () => {
  test.for(Object.entries(TOOL_SPECS))('%s handles empty args and errors', ([name, spec]) => {
    expect(isCompactTool(name)).toBe(true);
    expect(spec.target(undefined, '/project').text).toBeTypeOf('string');
    expect(spec.target({ path: '/project/漢字.ts', pattern: 'x' }, '/project').text).toBeTypeOf('string');
    const summary = spec.summarize(input('bad\n'.repeat(10), { isError: true }));
    expect(summary.preview?.lines).toHaveLength(5);
    expect(summary.preview?.hidden).toBe(5);
  });
  test('relativizes paths and preserves native read ranges', () => {
    expect(TOOL_SPECS.read.target({ path: '/project/file', offset: 2, limit: 3 }, '/project').text).toBe('file:2-4');
    expect(TOOL_SPECS.read.target({ path: 4, offset: '2', limit: null }, '/project').text).toBe('');
    expect(TOOL_SPECS.bash.target({ command: 'echo hi\necho bye' }).text).toBe('echo hi…');
    expect(TOOL_SPECS.bash.target({ command: 'echo hi' }).text).toBe('echo hi');
    expect(TOOL_SPECS.grep.target({ pattern: 'x', path: 'src' }).text).toBe('x  src');
    expect(isCompactTool('mcp')).toBe(false);
  });
  test('summarizes line counts and notices', () => {
    expect(TOOL_SPECS.read.summarize(input('a\nb\n\n[5 more lines in file. Use offset=3 to continue.]')).meta).toBe('2 lines');
    expect(TOOL_SPECS.read.summarize(input('a', { details: { truncation: { totalLines: 10 } } })).meta).toBe('10 lines');
    expect(TOOL_SPECS.write.summarize(input('ack', { args: { content: 'a\nb\n' } })).meta).toBe('2 lines');
    expect(TOOL_SPECS.write.summarize(input('ack')).meta).toBe('0 lines');
    expect(TOOL_SPECS.edit.summarize(input('ack', { details: { patch: '--- a\n+++ b\n-a\n+b\n+c' } })).meta).toBe('+2 −1');
    expect(TOOL_SPECS.edit.summarize(input('ack')).meta).toBe('edited');
  });
  test.for([
    ['grep', 'No matches found', undefined, 'no matches'],
    ['grep', 'a\nb', { matchLimitReached: 2 }, '2+ matches'],
    ['find', 'No files found matching pattern', undefined, '0 files'],
    ['find', 'a', { resultLimitReached: 1, truncation: { totalLines: 9 } }, '9+ files'],
    ['ls', '(empty directory)', undefined, '0 entries'],
    ['ls', 'a\nb', { entryLimitReached: 2 }, '2+ entries'],
  ] as const)('counts %s results', ([tool, text, details, meta]) => {
    expect(TOOL_SPECS[tool].summarize(input(text, { details })).meta).toBe(meta);
  });
  test.for([
    ['ok', false, false, 'exit 0'],
    ['a\nb\nc\nd', false, true, undefined],
    ['fail\n\nCommand exited with code 2', true, false, 'exit 2'],
    ['fail\nCommand timed out after 5 seconds', true, false, 'timeout'],
    ['Command aborted', true, false, 'aborted'],
    ['unknown', true, false, 'failed'],
  ] as const)('summarizes bash status %s', ([text, isError, isPartial, meta]) => {
    const summary = TOOL_SPECS.bash.summarize(input(text, { isError, isPartial }));
    expect(summary.meta).toBe(meta);
    if (isPartial) expect(summary.preview?.lines).toEqual(['b', 'c', 'd']);
    if (meta === 'exit 2') expect(summary.preview?.lines).toEqual(['fail']);
  });
});

describe('rows', () => {
  test('keeps collapsed headers and expanded native panels within every width', () => {
    for (const outputPad of [0, 1, 2]) {
      const row = driveRow(compactRenderers(TOOL_SPECS.read, recordingNative()), stubTheme(), { outputPad });
      row.apply({ args: { path: '/project/a/very/long/path/漢字/🙂/filename.ts' }, result: output('one\ntwo'), isPartial: false });
      for (const expanded of [false, true]) {
        row.apply({ expanded });
        for (let width = 1; width <= 120; width++) {
          for (const line of row.lines(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  });
  test('labels image reads without counting their text as lines', () => {
    const row = driveRow(compactRenderers(TOOL_SPECS.read, {}), stubTheme());
    row.apply({
      result: {
        content: [
          { type: 'text', text: 'Read image file' },
          { type: 'image', data: '', mimeType: 'image/png' },
        ],
      },
      isPartial: false,
    });
    expect(plain(row.lines(80)[0] ?? '')).toMatch(/\simage$/);
  });
  test.for([
    ['read', '1 line'],
    ['write', '1 line'],
    ['grep', '1 match'],
    ['find', '1 file'],
    ['ls', '1 entry'],
  ] as const)('renders singular units for %s', ([tool, meta]) => {
    const row = driveRow(compactRenderers(TOOL_SPECS[tool], {}), stubTheme());
    row.apply({ args: { content: 'one' }, result: output('one'), isPartial: false });
    expect(plain(row.lines(80)[0] ?? '').trimEnd()).toMatch(new RegExp(`${meta}$`));
  });
  test.for([
    ['bash', true, false, ['… 4 earlier · ctrl+o', '5', '6', '7']],
    ['bash', false, true, ['… 2 earlier · ctrl+o', '3', '4', '5', '6', '7']],
    ['read', false, true, ['1', '2', '3', '4', '5', '… 2 more · ctrl+o']],
  ] as const)('orders %s preview hints for partial=%s error=%s', ([tool, isPartial, isError, expected]) => {
    const row = driveRow(compactRenderers(TOOL_SPECS[tool], {}), stubTheme());
    row.apply({ executionStarted: true, result: output('1\n2\n3\n4\n5\n6\n7', isError), isPartial });
    expect(
      row
        .lines(80)
        .slice(1)
        .map((line) => plain(line).trim()),
    ).toEqual(expected);
  });
  test('derives every phase flag combination', () => {
    for (const executionStarted of [false, true])
      for (const isPartial of [false, true])
        for (const isError of [false, true]) {
          expect(derivePhase({ executionStarted, isPartial, isError })).toBe(!isPartial ? (isError ? 'failed' : 'done') : executionStarted ? 'running' : 'pending');
        }
  });
  test('marks resumed results complete when Pi never fired execution start', () => {
    const row = driveRow(compactRenderers(TOOL_SPECS.read, {}), stubTheme());
    row.apply({ args: { path: 'file.ts' }, result: output('a\nb'), isPartial: false });
    expect(plain(row.lines(80)[0] ?? '')).toMatch(/^ ✓/);
    row.apply({ result: output('failed', true) });
    expect(plain(row.lines(80)[0] ?? '')).toMatch(/^ ✗/);
  });
  test('commits result metadata before the header frame and reuses cached output', () => {
    const theme = stubTheme();
    const summarize = vi.fn(TOOL_SPECS.read.summarize);
    const native = recordingNative();
    const row = driveRow(compactRenderers({ ...TOOL_SPECS.read, summarize }, native), theme);
    row.apply({ args: { path: '/project/cache.ts' }, executionStarted: true, result: output('a\nb'), isPartial: false });
    expect(plain(row.lines(80)[0] ?? '')).toMatch(/✓ {2}read\s+cache.ts\s+2 lines/);
    const calls = vi.mocked(theme.fg).mock.calls.length;
    for (let i = 0; i < 10; i++) {
      row.apply({});
      row.lines(80);
    }
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(vi.mocked(theme.fg).mock.calls).toHaveLength(calls);
    row.apply({ invalidate: true });
    row.lines(80);
    expect(vi.mocked(theme.fg).mock.calls.length).toBeGreaterThan(calls);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(native.renderCall).not.toHaveBeenCalled();
  });
  test('tolerates repeated renderCall after toggling without a result', () => {
    const row = driveRow(compactRenderers(TOOL_SPECS.bash, recordingNative()), stubTheme());
    row.apply({ args: { command: 'echo hi' } });
    const call = row.components.call;
    row.apply({ expanded: true });
    row.apply({ expanded: false });
    expect(row.components.call).toBe(call);
    expect(row.lines(80).map(plain)).toEqual([' ·  bash      echo hi']);
  });
  test('sandboxes native state and lastComponent across expand toggles', () => {
    const native = recordingNative();
    const row = driveRow(compactRenderers(TOOL_SPECS.edit, native), stubTheme());
    row.apply({ executionStarted: true, result: output('done'), isPartial: false, expanded: true });
    expect(row.lines(80).map(plain).join('\n')).toContain('NATIVE');
    row.apply({ expanded: false });
    row.apply({ expanded: true, invalidate: true });
    const [first, second] = native.resultContexts;
    expect(first?.state).not.toBe(row.state);
    expect(second?.state).toBe(first?.state);
    expect(first?.lastComponent).toBeUndefined();
    expect(second?.lastComponent).toBe(native.renderResult.mock.results[0]?.value);
    expect(second?.outputPad).toBe(0);
    expect(native.renderCall).not.toHaveBeenCalled();
  });
  test('reuses expanded lines until invalidated or resized', () => {
    const row = driveRow(compactRenderers(TOOL_SPECS.read, recordingNative()), stubTheme(), { outputPad: 2 });
    row.apply({ result: output('detail'), isPartial: false, expanded: true });
    const body = row.components.result;
    expect(body).toBeDefined();
    if (!body) throw new Error('missing result');
    const first = body.render(80);
    expect(first.map(plain).join('\n')).toContain('     NATIVE');
    expect(body.render(80)).toBe(first);
    body.invalidate();
    const invalidated = body.render(80);
    expect(invalidated).not.toBe(first);
    expect(invalidated).toEqual(first);
    const resized = body.render(40);
    expect(resized).not.toBe(invalidated);
    expect(resized.map(plain).join('\n')).toContain('     NATIVE');
  });
  test('falls back to text when a downstream renderer has no result renderer', () => {
    const row = driveRow(compactRenderers(TOOL_SPECS.read, {}), stubTheme());
    row.apply({ result: output('fallback'), expanded: true });
    expect(row.lines(80).map(plain).join('\n')).toContain('fallback');
  });
  test('bounds running tails and failed previews and fits every line', () => {
    for (const spec of [TOOL_SPECS.bash, TOOL_SPECS.read]) {
      const row = driveRow(compactRenderers(spec, recordingNative()), stubTheme(), { outputPad: 2 });
      for (const event of [
        { args: { path: '/project/漢字/🙂.ts', command: 'echo 漢字 🙂' } },
        { executionStarted: true, result: output('漢字 🙂\n'.repeat(10)) },
        { result: output('漢字 🙂\n'.repeat(10), true), isPartial: false },
        { expanded: true },
        { expanded: false },
      ]) {
        row.apply(event);
        for (let width = 1; width <= 120; width++) for (const line of row.lines(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      expect(row.lines(80).length).toBeLessThanOrEqual(7);
      expect(row.lines(80).map(plain).join('\n')).toContain('ctrl+o');
    }
  });
  test('omits preview hints when all output is visible', () => {
    const row = driveRow(compactRenderers(TOOL_SPECS.bash, {}), stubTheme());
    row.apply({ result: output('short'), executionStarted: true });
    expect(row.lines(80).map(plain)).toEqual([' •  bash      ', '    short']);
  });
  test('starts every target on one column and lets longer names overflow by their gap', () => {
    const header = (verb: string) => plain(driveRowHeader(verb));
    const column = (verb: string) => header(verb).indexOf('target');
    for (const verb of ['ls', 'read', 'write', 'codemode', 'pi_spawn', 'tmux_run']) expect(column(verb)).toBe(14);
    expect(header('mcp__github__search')).toMatch(/^ ✓ {2}mcp__github__search {2}target/);
  });
  test('drops metadata before target space', () => {
    const view = { verb: 'read', target: { kind: 'path' as const, text: 'src/cache.ts' }, meta: '142 lines' };
    expect(layoutHeader(view, 80).meta).toBe('142 lines');
    expect(layoutHeader(view, 20).meta).toBe('');
  });
});

function driveRowHeader(verb: string): string {
  const row = driveRow(compactRenderers({ ...genericSpec(verb), target: () => ({ kind: 'plain', text: 'target' }) }, {}), stubTheme());
  row.apply({ args: {}, executionStarted: true, result: output('a'), isPartial: false });
  return row.lines(100)[0] ?? '';
}

describe('row edges', () => {
  test.for([1, 2])('collapsed metadata ends one gutter (%i) from the right edge', (outputPad) => {
    const row = driveRow(compactRenderers(TOOL_SPECS.read, recordingNative()), stubTheme(), { outputPad });
    row.apply({ args: { path: '/project/src/cache.ts' }, executionStarted: true, result: output('a\nb'), isPartial: false });
    const line = plain(row.lines(100)[0] ?? '');
    expect(line.endsWith('2 lines')).toBe(true);
    expect(visibleWidth(line)).toBe(100 - outputPad);
  });
  test('expanded panels drop blank first and last native lines', () => {
    const native = { renderResult: () => ({ render: () => ['', '  ', 'PASS cache.test.ts', '', 'respects cancellation', '\x1b[0m'], invalidate: () => {} }) };
    const row = driveRow(compactRenderers(TOOL_SPECS.bash, native), stubTheme());
    row.apply({ args: { command: 'npm test' }, executionStarted: true, result: output('PASS'), isPartial: false, expanded: true });
    const body = row
      .lines(80)
      .slice(1)
      .map((line) => plain(line).trim());
    expect(body).toEqual(['PASS cache.test.ts', '', 'respects cancellation']);
  });
});

describe('generic rows', () => {
  const spec = genericSpec('tmux_run');
  test.for([
    [{ name: 'tests', command: 'bunx vitest run' }, 'bunx vitest run'],
    [{ name: 'review-3', brief: 'Review cache module 3.\n\nReport every caller.' }, 'Review cache module 3.…'],
    [{ code: 'const a  =\t1;\nreturn a;' }, 'const a = 1;…'],
    [{ limit: 3, label: 'first string', other: 'second' }, 'first string'],
    [{ path: '/project/src/cache.ts' }, 'src/cache.ts'],
    [{ count: 3, nested: { command: 'x' } }, ''],
  ] as const)('targets %j as %j', ([args, text]) => {
    expect(spec.target(args, '/project').text).toBe(text);
  });
  test('handles missing args', () => {
    expect(spec.target(undefined, '/project').text).toBe('');
  });
  test.for([
    [input('a\nb\nc\n'), '3 lines'],
    [input('a'), '1 line'],
    [input(''), '0 lines'],
    [input('', { images: 1 }), 'image'],
    [input('running', { isPartial: true }), undefined],
    [input('FAIL suite\nCommand exited with code 2', { isError: true }), 'exit 2'],
    [input('TypeError: x is not a function', { isError: true }), 'failed'],
  ] as const)('summarizes %#', ([result, meta]) => {
    expect(spec.summarize(result).meta).toBe(meta);
  });
  test('bounds the error preview to the first lines', () => {
    const summary = spec.summarize(input(Array.from({ length: 40 }, (_, i) => `frame ${i}`).join('\n'), { isError: true }));
    expect(summary.preview).toMatchObject({ lines: ['frame 0', 'frame 1', 'frame 2', 'frame 3', 'frame 4'], hidden: 35, tone: 'error' });
  });
  test('collapses a long output to one row with its tool name, target, and size', () => {
    const row = driveRow(compactRenderers(genericSpec('codemode'), {}), stubTheme());
    row.apply({ args: { code: 'return 1;' }, executionStarted: true, result: output('line\n'.repeat(200)), isPartial: false });
    const lines = row.lines(100).map(plain);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ ✓ {2}codemode {2}return 1;\s+200 lines$/);
    expect(visibleWidth(lines[0] ?? '')).toBe(99);
  });
  test('shows failures with a bounded preview and an expand hint', () => {
    const row = driveRow(compactRenderers(genericSpec('codemode'), {}), stubTheme());
    row.apply({ args: { code: 'tools.bash()' }, result: output('TypeError: boom\n'.repeat(8), true), isPartial: false });
    const lines = row.lines(100).map((line) => plain(line).trim());
    expect(lines[0]).toMatch(/^✗ {2}codemode {2}tools\.bash\(\)\s+failed$/);
    expect(lines.slice(1)).toEqual([...Array(5).fill('TypeError: boom'), '… 3 more · ctrl+o']);
  });
  test('expands to the arguments and the full plain output within every width', () => {
    const row = driveRow(compactRenderers(genericSpec('pi_spawn'), {}), stubTheme());
    const text = Array.from({ length: 30 }, (_, i) => `report \x1b[31mline\x1b[0m ${i}`).join('\n');
    row.apply({ args: { name: 'review', brief: 'Review it.' }, result: output(text), isPartial: false, expanded: true });
    const lines = row.lines(100).map((line) => plain(line).trim());
    expect(lines[1]).toBe('{"name":"review","brief":"Review it."}');
    expect(lines.slice(3)).toEqual(Array.from({ length: 30 }, (_, i) => `report line ${i}`));
    for (let width = 1; width <= 120; width++) for (const line of row.lines(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    row.apply({ expanded: false });
    expect(row.lines(100)).toHaveLength(1);
  });
});
