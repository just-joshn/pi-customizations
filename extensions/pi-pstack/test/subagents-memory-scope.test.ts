import { expect, test } from 'vitest';
import { parseAgentFile } from '../src/subagents/definitions.ts';
import { parseMemoryScope, resolveMemoryScope } from '../src/subagents/memory-scope.ts';

test('[G2-29] invalid frontmatter memory warns and is omitted', () => {
  const parsed = parseAgentFile('/p/memory.md', '---\nname: probe\ndescription: Probe\nmemory: team\n---\nTask', 'projectSettings', '/p');
  expect(parsed.agent).toMatchObject({ agentType: 'probe', systemPrompt: 'Task' });
  expect(parsed.agent).not.toHaveProperty('memory');
  expect(parsed.warnings).toEqual(["Agent file /p/memory.md has invalid memory value 'team'. Valid options: user, project, local"]);
});

test.for([null, undefined, [], 1, { layer: 'project', projectKey: '/work', agentType: 1 }, { layer: 'user', agentType: 'probe', relPath: 1 }])('[G2-29] malformed scope %j refuses', (value) => {
  expect(() => parseMemoryScope(value)).toThrow();
});

test.for([
  { value: { layer: 'user', relPath: 'MEMORY.md' }, error: 'scope.relPath requires scope.agentType: an agent-memory relPath narrows one agent directory' },
  { value: { layer: 'project' }, error: 'scope.projectKey required for the project and local layers' },
  { value: { layer: 'local' }, error: 'scope.projectKey required for the project and local layers' },
  { value: { layer: 'user', projectKey: undefined }, error: 'scope.projectKey the user layer is not keyed by project' },
  { value: { layer: 'team' }, error: 'scope.layer must be user, project or local' },
])('[G2-29] invalid scope reports $error', ({ value, error }) => {
  expect(() => parseMemoryScope(value)).toThrow(error);
});

test('[G2-29] configured user storage root replaces the default Pi directory', () => {
  expect(resolveMemoryScope(parseMemoryScope({ layer: 'user', agentType: 'probe' }), '/home', '/configured')).toBe('/configured/agent-memory/probe');
});

test('[G2-29] a validated narrow scope resolves beneath its agent directory', () => {
  const scope = parseMemoryScope({ layer: 'project', projectKey: '/work', agentType: 'probe', relPath: 'nested/MEMORY.md' });
  expect(resolveMemoryScope(scope, '/home')).toBe('/work/.pi/agent-memory/probe/nested/MEMORY.md');
  expect(resolveMemoryScope(parseMemoryScope({ layer: 'user', agentType: 'probe' }), '/home')).toBe('/home/.pi/agent/agent-memory/probe');
});

test.for(['../secret', '/secret', 'nested/../../secret'])('[G2-29] relative scope path %s cannot escape', (relPath) => {
  expect(() => resolveMemoryScope(parseMemoryScope({ layer: 'local', projectKey: '/work', agentType: 'probe', relPath }), '/home')).toThrow('Invalid agent-memory relative path');
});
