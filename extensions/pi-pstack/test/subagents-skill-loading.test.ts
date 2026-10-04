import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { noParentSkillsMessage } from '../src/subagents/skill-loading.ts';
import { expectDefined } from './support/expect-defined.ts';
import { workerFixture } from './worker-fixture.ts';

async function childTranscript(dir: string): Promise<string> {
  const paths = globSync(join(dir, 'sessions', '**', 'subagents', '**', 'agent-*.jsonl'));
  if (paths.length === 0) throw new Error('no child transcript');
  return (await readFile(expectDefined(paths[0]), 'utf8')) ?? '';
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

test('the child transcript keeps the agent filename while its session id differs from the agent id', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('task', { agent_type: 'general-purpose', name: 'probe', description: 'probe', prompt: 'hello' });
    const agentId = String((started as { details: { agent_id: string } }).details.agent_id);
    const paths = globSync(join(fixture.dir, 'sessions', '**', 'subagents', '**', 'agent-*.jsonl'));
    expect(paths).toHaveLength(1);
    const path = expectDefined(paths[0]);
    expect(path.endsWith(`agent-${agentId}.jsonl`)).toBe(true);
    const header = JSON.parse(expectDefined((await readFile(path, 'utf8')).split('\n')[0])) as { id: string; parentSession?: string };
    expect(header.id).not.toBe(agentId);
    expect(header.parentSession).toBe(fixture.session.sessionManager.getSessionFile());
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
