import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { packageAgents, pluginPackage } from '../src/subagents/plugin-agents.ts';

let dir = '';
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-agents-fields-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(path: string, body: string): string {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return full;
}

function loadOne(frontmatter: string, body = 'Body.') {
  write('kit/package.json', JSON.stringify({ name: 'kit' }));
  const file = write('kit/agents/one.md', `---\n${frontmatter}\n---\n${body}`);
  const warnings: string[] = [];
  const agents = packageAgents(pluginPackage(join(dir, 'kit')), warnings);
  return { file, warnings, agent: agents[0], count: agents.length };
}

test('valid memory scopes are kept and an unknown scope warns and is dropped', () => {
  const valid = loadOne('description: d\nmemory: project');
  expect(valid.agent).toMatchObject({ memory: 'project' });
  expect(valid.warnings).toEqual([]);
  const invalid = loadOne('description: d\nmemory: galaxy');
  expect(invalid.agent).not.toHaveProperty('memory');
  expect(invalid.warnings).toEqual([`Plugin agent file ${invalid.file} has invalid memory value 'galaxy'. Valid options: user, project, local`]);
});

test.for([
  { effort: 'HIGH', expected: 'high' },
  { effort: ' max ', expected: 'max' },
])('effort $effort is normalised to $expected', ({ effort, expected }) => {
  const result = loadOne(`description: d\neffort: ${JSON.stringify(effort)}`);
  expect(result.agent).toMatchObject({ effort: expected });
  expect(result.warnings).toEqual([]);
});

test('a quoted numeric effort string is rejected', () => {
  const result = loadOne('description: d\neffort: "7"');
  expect(result.agent).not.toHaveProperty('effort');
  expect(result.warnings).toEqual([`Plugin agent file ${result.file} has invalid effort '7'. Valid options: low, medium, high, xhigh, max or an integer`]);
});

test('an integer effort is kept and a fractional one warns', () => {
  expect(loadOne('description: d\neffort: 12').agent).toMatchObject({ effort: 12 });
  const fractional = loadOne('description: d\neffort: 1.5');
  expect(fractional.agent).not.toHaveProperty('effort');
  expect(fractional.warnings).toEqual([`Plugin agent file ${fractional.file} has invalid effort '1.5'. Valid options: low, medium, high, xhigh, max or an integer`]);
});

test.for([{ maxTurns: '"5"' }, { maxTurns: '0' }, { maxTurns: '2.5' }])('maxTurns $maxTurns warns and is dropped', ({ maxTurns }) => {
  const result = loadOne(`description: d\nmaxTurns: ${maxTurns}`);
  expect(result.agent).not.toHaveProperty('maxTurns');
  expect(result.warnings).toEqual([`Plugin agent file ${result.file} has invalid maxTurns '${maxTurns.replaceAll('"', '')}'. Must be a positive integer.`]);
});

test('a positive integer maxTurns is kept', () => {
  expect(loadOne('description: d\nmaxTurns: 9').agent).toMatchObject({ maxTurns: 9 });
});

test('presentation fields survive: disallowed tools, skills, color, model, flags and cache ttl', () => {
  const { agent, warnings } = loadOne(
    ['description: d', 'tools: Read, Grep', 'disallowedTools: Bash Write', 'skills:', '  - review', '  - 3', '  - lint', 'color: cyan', 'model: Opus-5', 'background: "true"', 'omitContextFiles: true', 'cacheTtl: 1h'].join('\n'),
  );
  expect(agent).toMatchObject({
    tools: ['Read', 'Grep'],
    disallowedTools: ['Bash', 'Write'],
    skills: ['review', 'lint'],
    color: 'cyan',
    model: 'Opus-5',
    background: true,
    omitContextFiles: true,
    cacheTtl: '1h',
  });
  expect(warnings).toEqual([]);
});

test('model inherit is normalised to lowercase and unknown colors or ttls are dropped', () => {
  const { agent } = loadOne('description: d\nmodel: INHERIT\ncolor: mauve\ncacheTtl: 5m\nbackground: false\nomitContextFiles: "no"');
  expect(agent).toMatchObject({ model: 'inherit' });
  for (const key of ['color', 'cacheTtl', 'background', 'omitContextFiles']) expect(agent).not.toHaveProperty(key);
});

test('a blank model is ignored', () => {
  expect(loadOne('description: d\nmodel: "  "').agent).not.toHaveProperty('model');
});

test.for([
  { frontmatter: 'when_to_use: Use when A', expected: 'Use when A' },
  { frontmatter: "when-to-use: 'Use when B'", expected: 'Use when B' },
  { frontmatter: 'description: 42', expected: '42' },
  { frontmatter: 'description: true', expected: 'true' },
  { frontmatter: 'description: "   "\nwhen_to_use: fallback text', expected: 'fallback text' },
  { frontmatter: 'description: [a, b]', expected: 'Agent from kit plugin' },
])('whenToUse resolves $expected from $frontmatter', ({ frontmatter, expected }) => {
  expect(loadOne(frontmatter).agent.whenToUse).toBe(expected);
});

test('a numeric name becomes the agent filename', () => {
  const { agent } = loadOne('name: 123\ndescription: d');
  expect(agent).toMatchObject({ agentType: 'kit:123', filename: '123' });
});

test('an unbalanced tool specification skips only that agent and reports the failure', () => {
  write('kit/package.json', JSON.stringify({ name: 'kit' }));
  const bad = write('kit/agents/a-bad.md', '---\ndescription: d\ntools: Bash(git\n---\nX');
  write('kit/agents/b-good.md', '---\ndescription: ok\n---\nY');
  const warnings: string[] = [];
  const agents = packageAgents(pluginPackage(join(dir, 'kit')), warnings);
  expect(agents.map((agent) => agent.agentType)).toEqual(['kit:b-good']);
  expect(warnings).toEqual([`Failed to load agent from ${bad}: Unbalanced tool specification.`]);
});
