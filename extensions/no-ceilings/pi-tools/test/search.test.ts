import { describe, expect, it } from 'vitest';
import { streamLines } from '../src/core/proc.ts';
import { createHarness, textOf } from './harness.ts';

describe('ls', () => {
  it('lists sorted entries with directories suffixed and dotfiles included', async () => {
    const harness = await createHarness();
    try {
      await harness.write('b.txt', 'b');
      await harness.write('a.txt', 'a');
      await harness.write('.hidden', 'h');
      await harness.write('dir/inner.txt', 'i');
      const result = await harness.call('ls', {});
      expect(textOf(result).split('\n')).toEqual(['.hidden', 'a.txt', 'b.txt', 'dir/']);
    } finally {
      await harness.cleanup();
    }
  });

  it('walks nested levels when depth is greater than one', async () => {
    const harness = await createHarness();
    try {
      await harness.write('src/a.ts', 'a');
      await harness.write('src/nested/b.ts', 'b');
      const result = await harness.call('ls', { depth: 3 });
      expect(textOf(result).split('\n')).toEqual(['src/', 'src/a.ts', 'src/nested/', 'src/nested/b.ts']);
    } finally {
      await harness.cleanup();
    }
  });

  it('applies limit, extra ignore globs, ignore files, and permission rules', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/blocked.txt' }] } });
    try {
      await harness.write('a.txt', 'a');
      await harness.write('b.txt', 'b');
      await harness.write('c.log', 'c');
      await harness.write('blocked.txt', 'x');
      await harness.write('.piignore', 'ignored.txt\n');
      await harness.write('ignored.txt', 'x');

      const limited = await harness.call('ls', { limit: 2 });
      expect((limited.details as { limitReached?: boolean }).limitReached).toBe(true);
      expect(textOf(limited)).toContain('2 entries limit reached');

      const filtered = await harness.call('ls', { ignore: ['*.log'] });
      expect(textOf(filtered)).not.toContain('c.log');
      expect(textOf(filtered)).not.toContain('blocked.txt');
      expect(textOf(filtered)).not.toContain('ignored.txt');
    } finally {
      await harness.cleanup();
    }
  });

  it('reports a missing path, a file, and an empty directory', async () => {
    const harness = await createHarness();
    try {
      await harness.write('file.txt', 'x');
      await harness.write('empty/.keep', '');
      const missing = await harness.call('ls', { path: 'nope' });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toContain('Path does not exist');
      const notDirectory = await harness.call('ls', { path: 'file.txt' });
      expect(notDirectory.isError).toBe(true);
      expect(textOf(notDirectory)).toContain('Path is not a directory');
      const empty = await harness.call('ls', { path: 'empty' });
      expect(textOf(empty)).toBe('.keep');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('find (glob)', () => {
  it('matches files by glob and returns paths relative to the search root', async () => {
    const harness = await createHarness();
    try {
      await harness.write('src/a.ts', 'a');
      await harness.write('src/nested/b.ts', 'b');
      await harness.write('src/c.md', 'c');
      const result = await harness.call('find', { pattern: '*.ts' });
      const text = textOf(result);
      expect(text).toContain('src/a.ts');
      expect(text).toContain('src/nested/b.ts');
      expect(text).not.toContain('c.md');
      const details = result.details as { count?: number };
      expect(details.count).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });

  it('reports no matches and respects the result limit', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'a');
      await harness.write('b.txt', 'b');
      await harness.write('c.txt', 'c');
      const none = await harness.call('find', { pattern: '*.rs' });
      expect(textOf(none)).toBe('No files found matching pattern');
      const limited = await harness.call('find', { pattern: '*.txt', limit: 2 });
      expect((limited.details as { limitReached?: boolean }).limitReached).toBe(true);
      expect(textOf(limited)).toContain('2 results limit reached');
      expect((limited.details as { files?: readonly string[] }).files).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it('surfaces partial results when the search times out', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'a');
      const partial = await createHarness();
      await partial.cleanup();
      const tool = (await import('../src/tools/glob.ts')).createGlobLayerTool({
        session: async () => {
          const sessionModule = await import('../src/core/session.ts');
          const manager = sessionModule.createSessionManager({ agentDir: harness.agentDir, home: harness.root, env: process.env });
          return manager.get({ cwd: harness.workspace });
        },
        run: async () => ({ lines: ['a.txt'], totalLines: 1, totalBytes: 6, truncated: true, timedOut: true, limitReached: false, killedByByteCap: false, stderr: '', exitCode: null }),
      });
      const result = await tool.execute('call', { pattern: '*.txt' }, undefined, undefined, { cwd: harness.workspace } as never);
      expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('search timed out');
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses an explicitly ignored root', async () => {
    const harness = await createHarness();
    try {
      await harness.write('.piignore', 'generated/\n');
      await harness.write('generated/a.ts', 'a');
      const result = await harness.call('find', { pattern: '*.ts', path: 'generated' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('filtered out by .piignore');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('grep', () => {
  it('returns content matches with line numbers and context', async () => {
    const harness = await createHarness();
    try {
      await harness.write('src/a.ts', 'one\ntwo needle\nthree\nfour\n');
      const result = await harness.call('grep', { pattern: 'needle', context: 1 });
      const text = textOf(result);
      expect(text).toContain('src/a.ts:2: two needle');
      expect(text).toContain('src/a.ts-1- one');
      expect(text).toContain('src/a.ts-3- three');
    } finally {
      await harness.cleanup();
    }
  });

  it('supports files and count output modes', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'hit\nhit\n');
      await harness.write('b.txt', 'none\n');
      const files = await harness.call('grep', { pattern: 'hit', outputMode: 'files' });
      expect(textOf(files)).toContain('a.txt');
      expect(textOf(files)).not.toContain('b.txt');
      const counts = await harness.call('grep', { pattern: 'hit', outputMode: 'count' });
      expect(textOf(counts)).toContain('a.txt:2');
      expect(textOf(counts)).toContain('2 matches in 1 files');
    } finally {
      await harness.cleanup();
    }
  });

  it('supports literal, case-insensitive, glob, and type filters', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.ts', 'Value (x)\n');
      await harness.write('b.md', 'Value (x)\n');
      const caseInsensitive = await harness.call('grep', { pattern: 'value', ignoreCase: true });
      expect(textOf(caseInsensitive)).toContain('a.ts');
      const literal = await harness.call('grep', { pattern: 'Value (x)', literal: true });
      expect(textOf(literal)).toContain('a.ts');
      const globbed = await harness.call('grep', { pattern: 'Value', glob: '*.md' });
      expect(textOf(globbed)).toContain('b.md');
      expect(textOf(globbed)).not.toContain('a.ts');
      const typed = await harness.call('grep', { pattern: 'Value', type: 'ts' });
      expect(textOf(typed)).toContain('a.ts');
      expect(textOf(typed)).not.toContain('b.md');
    } finally {
      await harness.cleanup();
    }
  });

  it('limits and offsets results', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'hit 1\nhit 2\nhit 3\n');
      const limited = await harness.call('grep', { pattern: 'hit', limit: 2 });
      expect((limited.details as { limitReached?: boolean }).limitReached).toBe(true);
      expect(textOf(limited)).toContain('2 results limit reached');
      const offset = await harness.call('grep', { pattern: 'hit', offset: 2 });
      const text = textOf(offset);
      expect(text).toContain('hit 3');
      expect(text).not.toContain('hit 1');
      expect((offset.details as { offsetApplied?: number }).offsetApplied).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });

  it('reports an invalid regex without crashing', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'x');
      const result = await harness.call('grep', { pattern: 'foo(' });
      expect(result.isError).toBe(true);
      expect(textOf(result).length).toBeGreaterThan(0);
    } finally {
      await harness.cleanup();
    }
  });

  it('reports no matches and filters ignored or denied files', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/blocked.txt' }] } });
    try {
      await harness.write('a.txt', 'nothing here\n');
      await harness.write('blocked.txt', 'needle\n');
      await harness.write('.piignore', 'ignored.txt\n');
      await harness.write('ignored.txt', 'needle\n');
      await harness.write('visible.txt', 'needle\n');
      const none = await harness.call('grep', { pattern: 'absent' });
      expect(textOf(none)).toBe('No matches found');
      const filtered = await harness.call('grep', { pattern: 'needle' });
      expect(textOf(filtered)).toContain('visible.txt');
      expect(textOf(filtered)).not.toContain('blocked.txt');
      expect(textOf(filtered)).not.toContain('ignored.txt');
    } finally {
      await harness.cleanup();
    }
  });

  it('searches an explicit directory outside the workspace', async () => {
    const harness = await createHarness();
    try {
      await harness.write('inside.txt', 'needle\n');
      const outside = harness.file('../outside');
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(outside, { recursive: true });
      await writeFile(`${outside}/far.txt`, 'needle\n', 'utf-8');
      const result = await harness.call('grep', { pattern: 'needle', path: '../outside' });
      expect(textOf(result)).toContain('far.txt');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('stream runner', () => {
  it('returns partial lines when the deadline expires', async () => {
    const run = await streamLines('sh', ['-c', 'echo first; sleep 5; echo second'], {
      cwd: process.cwd(),
      timeoutMs: 100,
    });
    expect(run.timedOut).toBe(true);
    expect(run.lines).toContain('first');
    expect(run.lines).not.toContain('second');
  });

  it('stops at the line cap and reports it', async () => {
    const run = await streamLines('sh', ['-c', 'printf "a\\nb\\nc\\n"'], { cwd: process.cwd(), timeoutMs: 5000, maxLines: 2 });
    expect(run.totalLines).toBeGreaterThanOrEqual(2);
    expect(run.limitReached).toBe(true);
  });

  it('rejects an already-aborted call', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(streamLines('sh', ['-c', 'echo x'], { cwd: process.cwd(), timeoutMs: 1000, signal: controller.signal })).rejects.toThrow('Operation aborted');
  });
});
