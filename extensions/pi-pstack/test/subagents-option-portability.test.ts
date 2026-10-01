import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

async function configured(dir: string, fields: string) {
  const path = join(dir, '.pi/agents');
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'options.md'), `---\nname: options\ndescription: options probe\n${fields}---\nbody`);
  clearAgentCache();
}

test('[G2-28] unsupported per-agent cache TTL is explicitly ignored during real child launch', async () => {
  const fixture = await workerFixture();
  try {
    await configured(fixture.dir, 'cacheTtl: 1h\n');
    const result = await fixture.call('Agent', { description: 'TTL fallback', prompt: 'hello', subagent_type: 'options', run_in_background: false });
    expect(result.details).toMatchObject({ status: 'completed' });
    expect(fixture.subagentLogs).toContain("Agent 'options' cacheTtl '1h' ignored: Pi child sessions have no per-agent cache TTL setting.");
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-options.json'), 'utf8'))).not.toHaveProperty('cacheTtl');
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test.each(['observer: watcher\n', 'observerMessage: report risks\n'])('[G2-28] unsupported observer configuration %s starts no child', async (fields) => {
  const fixture = await workerFixture();
  try {
    await configured(fixture.dir, fields);
    await expect(fixture.call('Agent', { description: 'observer fallback', prompt: 'never runs', subagent_type: 'options' })).rejects.toThrow(
      "Agent 'options' requests observer behavior, which is unavailable in Pi. Remove observer and observerMessage to run this agent.",
    );
    expect((await fixture.call('ListAgents', {})).details).toEqual({ agents: [] });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
