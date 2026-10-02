import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clearAgentCache, discoverAgents, parseAgentFile } from '../src/subagents/definitions.ts';

let dir = '';
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'defs-frontmatter-')));
  clearAgentCache();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  clearAgentCache();
});

function write(path: string, body: string): string {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return full;
}
const agent = (name: string, extra = '', prompt = 'Prompt body') => `---\nname: ${name}\ndescription: does ${name}\n${extra}---\n${prompt}\n`;
const parse = (text: string) => parseAgentFile('/p/a.md', text, 'userSettings', '/p');

test('skills may be a comma or whitespace separated string and non-string array items are dropped', () => {
  expect(parse(agent('z', 'skills: "review, lint  format"\n')).agent).toMatchObject({ skills: ['review', 'lint', 'format'] });
  expect(parse(agent('z', 'skills:\n  - " review "\n  - 4\n  - lint\n')).agent).toMatchObject({ skills: ['review', 'lint'] });
  expect(parse(agent('z', 'skills: 5\n')).agent).not.toHaveProperty('skills');
});

test('isolation accepts worktree and remote only', () => {
  expect(parse(agent('z', 'isolation: remote\n')).agent).toMatchObject({ isolation: 'remote' });
  expect(parse(agent('z', 'isolation: worktree\n')).agent).toMatchObject({ isolation: 'worktree' });
  const invalid = parse(agent('z', 'isolation: 3\n'));
  expect(invalid.agent).not.toHaveProperty('isolation');
  expect(invalid.warnings).toEqual(["Agent file /p/a.md has invalid isolation value '3'. Valid options: worktree, remote"]);
});

test.for([{ memory: 'user' }, { memory: 'project' }, { memory: 'local' }])('memory $memory is kept', ({ memory }) => {
  expect(parse(agent('z', `memory: ${memory}\n`)).agent).toMatchObject({ memory });
});

test.for([
  { effort: ' High ', expected: 'high' },
  { effort: 'XHIGH', expected: 'xhigh' },
])('effort $effort resolves to $expected', ({ effort, expected }) => {
  expect(parse(agent('z', `effort: ${JSON.stringify(effort)}\n`)).agent).toMatchObject({ effort: expected });
});

test('an integer effort is a thinking budget', () => {
  expect(parse(agent('z', 'effort: 12000\n')).agent).toMatchObject({ effort: 12000 });
});

test('a quoted numeric effort and a fractional effort are rejected with the original value in the warning', () => {
  expect(parse(agent('z', 'effort: "7"\n')).warnings).toEqual(["Agent file /p/a.md has invalid effort '7'. Valid options: low, medium, high, xhigh, max or an integer"]);
  expect(parse(agent('z', 'effort: 2.5\n')).warnings).toEqual(["Agent file /p/a.md has invalid effort '2.5'. Valid options: low, medium, high, xhigh, max or an integer"]);
});

test.for([{ mode: 'plan' }, { mode: 'acceptEdits' }, { mode: 'bypassPermissions' }])('permissionMode $mode is accepted', ({ mode }) => {
  expect(parse(agent('z', `permissionMode: ${mode}\n`)).agent).toMatchObject({ permissionMode: mode });
});

test('a non-string permissionMode warns and is dropped', () => {
  const parsed = parse(agent('z', 'permissionMode: 7\n'));
  expect(parsed.agent).not.toHaveProperty('permissionMode');
  expect(parsed.warnings).toEqual(["Agent file /p/a.md has invalid permissionMode '7'. Valid options: acceptEdits, auto, bypassPermissions, default, dontAsk, plan"]);
});

test.for([{ value: 'false' }, { value: '"false"' }])('observeSubagents $value turns observation off', ({ value }) => {
  expect(parse(agent('z', `observeSubagents: ${value}\n`)).agent).toMatchObject({ observeSubagents: false });
});

test('observeSubagents true leaves the field unset and cacheTtl 1h is retained', () => {
  const parsed = parse(agent('z', 'observeSubagents: true\ncacheTtl: 1h\n')).agent;
  expect(parsed).not.toHaveProperty('observeSubagents');
  expect(parsed).toMatchObject({ cacheTtl: '1h' });
});

test.for([
  { text: '---\ndescription: d\n---\nbody', title: 'no name' },
  { text: '---\nname: "   "\ndescription: d\n---\nbody', title: 'blank name' },
  { text: '---\nname: 12\ndescription: d\n---\nbody', title: 'numeric name' },
  { text: 'plain markdown without frontmatter', title: 'no frontmatter' },
])('$title yields no agent and no diagnostics', ({ text }) => {
  expect(parse(text)).toEqual({ warnings: [] });
});

test('a colon in the name reports the reserved namespace separator', () => {
  expect(parse(agent('team:lead'))).toEqual({
    warnings: ["Agent file /p/a.md has invalid name 'team:lead': names must not contain ':' (reserved for plugin namespacing)"],
    error: 'Failed to parse agent from /p/a.md: Invalid "name": names must not contain ":" (reserved for plugin namespacing)',
  });
});

test('a blank description is reported as missing', () => {
  expect(parse('---\nname: z\ndescription: "  "\n---\nbody')).toEqual({
    warnings: ["Agent file /p/a.md is missing required 'description' in frontmatter"],
    error: 'Failed to parse agent from /p/a.md: Missing required "description" field in frontmatter',
  });
});

test('tools without Skill leave skills unset and a Skill-only list yields empty tools plus empty skills', () => {
  expect(parse(agent('z', 'tools: Read\n')).agent).not.toHaveProperty('skills');
  const migrated = parse(agent('z', 'tools: Skill\nskills: review\n'));
  expect(migrated.agent).toMatchObject({ tools: [], skills: ['review'] });
  expect(migrated.warnings).toEqual(["Agent file /p/a.md: 'Skill' in tools is deprecated; use the skills field instead."]);
});

test('malformed YAML frontmatter is ignored with a warning and the whole text becomes the body', () => {
  const text = '---\nname: [unclosed\n---\nbody';
  const parsed = parse(text);
  expect(parsed.agent).toBeUndefined();
  expect(parsed.warnings).toHaveLength(1);
  expect(parsed.warnings[0]).toMatch(/^YAML frontmatter in \/p\/a\.md failed to parse and was ignored: /);
});

test('initialPrompt and the critical reminder are trimmed and blank values are dropped', () => {
  const set = parse(agent('z', 'initialPrompt: " go "\ncriticalSystemReminder_EXPERIMENTAL: " careful "\nomitContextFiles: true\ncolor: pink\n')).agent;
  expect(set).toMatchObject({ initialPrompt: 'go', criticalSystemReminder_EXPERIMENTAL: 'careful', omitContextFiles: true, color: 'pink' });
  const blank = parse(agent('z', 'initialPrompt: " "\ncriticalSystemReminder_EXPERIMENTAL: ""\ncolor: beige\n')).agent;
  for (const key of ['initialPrompt', 'criticalSystemReminder_EXPERIMENTAL', 'color', 'omitContextFiles']) expect(blank).not.toHaveProperty(key);
});

test('an unbalanced tool specification fails the parse with a generic error and a detailed warning', () => {
  const parsed = parse(agent('z', 'tools: Bash(git\n'));
  expect(parsed).toEqual({
    warnings: ['Error parsing agent from /p/a.md: Unbalanced tool specification.'],
    error: 'Failed to parse agent from /p/a.md: Unknown parsing error',
  });
});

test('default user directories come from PI_CODING_AGENT_DIR and the home directory', () => {
  const home = join(dir, 'home');
  write('home/agent-dir/agents/mine.md', agent('mine', '', 'from pi dir'));
  write('home/.claude/agents/legacy.md', agent('legacy', '', 'from claude dir'));
  vi.stubEnv('HOME', home);
  const env = { PI_CODING_AGENT_DIR: join(home, 'agent-dir'), PI_MANAGED_DIR: join(dir, 'none') };
  const found = discoverAgents({ root: join(dir, 'project'), env });
  const user = found.activeAgents.filter((entry) => entry.source === 'userSettings');
  expect(user.map((entry) => [entry.agentType, entry.systemPrompt])).toEqual([
    ['legacy', 'from claude dir'],
    ['mine', 'from pi dir'],
  ]);
});

test('plugin agents may be supplied by a callback that reports warnings into discovery', () => {
  const found = discoverAgents({
    root: dir,
    userDirs: [],
    policyDirs: [],
    env: {},
    pluginAgents: (warnings) => {
      warnings.push('plugin callback ran');
      return [];
    },
  });
  expect(found.warnings).toEqual(['plugin callback ran']);
});

test('additional directories mark their agents with fromAdditionalDirectory', () => {
  write('extra/e.md', agent('e'));
  const found = discoverAgents({ root: dir, userDirs: [], policyDirs: [], additionalDirs: [join(dir, 'extra')], env: {} });
  expect(found.activeAgents.find((entry) => entry.agentType === 'e')).toMatchObject({ source: 'projectSettings', fromAdditionalDirectory: true });
});
