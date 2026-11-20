import { describe, expect, test } from 'vitest';
import { driveRow, homeDirectory, loadSnoop, output, PROJECT, piNative } from './harness.ts';

const host = loadSnoop();
const WIDE = 100;
const NARROW = 40;
const TIGHT = 20;
// a gutter each side, the marker column and the verb column leave exactly 15 columns for the target
const PATH_WIDTH = 30;
const TINY = 6;
const ERROR_LINES = 10;
const PREVIEW_LINES = 5;
const LARGE_OUTPUT_LINES = 1_000_000;
const RUNNING_TAIL = 3;
const HIDDEN_LARGE = LARGE_OUTPUT_LINES - RUNNING_TAIL;
const SEVEN = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
const IMAGE_READ = [
  { type: 'text' as const, text: 'Read image file' },
  { type: 'image' as const, data: '', mimeType: 'image/png' },
];

type Tool = 'read' | 'edit' | 'write' | 'bash' | 'grep' | 'find' | 'ls';
function finished(tool: Tool, args: Record<string, unknown>, result: ReturnType<typeof output> | { content: typeof IMAGE_READ }, details?: unknown) {
  const row = driveRow(host, tool, { native: piNative(tool, PROJECT) });
  row.apply({ args, executionStarted: true, result: { ...result, details }, isPartial: false });
  return row;
}
const header = (row: ReturnType<typeof finished>, width = WIDE) => (row.text(width)[0] ?? '').trimEnd();
const body = (row: ReturnType<typeof finished>, width = WIDE) =>
  row
    .text(width)
    .slice(1)
    .map((line) => line.trim());

describe('one-line rows for built-in tools', () => {
  test.for([
    ['read', { path: `${PROJECT}/src/cache.ts` }, output('a\nb\nc'), undefined, /^ ✓ {2}read {6}src\/cache\.ts\s+3 lines$/],
    ['read', { path: `${PROJECT}/src/cache.ts`, offset: 2, limit: 3 }, output('a\nb\nc'), undefined, /^ ✓ {2}read {6}src\/cache\.ts:2-4\s+3 lines$/],
    ['read', { path: 4, offset: '2', limit: null }, output('a'), undefined, /^ ✓ {2}read {6}\s+1 line$/],
    ['read', { path: 'a.ts' }, output('a\nb\n\n[5 more lines in file. Use offset=3 to continue.]'), undefined, /\s2 lines$/],
    ['read', { path: 'a.ts' }, output('a'), { truncation: { totalLines: 10 } }, /\s10 lines$/],
    ['read', { path: 'a.png' }, { content: IMAGE_READ }, undefined, /\simage$/],
    ['edit', { path: `${PROJECT}/src/cache.ts` }, output('ok'), { patch: '--- a\n+++ b\n-a\n+b\n+c' }, /^ ✓ {2}edit {6}src\/cache\.ts\s+\+2 −1$/],
    ['edit', { path: 'a.ts' }, output('ok'), undefined, /\sedited$/],
    ['write', { path: `${PROJECT}/src/new.ts`, content: 'a\nb\n' }, output('wrote'), undefined, /^ ✓ {2}write {5}src\/new\.ts\s+2 lines$/],
    ['write', { path: 'new.ts' }, output('wrote'), undefined, /\s0 lines$/],
    ['write', { path: 'new.ts', content: 'one' }, output('wrote'), undefined, /\s1 line$/],
    ['bash', { command: 'npm test' }, output('PASS'), undefined, /^ ✓ {2}bash {6}npm test\s+exit 0$/],
    ['bash', { command: 'echo hi\necho bye' }, output('hi'), undefined, /bash {6}echo hi…\s+exit 0$/],
    ['grep', { pattern: 'refresh', path: 'src' }, output('a:1: x\nb:2: y'), undefined, /^ ✓ {2}grep {6}refresh {2}src\s+2 matches$/],
    ['grep', { pattern: 'refresh' }, output('a:1: x'), undefined, /\s1 match$/],
    ['grep', { pattern: 'zzz' }, output('No matches found'), undefined, /\sno matches$/],
    ['grep', { pattern: 'x' }, output('a\nb'), { matchLimitReached: 2 }, /\s2\+ matches$/],
    ['find', { pattern: '*.ts' }, output('a.ts\nb.ts\nc.ts'), undefined, /^ ✓ {2}find {6}\*\.ts\s+3 files$/],
    ['find', { pattern: '*.ts' }, output('a.ts'), undefined, /\s1 file$/],
    ['find', { pattern: '*.zz' }, output('No files found matching pattern'), undefined, /\s0 files$/],
    ['find', { pattern: '*.ts' }, output('a'), { resultLimitReached: 1, truncation: { totalLines: 9 } }, /\s9\+ files$/],
    ['ls', { path: 'src' }, output('a\nb'), undefined, /^ ✓ {2}ls {8}src\s+2 entries$/],
    ['ls', {}, output('a'), undefined, /^ ✓ {2}ls {8}\.\s+1 entry$/],
    ['ls', { path: 'src' }, output('(empty directory)'), undefined, /\s0 entries$/],
    ['ls', { path: 'src' }, output('a\nb'), { entryLimitReached: 2 }, /\s2\+ entries$/],
  ] as const)('%s %j reads as %s', ([tool, args, result, details, expected]) => {
    expect(header(finished(tool, args, result, details))).toMatch(expected);
  });

  test('a path under the working directory shows relative and one under the home directory shows with a tilde', () => {
    const home = homeDirectory();
    if (!home) return;
    expect(header(finished('read', { path: `${home}/notes.md` }, output('a')))).toMatch(/read {6}~\/notes\.md/);
    expect(header(finished('read', { path: `${PROJECT}-other/x.ts` }, output('a')))).toContain(`${PROJECT}-other/x.ts`);
  });

  test('metadata disappears before the target is squeezed', () => {
    const row = finished('read', { path: 'src/cache.ts' }, output('a\nb'));
    expect(header(row, NARROW)).toMatch(/src\/cache\.ts\s+2 lines$/);
    expect(header(row, TIGHT)).toBe(' ✓  read      cach…');
  });

  test('a long path keeps its file name and trims middle folders to fit', () => {
    const row = driveRow(host, 'read', { native: piNative('read', PROJECT) });
    row.apply({ args: { path: `${PROJECT}/src/session/cache.ts` }, executionStarted: true });
    expect(row.text(PATH_WIDTH)[0]).toBe(' •  read      src/…/cache.ts');
    expect(row.text(TIGHT)[0]).toBe(' •  read      cach…');
    expect(row.text(TINY)[0]).toBe(' •  …');
  });
});

describe('bash rows while running and after', () => {
  test('a running command shows its last three lines and how many came before', () => {
    const row = driveRow(host, 'bash', { native: piNative('bash', PROJECT) });
    row.apply({ args: { command: 'npm test' }, executionStarted: true, result: output(SEVEN) });
    expect(row.text(WIDE)[0]).toMatch(/^ • {2}bash {6}npm test$/);
    expect(body(row)).toEqual(['… 4 earlier · ctrl+o', '5', '6', '7']);
  });

  test('a running command with little output shows it all with no hint', () => {
    const row = driveRow(host, 'bash', { native: piNative('bash', PROJECT) });
    row.apply({ args: { command: 'npm test' }, executionStarted: true, result: output('short') });
    expect(body(row)).toEqual(['short']);
  });

  test('a command that has not started yet shows a dim pending marker', () => {
    const row = driveRow(host, 'bash', { native: piNative('bash', PROJECT) });
    row.apply({ args: { command: 'npm test' } });
    expect(row.text(WIDE)).toEqual([' ·  bash      npm test']);
  });

  test.for([
    ['fail\n\nCommand exited with code 2', 'exit 2', ['fail']],
    ['fail\nCommand timed out after 5 seconds', 'timeout', ['fail']],
    ['partial\nCommand aborted', 'aborted', ['partial']],
    ['unknown trouble', 'failed', ['unknown trouble']],
    [`${SEVEN}\n\nCommand exited with code 1`, 'exit 1', ['… 2 earlier · ctrl+o', '3', '4', '5', '6', '7']],
  ] as const)('a failed command %j reports %s with the tail of its output', ([text, meta, preview]) => {
    const row = finished('bash', { command: 'make' }, output(text, true));
    expect(header(row)).toMatch(new RegExp(`^ ✗ {2}bash {6}make\\s+${meta}$`));
    expect(body(row)).toEqual(preview);
  });

  test('the preview of a huge running output stays cheap and exact', () => {
    const row = driveRow(host, 'bash', { native: piNative('bash', PROJECT) });
    row.apply({ args: { command: 'yes' }, executionStarted: true, result: output('line\n'.repeat(LARGE_OUTPUT_LINES)) });
    expect(body(row)).toEqual([`… ${HIDDEN_LARGE} earlier · ctrl+o`, 'line', 'line', 'line']);
  });

  test('carriage returns and blank lines in output survive in the preview', () => {
    const row = driveRow(host, 'bash', { native: piNative('bash', PROJECT) });
    row.apply({ args: { command: 'x' }, executionStarted: true, result: output('one\r\n\r\ntwo\r\n') });
    expect(body(row)).toEqual(['one', '', 'two']);
    row.apply({ result: output('\n\nlast') });
    expect(body(row)).toEqual(['', '', 'last']);
    row.apply({ result: output('') });
    expect(body(row)).toEqual([]);
  });
});

describe('failures from other built-in tools', () => {
  test.for(['read', 'edit', 'write', 'grep', 'find', 'ls'] as const)('%s failure shows the first five lines and an expand hint', (tool) => {
    const row = finished(tool, { path: 'a.ts', pattern: 'x' }, output('bad\n'.repeat(ERROR_LINES), true));
    expect(header(row)).toMatch(/^ ✗ {2}\w+\s+.*failed$/);
    expect(body(row)).toEqual([...Array.from({ length: PREVIEW_LINES }, () => 'bad'), `… ${ERROR_LINES - PREVIEW_LINES} more · ctrl+o`]);
  });

  test('a failure with few lines shows them without a hint', () => {
    const row = finished('read', { path: 'gone.ts' }, output('ENOENT\nno such file', true));
    expect(body(row)).toEqual(['ENOENT', 'no such file']);
  });

  test('a read that failed after succeeding flips its marker and a resumed result is complete', () => {
    const row = driveRow(host, 'read', { native: piNative('read', PROJECT) });
    row.apply({ args: { path: 'file.ts' }, result: output('a\nb'), isPartial: false });
    expect(row.text(WIDE)[0]).toMatch(/^ ✓/);
    row.apply({ result: output('failed', true) });
    expect(row.text(WIDE)[0]).toMatch(/^ ✗/);
  });
});
