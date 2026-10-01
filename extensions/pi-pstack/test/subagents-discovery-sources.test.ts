import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { builtinAgents } from '../src/subagents/builtins.ts';
import { clearAgentCache, discoverAgents, parseAgentFile } from '../src/subagents/definitions.ts';

let dir = '';
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-sources-')));
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
const agent = (name: string, prompt = 'Prompt body', extra = '') => `---\nname: ${name}\ndescription: does ${name}\n${extra}---\n${prompt}\n`;
const plugin = { ...builtinAgents({})[0], agentType: 'shared', source: 'plugin' as const, baseDir: 'plugin', systemPrompt: 'plugin' } as never;
const flag = { ...builtinAgents({})[0], agentType: 'shared', source: 'flagSettings' as const, baseDir: 'flag', systemPrompt: 'flag' } as never;

const tiers = {
  plugin: () => ({ pluginAgents: [plugin] }),
  user: () => (write('user/shared.md', agent('shared', 'user')), {}),
  additional: () => (write('extra/.claude/agents/shared.md', agent('shared', 'additional')), { additionalDirs: [join(dir, 'extra/.claude/agents')] }),
  project: () => (write('proj/.claude/agents/shared.md', agent('shared', 'project')), {}),
  flag: () => ({ flagAgents: [flag] }),
  policy: () => (write('managed/.claude/agents/shared.md', agent('shared', 'policy')), {}),
};

test.for([
  { present: ['plugin'], winner: 'plugin' },
  { present: ['plugin', 'user'], winner: 'user' },
  { present: ['user', 'additional'], winner: 'additional' },
  { present: ['additional', 'project'], winner: 'project' },
  { present: ['project', 'flag'], winner: 'flag' },
  { present: ['plugin', 'user', 'additional', 'project', 'flag', 'policy'], winner: 'policy' },
] as const)('precedence builtin < plugin < user < additional < project < flag < policy: $present', ({ present, winner }) => {
  const options = Object.assign({}, ...present.map((tier) => tiers[tier]()));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [join(dir, 'user')], env: { PI_MANAGED_DIR: join(dir, 'managed') }, ...options });
  expect(found.activeAgents.find((entry) => entry.agentType === 'shared')?.systemPrompt).toBe(winner);
});

test('managed-policy definitions load from the managed directory as policySettings', () => {
  const file = write('managed/.claude/agents/guard.md', agent('guard'));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [], env: { PI_MANAGED_DIR: join(dir, 'managed') } });
  expect(found.activeAgents.find((entry) => entry.agentType === 'guard')).toMatchObject({ source: 'policySettings', filePath: file, baseDir: join(dir, 'managed/.claude/agents') });
});

test('additional-directory definitions record their provenance', () => {
  write('extra/.pi/agents/helper.md', agent('helper'));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [], additionalDirs: [join(dir, 'extra/.pi/agents')], env: {} });
  expect(found.activeAgents.find((entry) => entry.agentType === 'helper')).toMatchObject({ source: 'projectSettings', fromAdditionalDirectory: true });
});

test('current-project agents are gathered up to the git root and the deepest directory wins', () => {
  mkdirSync(join(dir, 'outside/repo/.git'), { recursive: true });
  write('outside/.claude/agents/scout.md', agent('scout', 'above the repository'));
  write('outside/repo/.claude/agents/scout.md', agent('scout', 'repository root'));
  write('outside/repo/pkg/.pi/agents/scout.md', agent('scout', 'package'));
  write('outside/repo/.claude/agents/root-only.md', agent('root-only'));
  const found = discoverAgents({ root: join(dir, 'outside/repo/pkg'), userDirs: [], env: {} });
  expect(found.activeAgents.find((entry) => entry.agentType === 'scout')?.systemPrompt).toBe('package');
  expect(found.allAgents.filter((entry) => entry.agentType === 'scout').map((entry) => entry.systemPrompt)).toEqual(['package', 'repository root']);
  expect(found.activeAgents.find((entry) => entry.agentType === 'root-only')?.source).toBe('projectSettings');
});

test('duplicate diagnostics list the active location first and name it', () => {
  const a = write('proj/.pi/agents/a/x.md', agent('x'));
  const b = write('proj/.pi/agents/b/x.md', agent('x'));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [], env: {} });
  expect(found.logs).toEqual([`[agents] Duplicate agent name 'x' (projectSettings): ${b}, ${a} \u2014 active: ${b}`]);
});

test('a shadowed duplicate group is logged without an active location', () => {
  const one = write('user/x.md', agent('x', 'one'));
  const two = write('user/nested/x.md', agent('x', 'two'));
  write('proj/.claude/agents/x.md', agent('x', 'project'));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [join(dir, 'user')], env: {} });
  expect(found.logs).toEqual([`[agents] Duplicate agent name 'x' (userSettings): ${two}, ${one}`]);
});

test('CLAUDE_CODE_SAFE_MODE limits discovery to built-ins', () => {
  write('proj/.claude/agents/custom.md', agent('custom'));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [], env: { CLAUDE_CODE_SAFE_MODE: '1' }, pluginAgents: [plugin] });
  expect(found.activeAgents.map((entry) => entry.agentType)).toEqual(['claude-code-guide', 'Explore', 'general-purpose', 'Plan', 'statusline-setup']);
});

test('oversized files are skipped with the recovered log and symlinked regular files load', () => {
  const big = write('proj/.claude/agents/big.md', agent('big', 'x'.repeat(1048577)));
  const target = write('targets/linked.md', agent('linked'));
  symlinkSync(target, join(dir, 'proj/.claude/agents/linked.md'));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [], env: {} });
  expect(found.warnings).toContain(`loadMarkdownFilesFromDir: skipping ${big}: not a regular file or exceeds 1048576 byte limit`);
  expect(found.activeAgents.map((entry) => entry.agentType)).toContain('linked');
  expect(found.activeAgents.map((entry) => entry.agentType)).not.toContain('big');
});

test.for([
  { frontmatter: 'name: -bad\ndescription: d', warnings: ["Agent file /p/a.md has invalid name '-bad': names must not start with '-'"], error: 'Failed to parse agent from /p/a.md: Invalid "name": names must not start with "-"' },
  {
    frontmatter: 'name: a:b\ndescription: d',
    warnings: ["Agent file /p/a.md has invalid name 'a:b': names must not contain ':' (reserved for plugin namespacing)"],
    error: 'Failed to parse agent from /p/a.md: Invalid "name": names must not contain ":" (reserved for plugin namespacing)',
  },
  { frontmatter: 'name: z', warnings: ["Agent file /p/a.md is missing required 'description' in frontmatter"], error: 'Failed to parse agent from /p/a.md: Missing required "description" field in frontmatter' },
  { frontmatter: 'description: no name', warnings: [], error: undefined },
  { frontmatter: 'name: [unclosed', warnings: [expect.stringMatching(/^YAML frontmatter in \/p\/a\.md failed to parse and was ignored: /)], error: undefined },
])('parse failures use the recovered log wording: $frontmatter', ({ frontmatter, warnings, error }) => {
  const parsed = parseAgentFile('/p/a.md', `---\n${frontmatter}\n---\nbody`, 'userSettings', '/p');
  expect(parsed.agent).toBeUndefined();
  expect(parsed.warnings).toEqual(warnings);
  expect(parsed.error).toBe(error);
});

test.for([
  { value: 'false', expected: false },
  { value: 'true', expected: undefined },
  { value: 'nope', expected: undefined },
])('observeSubagents $value is parsed like the recovered parser', ({ value, expected }) => {
  const parsed = parseAgentFile('/p/a.md', agent('watch', 'body', `observeSubagents: ${value}\n`), 'userSettings', '/p');
  expect(parsed.agent?.observeSubagents).toBe(expected);
});
