import { expect, test } from 'vitest';
import { parseAgentFile } from '../src/subagents/definitions.ts';

const base = '/tmp/tool-specs';

test('[G2-23] definition tool lists preserve spaces and commas inside argument scopes', () => {
  const parsed = parseAgentFile('agent.md', '---\nname: scoped\ndescription: scoped agent\ntools: Bash(git *) Edit Agent(a, b)\ndisallowedTools: Bash(rm *) Write\n---\nComplete the task.', 'projectSettings', base);
  expect(parsed.agent?.tools).toEqual(['Bash(git *)', 'Edit', 'Agent(a, b)']);
  expect(parsed.agent?.disallowedTools).toEqual(['Bash(rm *)', 'Write']);
});

test('[G2-23] unclosed tool scopes reject the definition instead of widening permissions', () => {
  const parsed = parseAgentFile('agent.md', '---\nname: scoped\ndescription: scoped agent\ntools: Bash(git *\n---\nComplete the task.', 'projectSettings', base);
  expect(parsed.agent).toBeUndefined();
  expect(parsed.error).toContain('Unbalanced tool specification');
});
