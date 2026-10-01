import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

const cases = [
  { label: 'default', field: '', omitted: false },
  { label: 'boolean', field: 'omitClaudeMd: true\n', omitted: true },
  { label: 'string', field: 'omitClaudeMd: "true"\n', omitted: true },
];

test.for(cases)('[G3-11] $label child context omission preserves the parent loader', async ({ field, omitted }) => {
  const fixture = await workerFixture();
  try {
    await writeFile(join(fixture.dir, 'AGENTS.md'), 'PROJECT_CONTEXT_SENTINEL');
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/context-probe.md'), `---\nname: context-probe\ndescription: context probe\n${field}---\nComplete the task.`);
    clearAgentCache();
    const parent = new DefaultResourceLoader({ cwd: fixture.dir, agentDir: join(fixture.dir, 'parent-settings'), noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true });
    await parent.reload();
    const before = parent.getAgentsFiles();
    expect(before.agentsFiles.some((file) => file.content.includes('PROJECT_CONTEXT_SENTINEL'))).toBe(true);
    expect((await fixture.call('Agent', { description: 'context omission', prompt: 'ordinary task', subagent_type: 'context-probe', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    const system = await readFile(join(fixture.dir, 'child-system.txt'), 'utf8');
    expect(system.includes('PROJECT_CONTEXT_SENTINEL')).toBe(!omitted);
    expect(parent.getAgentsFiles()).toEqual(before);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
