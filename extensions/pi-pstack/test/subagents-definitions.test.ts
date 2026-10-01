import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { builtinAgents } from '../src/subagents/builtins.ts';
import { clearAgentCache, discoverAgents, parseAgentFile, sanitizeDisplay } from '../src/subagents/definitions.ts';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'subagent-defs-'));
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

test('[G2-28] observer fields normalize blanks and retain nonempty values', () => {
  const blank = parseAgentFile('/p/a.md', agent('z', 'observer: "  "\nobserverMessage: " "\n'), 'userSettings', '/p').agent;
  expect(blank).toMatchObject({ agentType: 'z', systemPrompt: 'Prompt body' });
  expect(blank).not.toHaveProperty('observer');
  expect(blank).not.toHaveProperty('observerMessage');
  const configured = parseAgentFile('/p/a.md', agent('z', 'observer: " watcher "\nobserverMessage: " Report risks "\ncacheTtl: 1h\n'), 'userSettings', '/p').agent;
  expect(configured).toMatchObject({ observer: 'watcher', observerMessage: 'Report risks', cacheTtl: '1h' });
});

test('[G2-28] unsupported TTL and unknown experimental keys are omitted', () => {
  const parsed = parseAgentFile('/p/a.md', agent('z', 'cacheTtl: 2h\nexperimentalUnknown: true\n'), 'userSettings', '/p');
  expect(parsed.agent).toMatchObject({ agentType: 'z', systemPrompt: 'Prompt body' });
  expect(parsed.agent).not.toHaveProperty('cacheTtl');
  expect(parsed.agent).not.toHaveProperty('experimentalUnknown');
});

test('[G2-01] project definition beats user definition and lists stay sorted', () => {
  write('user/x.md', agent('x', '', 'from user'));
  write('proj/.claude/agents/x.md', agent('x', '', 'from project'));
  write('proj/.pi/agents/b.md', agent('b'));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [join(dir, 'user')], env: {} });
  const active = found.activeAgents.find((entry) => entry.agentType === 'x');
  expect(active?.source).toBe('projectSettings');
  expect(active?.systemPrompt).toBe('from project');
  expect(found.allAgents.filter((entry) => entry.agentType === 'x')).toHaveLength(2);
  const names = found.activeAgents.map((entry) => entry.agentType);
  expect(names).toEqual([...names].toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});

test('[G2-01] policy beats flag beats project', () => {
  const policy = { ...builtinAgents({})[0], agentType: 'p', source: 'policySettings' as const, systemPrompt: 'policy' } as never;
  const flag = { ...builtinAgents({})[0], agentType: 'p', source: 'flagSettings' as const, systemPrompt: 'flag' } as never;
  const found = discoverAgents({ root: dir, userDirs: [], flagAgents: [flag], policyAgents: [policy], env: {} });
  expect(found.activeAgents.find((entry) => entry.agentType === 'p')?.source).toBe('policySettings');
});

test('duplicate suppression preserves later-directory precedence within the same source', () => {
  const a = write('early/x.md', agent('x', '', 'earlier directory'));
  const b = write('later/x.md', agent('x', '', 'later directory'));
  const found = discoverAgents({ root: dir, userDirs: [], additionalDirs: [join(dir, 'early'), join(dir, 'later')], env: {} });
  expect(found.allAgents.filter((entry) => entry.agentType === 'x').map((entry) => entry.filePath)).toEqual([a, b]);
  expect(found.activeAgents.find((entry) => entry.agentType === 'x')).toMatchObject({ filePath: b, systemPrompt: 'later directory' });
});

test('[G2-02] discovery is cached by root until the cache is cleared', () => {
  const file = write('proj/.pi/agents/c.md', agent('c', '', 'one'));
  const first = discoverAgents({ root: join(dir, 'proj'), userDirs: [], env: {} });
  writeFileSync(file, agent('c', '', 'two'));
  expect(discoverAgents({ root: join(dir, 'proj'), userDirs: [], env: {} })).toBe(first);
  clearAgentCache();
  expect(discoverAgents({ root: join(dir, 'proj'), userDirs: [], env: {} }).activeAgents.find((entry) => entry.agentType === 'c')?.systemPrompt).toBe('two');
});

test('[G2-02] unreadable agent directory falls back to built-ins with a log', () => {
  write('user/a.md', agent('a'));
  chmodSync(join(dir, 'user'), 0o000);
  try {
    const found = discoverAgents({ root: dir, userDirs: [join(dir, 'user')], env: {} });
    expect(found.activeAgents.map((entry) => entry.source)).toEqual(['built-in', 'built-in', 'built-in', 'built-in']);
    expect(found.logs[0]).toContain('Error loading agent definitions: ');
  } finally {
    chmodSync(join(dir, 'user'), 0o755);
  }
});

test('[G2-03] duplicate names in one directory are logged with the active path', () => {
  const a = write('proj/.pi/agents/a/x.md', agent('x'));
  const b = write('proj/.pi/agents/b/x.md', agent('x'));
  const found = discoverAgents({ root: join(dir, 'proj'), userDirs: [], env: {} });
  expect(found.logs).toContain(`[agents] Duplicate agent name 'x' (projectSettings): ${a}, ${b} \u2014 active: ${b}`);
  expect(found.activeAgents.find((entry) => entry.agentType === 'x')?.filePath).toBe(b);
  expect(sanitizeDisplay(`a\u0000b${'c'.repeat(300)}`)).toHaveLength(200);
  expect(sanitizeDisplay('a\u0001b')).toBe('a b');
  const controls = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index));
  expect(sanitizeDisplay(`prefix${controls}suffix`)).toBe('prefix suffix');
});

test.each([
  ['-x', false],
  ['" -x "', false],
  ['a\uFF1Ab', false],
  ['fine', true],
])('[G2-04] name %s loads=%s', (name, loads) => {
  const parsed = parseAgentFile('/p/a.md', agent(name), 'userSettings', '/p');
  expect(parsed.agent !== undefined).toBe(loads);
});

test('[G2-04] description required, escaped newlines, trimmed body, bad maxTurns warns but loads', () => {
  expect(parseAgentFile('/p/a.md', '---\nname: z\n---\nbody', 'userSettings', '/p').agent).toBeUndefined();
  const parsed = parseAgentFile('/p/a.md', '---\nname: z\ndescription: "a\\\\nb"\nmaxTurns: x\n---\n\n  body  \n\n', 'userSettings', '/p');
  expect(parsed.agent?.whenToUse).toBe('a\nb');
  expect(parsed.agent?.systemPrompt).toBe('body');
  expect(parsed.agent?.maxTurns).toBeUndefined();
  expect(parsed.warnings).toEqual(["Agent file /p/a.md has invalid maxTurns 'x'. Must be a positive integer."]);
});

test.each([
  ['maxTurns: 0', "Agent file /p/a.md has invalid maxTurns '0'. Must be a positive integer."],
  ['background: yes', "Agent file /p/a.md has invalid background value 'yes'. Must be 'true', 'false', or omitted."],
  ['memory: x', "Agent file /p/a.md has invalid memory value 'x'. Valid options: user, project, local"],
  ['isolation: x', "Agent file /p/a.md has invalid isolation value 'x'. Valid options: worktree, remote"],
  ['effort: bogus', "Agent file /p/a.md has invalid effort 'bogus'. Valid options: low, medium, high, xhigh, max or an integer"],
  ['permissionMode: nope', "Agent file /p/a.md has invalid permissionMode 'nope'. Valid options: acceptEdits, auto, bypassPermissions, default, dontAsk, plan"],
])('[G2-06] %s warns with the exact text', (line, warning) => {
  expect(parseAgentFile('/p/a.md', agent('z', `${line}\n`), 'userSettings', '/p').warnings).toEqual([warning]);
});

test('[G2-06] model inherit folds case, background true stores, Skill tool migrates with a warning', () => {
  const parsed = parseAgentFile('/p/a.md', agent('z', 'model: " INHERIT "\nbackground: "true"\ntools: Read, Skill\npermissionMode: manual\neffort: 3\n'), 'userSettings', '/p');
  expect(parsed.agent).toMatchObject({ model: 'inherit', background: true, tools: ['Read'], skills: [], permissionMode: 'default', effort: 3 });
  expect(parsed.warnings[0]).toContain('deprecated');
});

test('[G2-10] built-ins by mode, env and safe mode', () => {
  expect(builtinAgents({}, { mode: 'none' })).toEqual([]);
  const names = (env: NodeJS.ProcessEnv) => builtinAgents(env).map((entry) => entry.agentType);
  expect(names({})).toEqual(['general-purpose', 'statusline-setup', 'Explore', 'Plan']);
  expect(names({ CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: '1' })).toEqual(['general-purpose', 'statusline-setup']);
  const safe = discoverAgents({ root: dir, safeMode: true, env: {} });
  expect(safe.activeAgents.every((entry) => entry.source === 'built-in')).toBe(true);
  expect(safe.warnings).toEqual(['Safe mode: all customizations are disabled (CLAUDE.md, skills, plugins, hooks, MCP, agents, and more)']);
  expect(builtinAgents({}).find((entry) => entry.agentType === 'general-purpose')?.tools).toEqual(['*']);
  expect(builtinAgents({}).find((entry) => entry.agentType === 'Plan')?.model).toBe('inherit');
});

test('[G2-11] built-in metadata', () => {
  const all = builtinAgents({});
  expect(all.find((entry) => entry.agentType === 'statusline-setup')).toMatchObject({ tools: ['read', 'edit'], model: 'sonnet', color: 'orange' });
  expect(all.every((entry) => entry.source === 'built-in' && entry.baseDir === 'built-in')).toBe(true);
  expect(all.find((entry) => entry.agentType === 'Explore')?.systemPrompt).toContain('file search specialist');
  expect(all.find((entry) => entry.agentType === 'Plan')?.systemPrompt).toContain('Critical Files for Implementation');
  expect(all[0]?.systemPrompt.startsWith('You are an agent for Provider CLI')).toBe(true);
});

test('diagnostic names replace Unicode controls and normalize whitespace', () => {
  expect(sanitizeDisplay('  a\u202Eb\u0085c  \t d  ')).toBe('a b c d');
  expect(sanitizeDisplay('')).toBe('');
});

test.for(['hooks: {}', 'PreToolUse: []', 'PermissionRequest: []', 'mcpServers: [private-server]'])('unsupported executable configuration %s never silently loads', (field) => {
  const parsed = parseAgentFile('/p/a.md', agent('guarded', `${field}\n`), 'projectSettings', '/p');
  expect(parsed).toMatchObject({ error: expect.stringContaining('requires a native Pi adapter') });
  expect(parsed).not.toHaveProperty('agent');
  const ordinary = parseAgentFile('/p/a.md', agent('ordinary'), 'projectSettings', '/p');
  expect(ordinary.agent).toMatchObject({ agentType: 'ordinary', systemPrompt: 'Prompt body' });
});
