import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { shellHandoff, shellRole } from '../src/shell-ownership.ts';
import { ShellRuntime } from '../src/shell-runtime.ts';

const endsWithFinalResponse = 'backgroundEnds' + 'WithFinalResponse';

function stubPi(messages: unknown[]) {
  return { sendMessage: (message: unknown) => messages.push(message), on: () => {}, events: { emit: () => {}, on: () => () => {} } } as never;
}

async function context() {
  const cwd = await mkdtemp(join(tmpdir(), 'pstack-shell-owner-'));
  return { cwd, ctx: { cwd, sessionManager: { getSessionFile: () => null }, isIdle: () => true } as never };
}

test.for([
  { branch: [], role: { child: false, endsWithFinalResponse: false } },
  { branch: [{ type: 'custom', customType: 'pstack-agent-identity', data: 'a1' }], role: { child: true, endsWithFinalResponse: false } },
  {
    branch: [
      { type: 'custom', customType: 'pstack-agent-identity', data: 'a1' },
      { type: 'custom', customType: 'pstack-agent-foreground', data: true },
    ],
    role: { child: true, endsWithFinalResponse: true },
  },
])('shell role for $role', ({ branch, role }) => {
  expect(shellRole(branch)).toEqual(role);
});

test('a handoff can be claimed by exactly one owner', () => {
  const handoff = shellHandoff(new ShellRuntime(stubPi([])));
  expect([handoff.claimed(), handoff.claim(), handoff.claim(), handoff.claimed()]).toEqual([false, true, false, true]);
});

test(`shells of a synchronous worker carry ${endsWithFinalResponse}`, async () => {
  const runtime = new ShellRuntime(stubPi([]));
  const { cwd, ctx } = await context();
  runtime.markEndsWithFinalResponse(true);
  const owned = await runtime.start({ command: 'true', title: 'sync' }, ctx);
  runtime.markEndsWithFinalResponse(false);
  const surviving = await runtime.start({ command: 'true', title: 'async' }, ctx);
  try {
    expect(owned.backgroundEndsWithFinalResponse).toBe(true);
    expect(surviving).not.toHaveProperty(endsWithFinalResponse);
  } finally {
    await runtime.stopAll();
    await rm(dirname(owned.outputFile), { recursive: true, force: true });
    await rm(dirname(surviving.outputFile), { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('an adopted shell is listed, wakes and is stopped by its new owner', async () => {
  const childMessages: unknown[] = [];
  const parentMessages: unknown[] = [];
  const child = new ShellRuntime(stubPi(childMessages));
  const parent = new ShellRuntime(stubPi(parentMessages));
  parent.useContext({ isIdle: () => true });
  const { cwd, ctx } = await context();
  const exits = await child.start({ command: 'sleep 0.2; exit 3', title: 'exits' }, ctx);
  const sleeps = await child.start({ command: 'sleep 30', title: 'sleeps' }, ctx);
  try {
    parent.adopt(child);
    expect(parent.running()).toBe(true);
    expect(parent.list().map((record) => record.title)).toEqual(['sleeps', 'exits']);
    await vi.waitFor(() => expect(parentMessages).toMatchObject([{ customType: 'pstack-shell-exit', details: { id: exits.id, status: { kind: 'exited', code: 3 } } }]));
    expect(childMessages).toEqual([]);
    expect((await parent.stop(sleeps.id)).status).toEqual({ kind: 'stopped' });
    expect(parent.running()).toBe(false);
  } finally {
    await parent.stopAll();
    await rm(dirname(exits.outputFile), { recursive: true, force: true });
    await rm(dirname(sleeps.outputFile), { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
