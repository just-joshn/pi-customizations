import { describe, expect, test, vi } from 'vitest';
import { type GondolinHost, GUEST, loadGondolin } from './core-gondolin-host.ts';

vi.mock('@earendil-works/gondolin', async (importOriginal) => ({ ...(await importOriginal<typeof import('@earendil-works/gondolin')>()), VM: { create: vi.fn() } }));

const LONG_LINE_LENGTH = 1000;
const TWO = 2;
const HUGE_LIMIT = 5000;
const HUGE_FILE_LINES = 2000;
const TEN = 10;
const DEEP_DIR = '/src/deep';
const THREE = 3;
const FOUR = 4;

const grep = async (host: GondolinHost, params: Record<string, unknown>, signal?: AbortSignal) => {
  const result = await host.call('grep', { pattern: '', ...params }, signal);
  return { text: result.content[0]?.text, details: result.details };
};

describe('grep over the guest filesystem', () => {
  test('prints each match with its context lines, marking the match with : and context with -', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'one\ntwo\r\nthree\rfour\nfive' } });
    expect(await grep(host, { pattern: 'three', context: 1 })).toEqual({ text: 'a.txt-2- two\na.txt:3: three\na.txt-4- four', details: undefined });
    expect((await grep(host, { pattern: 'one', context: TWO })).text).toBe('a.txt:1: one\na.txt-2- two\na.txt-3- three');
    expect((await grep(host, { pattern: 'five', context: 1 })).text).toBe('a.txt-4- four\na.txt:5: five');
  });

  test('stops at the match limit and says so', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'hit 1\nhit 2', 'b.txt': 'hit 3' } });
    expect(await grep(host, { pattern: 'hit', limit: TWO })).toEqual({ text: 'a.txt:1: hit 1\na.txt:2: hit 2\n\n[2 matches limit reached]', details: { matchLimitReached: TWO } });
    expect((await grep(host, { pattern: 'hit', limit: 0 })).text).toBe('a.txt:1: hit 1\n\n[1 matches limit reached]');
    // Like the built-in grep, reaching the limit exactly counts as reaching it.
    expect((await grep(host, { pattern: 'hit', limit: THREE })).details).toEqual({ matchLimitReached: THREE });
    expect((await grep(host, { pattern: 'hit', limit: FOUR })).details).toBeUndefined();
  });

  test('literal patterns match text, not regex, and ignoreCase folds case', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'a.b\naxb\nHello' } });
    expect((await grep(host, { pattern: 'a.b', literal: true })).text).toBe('a.txt:1: a.b');
    expect((await grep(host, { pattern: 'a.b' })).text).toBe('a.txt:1: a.b\na.txt:2: axb');
    expect((await grep(host, { pattern: 'HELLO', literal: true, ignoreCase: true })).text).toBe('a.txt:3: Hello');
    expect((await grep(host, { pattern: '^hel', ignoreCase: true })).text).toBe('a.txt:3: Hello');
    expect((await grep(host, { pattern: 'HELLO', literal: true })).text).toBe('No matches found');
  });

  test('reports no matches without details', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'nothing here' } });
    expect(await grep(host, { pattern: 'absent' })).toEqual({ text: 'No matches found', details: undefined });
  });
});

describe('grep over the guest filesystem, which files it reads', () => {
  test('skips .git, node_modules, unreadable files, and files outside the glob', async () => {
    const tree = { '.git/HEAD': 'hit', 'node_modules/x/i.js': 'hit', 'src/a.ts': 'hit', 'src/b.js': 'hit', 'bin.dat': 'hit' };
    const host = loadGondolin({ tree, unreadable: [`${GUEST}/bin.dat`] });
    expect((await grep(host, { pattern: 'hit' })).text).toBe('src/a.ts:1: hit\nsrc/b.js:1: hit');
    expect((await grep(host, { pattern: 'hit', glob: '*.ts' })).text).toBe('src/a.ts:1: hit');
    expect((await grep(host, { pattern: 'hit', glob: 'src/*.js' })).text).toBe('src/b.js:1: hit');
  });

  test('a file as the search path prints its name, and a directory path narrows the search', async () => {
    const host = loadGondolin({ tree: { 'src/a.ts': 'hit', 'b.ts': 'hit' } });
    expect((await grep(host, { pattern: 'hit', path: 'src/a.ts' })).text).toBe('a.ts:1: hit');
    expect((await grep(host, { pattern: 'hit', path: 'src' })).text).toBe('a.ts:1: hit');
  });

  test('cuts long lines and says so', async () => {
    const host = loadGondolin({ tree: { 'a.txt': `hit ${'x'.repeat(LONG_LINE_LENGTH)}` } });
    const { text, details } = await grep(host, { pattern: 'hit' });
    expect(text).toMatch(/\n\n\[long lines truncated\]$/);
    expect(details).toEqual({ linesTruncated: true });
  });

  test('stops with a notice when the output outgrows the size limit', async () => {
    const host = loadGondolin({ tree: { 'a.txt': Array.from({ length: HUGE_FILE_LINES }, (_, i) => `hit ${i} ${'y'.repeat(LONG_LINE_LENGTH / TEN)}`).join('\n') } });
    const { text, details } = await grep(host, { pattern: 'hit', limit: HUGE_LIMIT });
    expect(text).toMatch(/limit reached\]$/);
    expect(details).toHaveProperty('truncation');
  });

  test('an aborted call stops the search', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'hit' } });
    await expect(grep(host, { pattern: 'hit' }, AbortSignal.abort())).rejects.toThrow('Operation aborted');
  });

  test('a search path that does not exist fails with the guest path', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'hit' } });
    await expect(grep(host, { pattern: 'hit', path: 'missing' })).rejects.toThrow('ENOENT: /workspace/missing');
  });
});

describe('find over the guest filesystem', () => {
  const tree = { 'a.ts': '', 'src/b.ts': '', 'src/c.js': '', 'src/deep/d.ts': '', 'node_modules/x/e.ts': '' };

  test('a pattern without / matches file names at any depth, skipping node_modules', async () => {
    expect(await loadGondolin({ tree }).text('find', { pattern: '*.ts' })).toBe('a.ts\nsrc/b.ts\nsrc/deep/d.ts');
  });

  test('a pattern with / matches from the search root, ignoring a leading ./', async () => {
    const host = loadGondolin({ tree });
    expect(await host.text('find', { pattern: 'src/*.ts' })).toBe('src/b.ts');
    expect(await host.text('find', { pattern: './src/**/*.ts' })).toBe('src/b.ts\nsrc/deep/d.ts');
  });

  test('a path argument narrows the search to that folder', async () => {
    expect(await loadGondolin({ tree }).text('find', { pattern: '*.ts', path: 'src' })).toBe('b.ts\ndeep/d.ts');
  });

  test('stops at the limit and says so', async () => {
    const text = await loadGondolin({ tree }).text('find', { pattern: '*.ts', limit: 1 });
    expect(text).toContain('a.ts');
    expect(text).not.toContain('src/b.ts');
    expect(text).toContain('1 results limit reached');
  });

  test('says so when nothing matches', async () => {
    expect(await loadGondolin({ tree }).text('find', { pattern: '*.zip' })).toBe('No files found matching pattern');
  });

  test('a search path that does not exist fails with the guest path', async () => {
    await expect(loadGondolin({ tree }).call('find', { pattern: '*.ts', path: 'missing' })).rejects.toThrow('Path not found: /workspace/missing');
  });

  test('a search over a directory that vanished mid-walk skips it', async () => {
    const host = loadGondolin({ tree });
    vi.spyOn(host.fs, 'stat').mockImplementation(async (guestPath: string) => (guestPath.endsWith(DEEP_DIR) ? Promise.reject(new Error('gone')) : { isDirectory: () => !/\.(ts|js)$/.test(guestPath) }));
    expect(await host.text('find', { pattern: '*.ts' })).toBe('a.ts\nsrc/b.ts');
  });
});
