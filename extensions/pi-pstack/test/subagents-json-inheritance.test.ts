import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G2-05] nested admission restores the parent JSON definition input', async () => {
  const fixture = await workerFixture({
    flags: {
      agents: JSON.stringify({
        'json-parent': { description: 'JSON parent', prompt: 'Spawn the requested leaf.', tools: ['Agent'] },
        'json-leaf': { description: 'JSON leaf', prompt: 'JSON_LEAF_SYSTEM_SENTINEL', tools: ['read'], model: 'worker-test/alternate', effort: 'high' },
      }),
    },
  });
  try {
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'JSON parent', prompt: 'SPAWN_JSON_LEAF', subagent_type: 'json-parent', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    const results = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8'));
    expect(results).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: 'Agent', isError: false, details: expect.objectContaining({ agentType: 'json-leaf', status: 'completed', resolvedModel: 'worker-test/alternate' }) })]),
    );
    const tools = JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8'));
    expect(tools).toEqual(['Agent']);
    expect(await readFile(join(fixture.dir, 'child-system-history.jsonl'), 'utf8')).toContain('JSON_LEAF_SYSTEM_SENTINEL');
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
