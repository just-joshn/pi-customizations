import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import { compactRenderers, derivePhase, layoutHeader } from '../src/rows/row.ts';
import { isCompactTool, type ResultInput, TOOL_SPECS } from '../src/rows/specs.ts';
import { countLines, fitPath, fitPlain, headLines, sanitizeLine, tailLines } from '../src/text.ts';
import { driveRow, output, plain, recordingNative, stubTheme } from './harness.ts';

const input = (text: string, extra: Partial<ResultInput> = {}): ResultInput => ({ args: {}, text, details: undefined, isError: false, isPartial: false, ...extra });

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
    expect(row.lines(80).map(plain)).toEqual([' ·  bash   echo hi']);
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
    expect(row.lines(80).map(plain)).toEqual([' •  bash   ', '    short']);
  });
  test('drops metadata before target space', () => {
    const view = { verb: 'read', target: { kind: 'path' as const, text: 'src/cache.ts' }, meta: '142 lines' };
    expect(layoutHeader(view, 80).meta).toBe('142 lines');
    expect(layoutHeader(view, 20).meta).toBe('');
  });
});
