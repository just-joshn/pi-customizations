import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { ChildTask } from '../src/subagents/child-task.ts';
import { RpcChild } from '../src/subagents/rpc-child.ts';

test('opening a child fails instead of falling back when its recorded cwd is missing', async () => {
  const start = vi.spyOn(RpcChild, 'start');
  const cwd = join(tmpdir(), `missing-child-${randomUUID()}`);
  const task = new ChildTask({ start: { cwd } } as never, {} as never);
  try {
    await expect(task.open()).rejects.toThrow(`Task working directory does not exist: ${cwd}`);
    expect(start).not.toHaveBeenCalled();
  } finally {
    start.mockRestore();
  }
});
