import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentSession } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

async function setup(dir: string, requested: string) {
  const agents = join(dir, '.pi/agents');
  const skills = join(dir, '.pi/skills/directory-alias');
  await mkdir(agents, { recursive: true });
  await mkdir(skills, { recursive: true });
  await writeFile(join(skills, 'SKILL.md'), '---\nname: canonical-skill\ndescription: preload probe\n---\nSKILL_PRELOAD_SENTINEL');
  await writeFile(join(agents, 'skilled.md'), `---\nname: skilled\ndescription: skilled worker\nskills: [${requested}]\n---\nUse the declared skill.`);
  clearAgentCache();
}

test.each(['canonical-skill', 'directory-alias'])('[G2-26] declared skill %s reaches the first child messages', async (requested) => {
  const fixture = await workerFixture();
  try {
    await setup(fixture.dir, requested);
    const result = await fixture.call('Agent', { description: 'preloaded skill', prompt: 'ordinary task', subagent_type: 'skilled', run_in_background: false });
    expect(result.details).toMatchObject({ status: 'completed' });
    const users = JSON.parse(await readFile(join(fixture.dir, 'child-input.txt'), 'utf8')) as unknown[];
    expect(JSON.stringify(users[0])).toContain('SKILL_PRELOAD_SENTINEL');
    expect(fixture.subagentLogs).toContain("[Agent: skilled] Preloaded skill 'canonical-skill'");
    const { agentId } = result.details as { agentId: string };
    await fixture.call('SendMessage', { to: agentId, message: 'resumed ordinary task' });
    expect((await fixture.call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled' });
    const requests = (await readFile(join(fixture.dir, 'provider-inputs.jsonl'), 'utf8')).trim().split('\n');
    const resumed = requests.findLast((request) => request.includes('resumed ordinary task'));
    expect(resumed).toBeDefined();
    expect(resumed?.split('SKILL_PRELOAD_SENTINEL').length).toBe(2);
    expect(fixture.subagentLogs.filter((message) => message === "[Agent: skilled] Preloaded skill 'canonical-skill'")).toHaveLength(1);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('skill message failure warns and does not abandon the created child session', async () => {
  const fixture = await workerFixture();
  const spy = vi.spyOn(AgentSession.prototype, 'sendCustomMessage').mockRejectedValue(new Error('message persist failed'));
  try {
    await setup(fixture.dir, 'canonical-skill');
    expect((await fixture.call('Agent', { description: 'failed preload', prompt: 'ordinary task', subagent_type: 'skilled', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(fixture.subagentLogs).toContain("[Agent: skilled] Warning: Skill 'canonical-skill' specified in frontmatter could not be preloaded: Error: message persist failed");
  } finally {
    spy.mockRestore();
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-26] missing skill emits exact warning and child still runs', async () => {
  const fixture = await workerFixture();
  try {
    await setup(fixture.dir, 'not-a-skill');
    expect((await fixture.call('Agent', { description: 'missing preload', prompt: 'ordinary task', subagent_type: 'skilled', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(fixture.subagentLogs).toContain("[Agent: skilled] Warning: Skill 'not-a-skill' specified in frontmatter was not found");
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
