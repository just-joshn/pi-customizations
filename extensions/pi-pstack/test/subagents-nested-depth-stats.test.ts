import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test.for(['SPAWN_AGENT', 'SPAWN_LEGACY_TASK'])('[G1-13] %s aggregates both identities in the initiating SDK scope', async (prompt) => {
  const fixture = await workerFixture();
  try {
    expect((await fixture.call('Agent', { description: 'nested maximum', prompt, run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(fixture.subagentStats.at(-1)).toMatchObject({ spawned: 2, completed: 2, max_depth: 2 });
  } finally {
    await fixture.close();
  }
});

test('[G1-13] a caught grandchild failure contributes to root failure totals', async () => {
  const fixture = await workerFixture();
  try {
    expect((await fixture.call('Agent', { description: 'nested failure', prompt: 'SPAWN_BROKEN_GRANDCHILD', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(fixture.subagentStats.at(-1)).toMatchObject({ spawned: 2, completed: 1, failed: 1, killed: 0, max_depth: 2 });
  } finally {
    await fixture.close();
  }
});

test('[G1-13] sibling child streams count each nested identity once', async () => {
  const fixture = await workerFixture();
  try {
    const results = await Promise.all(['SPAWN_AGENT', 'SPAWN_LEGACY_TASK'].map((prompt) => fixture.call('Agent', { description: 'sibling child', prompt, run_in_background: false })));
    expect(results.map((result) => result.details)).toEqual([expect.objectContaining({ status: 'completed' }), expect.objectContaining({ status: 'completed' })]);
    expect(fixture.subagentStats.at(-1)).toMatchObject({ spawned: 4, completed: 4, failed: 0, killed: 0, max_depth: 2 });
  } finally {
    await fixture.close();
  }
});

test('[G1-13] a resumed identity adds only its newly launched descendants', async () => {
  const fixture = await workerFixture();
  try {
    const first = await fixture.call('Task', { prompt: 'ordinary task', run_in_background: false });
    const details = first.details;
    if (typeof details !== 'object' || details === null || !('id' in details)) throw new Error('Expected task identity');
    await fixture.call('Task', { resume: details.id, prompt: 'SPAWN_AGENT', run_in_background: false });
    expect(fixture.subagentStats.at(-1)).toMatchObject({ spawned: 2, completed: 2, failed: 0, killed: 0, max_depth: 2 });
  } finally {
    await fixture.close();
  }
});

test('[G1-13] depth-three descendants propagate through both child boundaries', async () => {
  const fixture = await workerFixture();
  try {
    expect((await fixture.call('Agent', { description: 'deep tree', prompt: 'SPAWN_DEEP_TREE', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(fixture.subagentStats.at(-1)).toMatchObject({ spawned: 3, completed: 3, failed: 0, killed: 0, max_depth: 3 });
  } finally {
    await fixture.close();
  }
});
