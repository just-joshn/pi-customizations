import { beforeEach, expect, test, vi } from 'vitest';

const execFile = vi.fn();
vi.mock('node:child_process', () => ({ execFile }));

type Callback = (error: Error | null, result: { stdout: string; stderr: string }) => void;
let ps: string | Error = '';

beforeEach(() => {
  execFile.mockImplementation((_file: string, _args: readonly string[], callback: Callback) => {
    if (ps instanceof Error) callback(ps, { stdout: '', stderr: '' });
    else callback(null, { stdout: ps, stderr: '' });
  });
});

test('descendants walks the ps table breadth-first from the given root', async () => {
  ps = '  10 1\n  11 1\n  12 10\n';
  const { descendants } = await import('../src/shell-descendants.ts');
  expect(await descendants(1)).toEqual([10, 11, 12]);
});

test('a failed ps call yields no descendants instead of throwing', async () => {
  ps = new Error('ps is unavailable');
  const { descendants } = await import('../src/shell-descendants.ts');
  expect((await descendants(1)).length).toBe(0);
});

test('malformed ps rows are ignored while parseable pairs still walk', async () => {
  ps = 'pid ppid\n  20 not-a-number\n  21 1\n  22 21\n';
  const { descendants } = await import('../src/shell-descendants.ts');
  expect(await descendants(1)).toEqual([21, 22]);
  expect(execFile).toHaveBeenCalledWith('ps', ['-A', '-o', 'pid=,ppid='], expect.any(Function));
});
