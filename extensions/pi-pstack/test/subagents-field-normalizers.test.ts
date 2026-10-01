import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache, parseAgentFile } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G2-06] native discovery inherits an empty frontmatter model', async () => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/empty-model.md'), '---\nname: empty-model\ndescription: invalid model\nmodel: ""\n---\nComplete the task.');
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'empty model', prompt: 'inherited model', subagent_type: 'empty-model', run_in_background: false })).details).toMatchObject({ status: 'completed', agentType: 'empty-model' });
    expect(fixture.subagentLogs.join('\n')).not.toContain('Model cannot be empty');
    expect(await readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).toContain('inherited model');
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

function parse(fields: string) {
  return parseAgentFile('/p/a.md', `---\nname: normal\ndescription: normalized agent\n${fields}\n---\nComplete the task.`, 'projectSettings', '/p');
}

test.for(['""', '"   "'])('[G2-06] empty frontmatter model %s is omitted', (model) => {
  const result = parse(`model: ${model}`);
  expect(result.agent).toMatchObject({ agentType: 'normal' });
  expect(result.agent).not.toHaveProperty('model');
  expect(result.error).toBeUndefined();
});

test.for(['true', '"true"'])('[G2-06] true background %s is stored', (value) => {
  const result = parse(`background: ${value}`);
  expect(result.agent).toMatchObject({ agentType: 'normal', background: true });
  expect(result.warnings).toEqual([]);
});

test('[G2-06] positive maxTurns stores the boundary value', () => {
  const result = parse('maxTurns: 1');
  expect(result.agent).toMatchObject({ agentType: 'normal', maxTurns: 1 });
  expect(result.warnings).toEqual([]);
});

test('[G2-06] invalid background warns with the exact source text', () => {
  const result = parse('background: yes');
  expect(result.agent).toMatchObject({ agentType: 'normal' });
  expect(result.agent).not.toHaveProperty('background');
  expect(result.warnings).toEqual(["Agent file /p/a.md has invalid background value 'yes'. Must be 'true', 'false', or omitted."]);
});

test.for(['false', '"false"'])('[G2-06] false background %s is omitted without warning', (value) => {
  const result = parse(`background: ${value}`);
  expect(result.agent).toMatchObject({ agentType: 'normal', systemPrompt: 'Complete the task.' });
  expect(result.agent).not.toHaveProperty('background');
  expect(result.warnings).toEqual([]);
});

test.for(['-1', '1.5', '"3"', '0'])('[G2-06] invalid maxTurns %s warns without storing', (value) => {
  const result = parse(`maxTurns: ${value}`);
  expect(result.agent).toMatchObject({ agentType: 'normal' });
  expect(result.agent).not.toHaveProperty('maxTurns');
  expect(result.warnings).toEqual([`Agent file /p/a.md has invalid maxTurns '${value.replaceAll('"', '')}'. Must be a positive integer.`]);
});

test('[G2-06] deprecated Skill preserves actual declared skills without inventing one', () => {
  const result = parse('tools: Read, Skill\nskills: [existing]');
  expect(result.agent).toMatchObject({ tools: ['Read'], skills: ['existing'] });
  expect(result.warnings).toEqual(["Agent file /p/a.md: 'Skill' in tools is deprecated; use the skills field instead."]);
});
