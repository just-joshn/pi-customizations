import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentSession } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('invalid child tool policy releases its native session before refusal returns', async () => {
  const fixture = await workerFixture();
  const dispose = vi.spyOn(AgentSession.prototype, 'dispose');
  try {
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/invalid.md'), '---\nname: invalid\ndescription: invalid tools\ntools: [UnavailableTool]\n---\nComplete the task.');
    clearAgentCache();
    await expect(fixture.call('Agent', { description: 'invalid child policy', prompt: 'never executes', subagent_type: 'invalid', run_in_background: false })).rejects.toThrow('unrecognized [UnavailableTool]');
    expect(dispose).toHaveBeenCalledOnce();
    expect(dispose.mock.contexts).not.toContain(fixture.session);
    expect((await fixture.call('ListAgents', {})).details).toEqual({ agents: [] });
    await expect(readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fixture.call('Agent', { description: 'subsequent valid child', prompt: 'ordinary task', run_in_background: false })).details).toMatchObject({ status: 'completed' });
  } finally {
    dispose.mockRestore();
    clearAgentCache();
    await fixture.close();
  }
});
