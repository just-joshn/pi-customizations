import { expect, test } from 'vitest';
import { parseCustomAgent } from '../src/subagents/custom-agents.ts';

const origin = { source: 'project', path: '/repo/.github/agents/reviewer.agent.md' } as const;
const document = (frontmatter: string, body = 'You review code.') => `---\n${frontmatter}\n---\n${body}\n`;

test('a minimal agent takes its name from the file and defaults the optional fields', () => {
  const { agent, warnings } = parseCustomAgent(document('description: Reviews code'), origin);
  expect(warnings).toEqual([]);
  expect(agent).toEqual({
    name: 'reviewer',
    displayName: 'reviewer',
    description: 'Reviews code',
    tools: { kind: 'all' },
    promptParts: {
      includeAISafety: true,
      includeToolInstructions: true,
      includeParallelToolCalling: true,
      includeEnvironmentContext: true,
      cwdListing: 'default',
      includeDynamicContextBoard: false,
      includeSessionSearchContext: false,
      includeCloudSessionSearchContext: false,
      includeConsolidationPrompt: false,
      includeOutputChannelInstructions: false,
      includeCustomInstructions: false,
      includeCustomAgentInstructions: true,
    },
    prompt: 'You review code.',
    userInvocable: true,
    disableModelInvocation: false,
    source: 'project',
    path: '/repo/.github/agents/reviewer.agent.md',
    promptOverridable: true,
    disableable: true,
  });
});

test('kebab-case and camelCase keys name the same fields', () => {
  const kebab = parseCustomAgent(document('name: a\ndescription: d\ndisplay-name: Alpha\nmodel-policy: required\nreasoning-effort: high\nuser-invocable: false\ndisable-model-invocation: true'), origin);
  const camel = parseCustomAgent(document('name: a\ndescription: d\ndisplayName: Alpha\nmodelPolicy: required\nreasoningEffort: high\nuserInvocable: false\ndisableModelInvocation: true'), origin);
  expect(kebab.agent).toEqual(camel.agent);
  expect(kebab.agent).toMatchObject({ displayName: 'Alpha', modelPolicy: 'required', reasoningEffort: 'high', userInvocable: false, disableModelInvocation: true });
});

test('model accepts a string or an ordered list and models adds candidates', () => {
  expect(parseCustomAgent(document('description: d\nmodel: gpt-5\nmodels: [m1, m2]'), origin).agent).toMatchObject({ model: 'gpt-5', models: ['m1', 'm2'] });
  expect(parseCustomAgent(document('description: d\nmodel: [a, b]'), origin).agent).toMatchObject({ model: ['a', 'b'] });
});

test.for([
  { value: '[grep, view]', expected: { kind: 'named', names: ['grep', 'view'] } },
  { value: 'grep, view bash', expected: { kind: 'named', names: ['grep', 'view', 'bash'] } },
  { value: "'*'", expected: { kind: 'all' } },
  { value: 'all', expected: { kind: 'all' } },
])('tools $value selects $expected', ({ value, expected }) => {
  expect(parseCustomAgent(document(`description: d\ntools: ${value}`), origin).agent?.tools).toEqual(expected);
});

test('include-custom-instructions opts into repository instructions', () => {
  expect(parseCustomAgent(document('description: d\ninclude-custom-instructions: true'), origin).agent?.promptParts.includeCustomInstructions).toBe(true);
});

test('promptParts overrides valid flags and warns about unknown ones', () => {
  const { agent, warnings } = parseCustomAgent(document('description: d\npromptParts:\n  includeEnvironmentContext: false\n  includeNothing: true'), origin);
  expect(agent?.promptParts.includeEnvironmentContext).toBe(false);
  expect(warnings).toEqual(["Agent file /repo/.github/agents/reviewer.agent.md has invalid promptParts entry 'includeNothing' and it was ignored"]);
});

test('the legacy infer false switch disables model invocation', () => {
  expect(parseCustomAgent(document('description: d\ninfer: false'), origin).agent?.disableModelInvocation).toBe(true);
});

test('mcp servers accept a map keyed by server name and a list of names', () => {
  const map = parseCustomAgent(document('description: d\nmcp-servers:\n  files:\n    command: node\n    args: [server.js]'), origin).agent?.mcpServers;
  expect(map).toEqual([{ kind: 'inline', name: 'files', config: { command: 'node', args: ['server.js'] } }]);
  expect(parseCustomAgent(document('description: d\nmcpServers: [github]'), origin).agent?.mcpServers).toEqual([{ kind: 'ref', name: 'github' }]);
});

test('skills list is kept for eager loading', () => {
  expect(parseCustomAgent(document('description: d\nskills: [deslop, how]'), origin).agent?.skills).toEqual(['deslop', 'how']);
});

test.for([
  { frontmatter: 'name: -bad\ndescription: d', reason: "invalid name '-bad'" },
  { frontmatter: 'name: has space\ndescription: d', reason: "invalid name 'has space'" },
  { frontmatter: 'name: ok', reason: 'missing required "description" in frontmatter' },
])('a definition with $reason is not loaded', ({ frontmatter, reason }) => {
  expect(parseCustomAgent(document(frontmatter), origin).error).toBe(`Failed to parse agent from /repo/.github/agents/reviewer.agent.md: ${reason}`);
});

test('an invalid enum is dropped with a warning that lists the options', () => {
  const { agent, warnings } = parseCustomAgent(document('description: d\nmodel-policy: always\nreasoning-effort: extreme'), origin);
  expect(agent?.modelPolicy).toBeUndefined();
  expect(warnings).toEqual([
    "Agent file /repo/.github/agents/reviewer.agent.md has invalid modelPolicy 'always'. Valid options: preferred, required",
    "Agent file /repo/.github/agents/reviewer.agent.md has invalid reasoningEffort 'extreme'. Valid options: low, medium, high, xhigh",
  ]);
});

test('unparseable yaml frontmatter is reported and the agent needs a description', () => {
  const { agent, error, warnings } = parseCustomAgent('---\nname: [unclosed\n---\nbody\n', origin);
  expect(agent).toBeUndefined();
  expect(error).toContain('missing required "description"');
  expect(warnings[0]).toContain('failed to parse and was ignored');
});
