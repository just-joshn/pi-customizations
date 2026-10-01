import { Check } from 'typebox/value';
import { expect, test } from 'vitest';
import { agentSchemaGates, buildAgentSchema, parseAgentInput } from '../src/subagents/schema.ts';

type JsonSchema = { properties: Record<string, { description?: string; pattern?: string }>; required: string[]; additionalProperties: boolean };
const keys = (env: NodeJS.ProcessEnv) => Object.keys((buildAgentSchema(agentSchemaGates(env)) as unknown as JsonSchema).properties);

test('the default offered schema matches the observed Provider CLI probe exactly', () => {
  const schema = buildAgentSchema(agentSchemaGates({})) as unknown as JsonSchema;
  expect(Object.keys(schema.properties)).toEqual(['description', 'prompt', 'subagent_type', 'model', 'run_in_background', 'isolation']);
  expect(schema.required).toEqual(['description', 'prompt']);
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.isolation?.description).toBe(
    'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" launches the agent in a remote cloud environment (always runs in background; availability is gated).',
  );
});

test.for([
  { env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, expected: ['description', 'prompt', 'subagent_type', 'model', 'isolation'] },
  { env: { CLAUDE_CODE_FORK_SUBAGENT: '1' }, expected: ['description', 'prompt', 'subagent_type', 'model', 'isolation'] },
  { env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'haiku' }, expected: ['description', 'prompt', 'subagent_type', 'run_in_background', 'isolation'] },
  { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }, expected: ['description', 'prompt', 'subagent_type', 'model', 'run_in_background', 'name', 'team_name', 'mode', 'isolation'] },
  { env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '0' }, expected: ['description', 'prompt', 'subagent_type', 'model', 'run_in_background', 'isolation'] },
])('gates project the offered schema: $env', ({ env, expected }) => {
  expect(keys(env)).toEqual(expected);
});

test('the team profile carries the recovered name, team_name and mode descriptions and pattern', () => {
  const schema = buildAgentSchema(agentSchemaGates({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: 'true' })) as unknown as JsonSchema;
  expect(schema.properties.name).toMatchObject({ description: 'Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running.', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' });
  expect(schema.properties.team_name?.description).toBe('Deprecated; ignored. The session has a single implicit team.');
  expect(schema.properties.mode?.description).toBe("Deprecated; ignored. Subagents inherit the parent session's permission mode; agent-definition frontmatter may override it.");
});

test('cwd is never offered, even with every gate on', () => {
  expect(keys({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', CLAUDE_CODE_FORK_SUBAGENT: '1' })).not.toContain('cwd');
});

test('the internal input contract accepts an absolute cwd and names that the offered schema omits', () => {
  expect(Check(buildAgentSchema(agentSchemaGates({})), { description: 'd', prompt: 'p', cwd: '/tmp' })).toBe(false);
  expect(parseAgentInput({ description: 'd', prompt: 'p', cwd: '/tmp/work', name: 'scout' })).toEqual({ description: 'd', prompt: 'p', cwd: '/tmp/work', name: 'scout' });
});

test.for([
  { input: { description: 'd', prompt: 'p', cwd: 'relative/dir' }, message: 'cwd must be an absolute path: relative/dir' },
  { input: { description: 'd', prompt: 'p', cwd: 7 }, message: 'Invalid Agent input: /cwd: must be string' },
  { input: { prompt: 'p' }, message: 'Invalid Agent input: /: must have required properties description' },
])('the internal input contract refuses malformed input: $message', ({ input, message }) => {
  expect(() => parseAgentInput(input)).toThrow(message);
});
