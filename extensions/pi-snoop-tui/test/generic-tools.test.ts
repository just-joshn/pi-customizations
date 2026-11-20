import { describe, expect, test } from 'vitest';
import { driveRow, loadSnoop, output, PROJECT } from './harness.ts';

const host = loadSnoop();
const WIDE = 100;
const LONG_OUTPUT_LINES = 200;
const FAILURE_LINES = 8;
const PREVIEW_LINES = 5;
const REPORT_LINES = 30;
const REPORT_BODY_START = 3;

function targetOf(toolName: string, args: Record<string, unknown> | undefined) {
  const row = driveRow(host, toolName);
  row.apply({ args: args ?? {} });
  return (row.text(WIDE)[0] ?? '').replace(/^ · {2}\S+\s+/, '').trimEnd();
}

describe('rows for tools Pi does not render specially', () => {
  test.for([
    [{ name: 'tests', command: 'bunx vitest run' }, 'bunx vitest run'],
    [{ name: 'review-3', brief: 'Review cache module 3.\n\nReport every caller.' }, 'Review cache module 3.…'],
    [{ code: 'const a  =\t1;\nreturn a;' }, 'const a = 1;…'],
    [{ limit: 3, label: 'first string', other: 'second' }, 'first string'],
    [{ path: `${PROJECT}/src/cache.ts` }, 'src/cache.ts'],
    [{ count: 3, nested: { command: 'x' } }, ''],
    [{}, ''],
  ] as const)('shows the most telling argument of %j as %j', ([args, expected]) => {
    expect(targetOf('tmux_run', args)).toBe(expected);
  });

  test('a tool called with no arguments at all still gets a row', () => {
    const row = driveRow(host, 'tmux_run');
    row.apply({ args: undefined as never });
    expect(row.text(WIDE)).toEqual([' ·  tmux_run  ']);
  });

  test('a tool whose native renderer only draws the call keeps it', () => {
    const own = { renderCall: () => ({ render: () => ['own call'], invalidate: () => undefined }) };
    expect(host.renderersFor('mcp__custom', own)).toBe(own);
    const ownResult = { renderResult: () => ({ render: () => ['own result'], invalidate: () => undefined }) };
    expect(host.renderersFor('mcp__custom', ownResult)).toBe(ownResult);
  });

  test('Pi can render a built-in tool that has no renderers, and the extension leaves that alone', () => {
    expect(host.renderersFor('read', undefined)).toBeUndefined();
  });
});

describe('results of tools Pi does not render specially', () => {
  test.for([
    ['a\nb\nc\n', '3 lines'],
    ['a', '1 line'],
    ['', '0 lines'],
  ] as const)('names the size of output %j as %s', ([text, size]) => {
    const row = driveRow(host, 'codemode');
    row.apply({ args: { code: 'x' }, result: output(text), isPartial: false });
    expect(row.text(WIDE)[0]).toMatch(new RegExp(`\\s${size}$`));
  });

  test('an image result is labelled as an image', () => {
    const row = driveRow(host, 'screenshot');
    row.apply({ args: { name: 'home' }, result: { content: [{ type: 'image', data: '', mimeType: 'image/png' }] }, isPartial: false });
    expect(row.text(WIDE)[0]).toMatch(/\simage$/);
  });

  test('a call still running shows no size and no preview', () => {
    const row = driveRow(host, 'tmux_run');
    row.apply({ args: { command: 'sleep 1' }, executionStarted: true, result: output('running...') });
    expect(row.text(WIDE)).toEqual([' •  tmux_run  sleep 1']);
  });

  test.for([
    ['FAIL suite\nCommand exited with code 2', 'exit 2'],
    ['FAIL suite\nprocess exit code 3\n', 'exit 3'],
    ['TypeError: x is not a function', 'failed'],
  ] as const)('a failed call ending %j reports %s', ([text, meta]) => {
    const row = driveRow(host, 'tmux_run');
    row.apply({ args: { command: 'x' }, result: output(text, true), isPartial: false });
    expect(row.text(WIDE)[0]).toMatch(new RegExp(`^ ✗ {2}tmux_run {2}x\\s+${meta}$`));
  });
});

describe('layout of rows for tools Pi does not render specially', () => {
  test('a long output collapses to one row with its tool name, target and size', () => {
    const row = driveRow(host, 'codemode');
    row.apply({ args: { code: 'return 1;' }, executionStarted: true, result: output('line\n'.repeat(LONG_OUTPUT_LINES)), isPartial: false });
    const lines = row.text(WIDE);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ ✓ {2}codemode {2}return 1;\s+200 lines$/);
  });

  test('a failure shows a bounded preview and an expand hint', () => {
    const row = driveRow(host, 'codemode');
    row.apply({ args: { code: 'tools.bash()' }, result: output('TypeError: boom\n'.repeat(FAILURE_LINES), true), isPartial: false });
    const lines = row.text(WIDE).map((line) => line.trim());
    expect(lines[0]).toMatch(/^✗ {2}codemode {2}tools\.bash\(\)\s+failed$/);
    expect(lines.slice(1)).toEqual([...Array.from({ length: PREVIEW_LINES }, () => 'TypeError: boom'), `… ${FAILURE_LINES - PREVIEW_LINES} more · ctrl+o`]);
  });

  test('expanding shows the arguments, then the full output without color codes', () => {
    const row = driveRow(host, 'pi_spawn');
    const text = Array.from({ length: REPORT_LINES }, (_, i) => `report \x1b[31mline\x1b[0m ${i}`).join('\n');
    row.apply({ args: { name: 'review', brief: 'Review it.' }, result: output(text), isPartial: false, expanded: true });
    const lines = row.text(WIDE).map((line) => line.trim());
    expect(lines[1]).toBe('{"name":"review","brief":"Review it."}');
    expect(lines.slice(REPORT_BODY_START)).toEqual(Array.from({ length: REPORT_LINES }, (_, i) => `report line ${i}`));
    row.apply({ expanded: false });
    expect(row.text(WIDE)).toHaveLength(1);
  });

  test('names longer than the verb column push the target right by their own gap', () => {
    const column = (tool: string) => {
      const row = driveRow(host, tool);
      row.apply({ args: { path: 'target' }, executionStarted: true, result: output('a'), isPartial: false });
      return (row.text(WIDE)[0] ?? '').indexOf('target');
    };
    const aligned = column('tmux_run');
    for (const tool of ['ls', 'read', 'write', 'codemode', 'pi_spawn']) expect(column(tool)).toBe(aligned);
    expect(driveRowHeader('mcp__github__search')).toMatch(/^ ✓ {2}mcp__github__search {2}target/);
  });
});

function driveRowHeader(tool: string): string {
  const row = driveRow(host, tool);
  row.apply({ args: { path: 'target' }, executionStarted: true, result: output('a'), isPartial: false });
  return row.text(WIDE)[0] ?? '';
}
