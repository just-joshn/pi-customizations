import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Check } from 'typebox/value';
import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test('[G1-02] native model receives the public parameter contract and supported isolation options', async () => {
  const fixture = await workerFixture();
  try {
    await fixture.session.prompt('inspect parameter declarations');
    const declarations = JSON.parse(await readFile(join(fixture.dir, 'tool-schemas.json'), 'utf8'));
    const schema = declarations.Agent;
    const fields = schema.properties;
    expect(fields.description.description).toBe('A short (3-5 word) description of the task');
    expect(fields.prompt.description).toBe('The task for the agent to perform');
    expect(fields.subagent_type.description).toBe('The type of specialized agent to use for this task');
    expect(fields.subagent_type).not.toHaveProperty('enum');
    expect(fields.subagent_type.type).toBe('string');
    expect(fields.model.anyOf.map((entry: { const: string }) => entry.const)).toEqual(['sonnet', 'opus', 'haiku', 'fable']);
    expect(fields.model.description).toContain("Takes precedence over the agent definition's model frontmatter");
    expect(fields.model.description).toContain('Ignored for subagent_type: "fork"');
    expect(fields.model.description).toBe(
      `Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the configured default subagent model. If omitted, uses the agent definition's model, else the default (inherits from the parent unless a default subagent model is configured). Ignored for subagent_type: "fork" \u2014 forks always inherit the parent model.`,
    );
    expect(fields.run_in_background.type).toBe('boolean');
    expect(fields.run_in_background.description).toBe(
      `Agents run in the background by default; you will be notified when one completes. Set to false only when your very next action depends on this agent's result and nothing else could usefully happen while it runs \u2014 otherwise leave it in the background so the user can hand you other work.`,
    );
    expect(fields.run_in_background).not.toHaveProperty('default');
    expect(fields.run_in_background.description.startsWith('Agents run in the background by default')).toBe(true);
    expect(fields.isolation.description).toBe('Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo.');
    expect(fields.isolation.const).toBe('worktree');
    expect(['worktree', 'remote'].map((isolation) => Check(schema, { description: 'task', prompt: 'task', isolation }))).toEqual([true, false]);
    expect(['sonnet', 'opus', 'haiku', 'fable'].map((model) => Check(schema, { description: 'task', prompt: 'task', model }))).toEqual([true, true, true, true]);
    expect(Check(schema, { description: 'task', prompt: 'task', model: 'gpt' })).toBe(false);
    expect(Check(schema, { description: 'one two three four five six seven eight nine ten', prompt: 'task' })).toBe(true);
    expect(Check(schema, { description: 'task' })).toBe(false);
    expect(Check(schema, { description: 'task', prompt: 'task', isolation: 'docker' })).toBe(false);
  } finally {
    await fixture.close();
  }
});
