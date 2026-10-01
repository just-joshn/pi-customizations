import { expect, onTestFinished, vi } from 'vitest';
import { RpcChild, type RpcRecord } from '../src/subagents/rpc-child.ts';
import { loggedCommands, rpcChild, spawnEnv, test } from './child-harness.ts';

function collect(child: RpcChild): RpcRecord[] {
  const seen: RpcRecord[] = [];
  child.onRecord((record) => {
    seen.push(record);
  });
  return seen;
}

test('concurrent commands each resolve with their own response data', async ({ workspace }) => {
  const child = rpcChild(workspace);

  const replies = await Promise.all([child.send({ type: 'echo', message: 'a' }), child.send({ type: 'echo', message: 'b' })]);

  expect(replies).toEqual([
    { echoed: 'echo', message: 'a' },
    { echoed: 'echo', message: 'b' },
  ]);
});

test.for([
  { name: 'the error the child reports', command: 'fail_me', message: 'nope' },
  { name: 'a generic message when none is given', command: 'fail_silent', message: 'RPC command failed' },
])('an unsuccessful response rejects with $name', async ({ command, message }, { workspace }) => {
  const child = rpcChild(workspace);

  await expect(child.send({ type: command })).rejects.toThrow(message);
});

test('event records reach every listener until it unsubscribes', async ({ workspace }) => {
  const child = rpcChild(workspace);
  const kept = collect(child);
  const dropped: RpcRecord[] = [];
  const unsubscribe = child.onRecord((record) => {
    dropped.push(record);
  });
  unsubscribe();

  await child.send({ type: 'emit', n: 7 });

  await vi.waitFor(() => expect(kept).toEqual([{ type: 'custom_event', n: 7 }]));
  expect(dropped).toEqual([]);
});

test('garbage lines are ignored, split frames are reassembled', async ({ workspace }) => {
  const child = rpcChild(workspace);
  const seen = collect(child);

  await child.send({ type: 'noise' });

  await vi.waitFor(() => expect(seen).toEqual([{ type: 'split', n: 1 }]));
});

test('a command the child never answers rejects at its deadline', async ({ workspace }) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const child = rpcChild(workspace);

  const outcome = expect(child.send({ type: 'ignore' }, 20)).rejects.toThrow('RPC timed out: ignore');
  await vi.advanceTimersByTimeAsync(20);

  await outcome;
});

test('a child exit rejects pending commands, then reports the exit', async ({ workspace }) => {
  const child = rpcChild(workspace);

  await expect(child.send({ type: 'exit' })).rejects.toThrow('pi exited 4: bye');

  expect(await child.closed).toEqual({ code: 4, signal: null, stderr: 'bye' });
  expect(child.exited).toBe(true);
  await expect(child.send({ type: 'echo' })).rejects.toThrow('pi process has exited');
  expect(() => {
    child.respond('late', { confirmed: true });
    child.kill('SIGTERM');
  }).not.toThrow();
});

test('a signalled child closes with that signal', async ({ workspace }) => {
  const child = rpcChild(workspace);
  await child.send({ type: 'echo' });
  expect(child.pid).toBeGreaterThan(0);

  child.kill('SIGTERM');

  expect(await child.closed).toEqual({ code: null, signal: 'SIGTERM', stderr: '' });
});

test('ending stdin lets the child exit cleanly', async ({ workspace }) => {
  const child = rpcChild(workspace);
  await child.send({ type: 'echo' });

  child.end();

  expect(await child.closed).toEqual({ code: 0, signal: null, stderr: '' });
});

test('a UI response is written to the child as an extension_ui_response', async ({ workspace }) => {
  const child = rpcChild(workspace);
  await child.send({ type: 'echo' });

  child.respond('ui-9', { confirmed: true });

  await vi.waitFor(async () => expect(await loggedCommands(workspace)).toContainEqual({ type: 'extension_ui_response', id: 'ui-9', confirmed: true }));
});

test('a command that cannot be launched closes with the spawn error', async ({ workspace }) => {
  const child = RpcChild.start({ command: { command: `${workspace.dir}/no-such-pi`, args: [] }, args: [], cwd: workspace.dir, env: spawnEnv(workspace) });

  const exit = await child.closed;

  expect(exit.code).toBeNull();
  expect(exit.signal).toBeNull();
  expect(exit.stderr).toContain('ENOENT');
  expect(child.pid).toBeUndefined();
});
