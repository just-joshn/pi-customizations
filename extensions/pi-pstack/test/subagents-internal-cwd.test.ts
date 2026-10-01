import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

function cwdRewrite(target: () => string, isolation?: 'worktree'): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', (event) => {
      if (event.toolName !== 'Agent') return;
      const input = event.input as Record<string, unknown>;
      input.cwd = target();
      if (isolation) input.isolation = isolation;
    });
  };
}

test('an internal tool_call rewrite runs the child in the supplied absolute cwd', async () => {
  let target = '';
  const fixture = await workerFixture({ extensions: [cwdRewrite(() => target)] });
  try {
    target = join(fixture.dir, 'nested-work');
    await mkdir(target);
    await fixture.session.prompt('INTERNAL_CWD_CONTRACT');
    const listed = (await fixture.call('ListAgents', {})) as { details: { agents: { agentId: string }[] } };
    const id = listed.details.agents[0]?.agentId ?? '';
    const record = (await fixture.call('TaskOutput', { task_id: id, block: true })) as { details: { cwd: string; status: string } };
    expect(record.details).toMatchObject({ cwd: await realpath(target), status: 'settled' });
  } finally {
    await fixture.close();
  }
});

test('an internal cwd combined with worktree isolation is refused before any child starts', async () => {
  const fixture = await workerFixture();
  try {
    await expect(fixture.call('Agent', { description: 'conflict', prompt: 'p', cwd: fixture.dir, isolation: 'worktree' })).rejects.toThrow('cwd and isolation: "worktree" are mutually exclusive.');
    expect(((await fixture.call('ListAgents', {})) as { details: { agents: unknown[] } }).details.agents).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('a relative internal cwd is refused before any child starts', async () => {
  const fixture = await workerFixture();
  try {
    await expect(fixture.call('Agent', { description: 'relative', prompt: 'p', cwd: 'nested-work' })).rejects.toThrow('cwd must be an absolute path: nested-work');
  } finally {
    await fixture.close();
  }
});
