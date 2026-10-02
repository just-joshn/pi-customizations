import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { noParentSkillsMessage } from '../src/subagents/skill-loading.ts';
import { workerFixture } from './worker-fixture.ts';

async function childTranscript(dir: string): Promise<string> {
  const paths = globSync(join(dir, 'sessions', '**', 'subagents', '**', 'agent-*.jsonl'));
  if (paths.length === 0) throw new Error('no child transcript');
  return (await readFile(paths[0], 'utf8')) ?? '';
}

test('a declared skill is copied into the child before its first turn', async () => {
  const fixture = await workerFixture({ agents: { packed: '---\nname: packed\ndescription: d\nskills: [deslop]\ntools: [read]\n---\nBody\n' } });
  try {
    await fixture.call('task', { agent_type: 'packed', name: 'packed', description: 'probe', prompt: 'hello' });
    const transcript = await childTranscript(fixture.dir);
    expect(transcript).toContain('pstack-skill-preload');
    expect(transcript).toContain('Skill deslop.');
  } finally {
    await fixture.close();
  }
});

test('a missing declared skill warns by name and the child still runs', async () => {
  const fixture = await workerFixture({ agents: { packless: '---\nname: packless\ndescription: d\nskills: [nope]\n---\nBody\n' } });
  try {
    const result = await fixture.call('task', { agent_type: 'packless', name: 'packless', description: 'probe', prompt: 'hello' });
    expect((result.content[0] as { text: string }).text).toBe('users=1');
    expect(fixture.subagentLogs).toContain("[Agent: packless] Skill 'nope' was not found");
  } finally {
    await fixture.close();
  }
});

test('no parent skills at all reports the documented message', async () => {
  expect(noParentSkillsMessage).toBe('subagent requested skills but the parent session has no loaded skills');
});
