import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { loadSettingsHooks } from '../src/subagents/hook-dispatch.ts';
import { matchesHook, parseAgentHooks } from '../src/subagents/hook-table.ts';
import { readSettingsLayers } from '../src/subagents/settings-layers.ts';

type Roots = Readonly<{ cwd: string; home: string; agentDir: string }>;

async function rootsWith(files: Readonly<Record<string, string>>): Promise<Roots> {
  const base = await mkdtemp(join(tmpdir(), 'settings-'));
  onTestFinished(() => rm(base, { recursive: true, force: true }));
  const roots = { cwd: join(base, 'project'), home: join(base, 'home'), agentDir: join(base, 'agent') };
  for (const [relative, content] of Object.entries(files)) {
    const path = join(base, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return roots;
}

const preToolHook = (command: string) => ({ PreToolUse: [{ hooks: [{ type: 'command', command }] }] });

test('settings layers read user then project files from lowest to highest precedence', async () => {
  const roots = await rootsWith({
    'home/.claude/settings.json': '{"from":"home-claude"}',
    'agent/settings.json': '{"from":"agent"}',
    'project/.claude/settings.json': '{"from":"project-claude"}',
    'project/.pi/settings.json': '{"from":"project-pi"}',
    'project/.claude/settings.local.json': '{"from":"project-local"}',
  });
  expect(await readSettingsLayers(roots)).toEqual({
    user: [{ from: 'home-claude' }, { from: 'agent' }],
    project: [{ from: 'project-claude' }, { from: 'project-pi' }, { from: 'project-local' }],
  });
});

test('missing, malformed and non-object settings files are skipped', async () => {
  const roots = await rootsWith({
    'home/.claude/settings.json': '{not json',
    'agent/settings.json': '["list"]',
    'project/.claude/settings.json': 'null',
    'project/.pi/settings.json': '{"from":"project-pi"}',
  });
  expect(await readSettingsLayers(roots)).toEqual({ user: [], project: [{ from: 'project-pi' }] });
});

test('settings hooks merge user then project groups and drop the Stop event', async () => {
  const roots = await rootsWith({
    'home/.claude/settings.json': JSON.stringify({ hooks: { ...preToolHook('user-hook'), Stop: [{ hooks: [{ type: 'command', command: 'stop-hook' }] }] } }),
    'project/.claude/settings.json': JSON.stringify({ hooks: preToolHook('project-hook') }),
  });
  const logs: string[] = [];
  const table = await loadSettingsHooks(roots, true, (message) => logs.push(message));
  expect(table).toEqual({ PreToolUse: [{ hooks: [{ command: 'user-hook' }] }, { hooks: [{ command: 'project-hook' }] }] });
  expect(logs).toEqual([]);
});

test('project settings hooks are ignored until the project is trusted', async () => {
  const roots = await rootsWith({
    'home/.claude/settings.json': JSON.stringify({ hooks: preToolHook('user-hook') }),
    'project/.pi/settings.json': JSON.stringify({ hooks: preToolHook('project-hook') }),
  });
  expect(await loadSettingsHooks(roots, false, () => {})).toEqual({ PreToolUse: [{ hooks: [{ command: 'user-hook' }] }] });
});

test('an invalid settings hooks block is logged and contributes nothing', async () => {
  const roots = await rootsWith({
    'home/.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: 'oops' } }),
    'agent/settings.json': JSON.stringify({ hooks: 'not a mapping' }),
  });
  const logs: string[] = [];
  expect(await loadSettingsHooks(roots, true, (message) => logs.push(message))).toEqual({});
  expect(logs).toEqual(["Ignoring settings hooks: Invalid hooks in agent 'settings': PreToolUse must be a list of hook groups"]);
});

const group = (hook: unknown, matcher?: unknown) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [hook] });

test.for([
  { name: 'no hooks key', frontmatter: {}, expected: { notes: [] } },
  { name: 'null hooks', frontmatter: { hooks: null }, expected: { notes: [] } },
  { name: 'an empty mapping', frontmatter: { hooks: {} }, expected: { notes: [] } },
  {
    name: 'timeouts convert from seconds and matchers are kept',
    frontmatter: { hooks: { PreToolUse: [group({ type: 'command', command: 'check', timeout: 5 }, 'Bash')] } },
    expected: { notes: [], hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'check', timeoutMs: 5000 }] }] } },
  },
  {
    name: 'Stop is converted to SubagentStop and merged with an existing SubagentStop',
    frontmatter: { hooks: { SubagentStop: [group({ type: 'command', command: 'a' })], Stop: [group({ type: 'command', command: 'b' })] } },
    expected: {
      notes: ['Converted Stop hook to SubagentStop since it fires when the subagent finishes'],
      hooks: { SubagentStop: [{ hooks: [{ command: 'a' }] }, { hooks: [{ command: 'b' }] }] },
    },
  },
  { name: 'an unknown event is noted and ignored', frontmatter: { hooks: { Bogus: [] } }, expected: { notes: ["Ignoring unknown hook event 'Bogus'"] } },
  { name: 'a recognized but unsupported event is noted and ignored', frontmatter: { hooks: { Notification: [group({ type: 'command', command: 'x' })] } }, expected: { notes: ['Ignoring Notification hooks: the event does not fire for subagents in Pi'] } },
  { name: 'a malformed non-guard event is noted and ignored', frontmatter: { hooks: { PostToolUse: 'x' } }, expected: { notes: ['Ignoring PostToolUse hooks: PostToolUse must be a list of hook groups'] } },
])('parsing hooks: $name', ({ frontmatter, expected }) => {
  expect(parseAgentHooks(frontmatter, 'reviewer')).toEqual(expected);
});

test.for([
  { name: 'a top-level PreToolUse key', frontmatter: { PreToolUse: [] }, message: `Agent 'reviewer': PreToolUse is declared at the frontmatter top level, outside "hooks" — declare guard hooks under "hooks:" with command handlers` },
  { name: 'a top-level PermissionRequest key', frontmatter: { PermissionRequest: [] }, message: `Agent 'reviewer': PermissionRequest is declared at the frontmatter top level, outside "hooks" — declare guard hooks under "hooks:" with command handlers` },
  { name: 'a list instead of a mapping', frontmatter: { hooks: [] }, message: "Invalid hooks in agent 'reviewer': hooks must be a mapping of event names to hook groups" },
  { name: 'a scalar instead of a mapping', frontmatter: { hooks: 'x' }, message: "Invalid hooks in agent 'reviewer': hooks must be a mapping of event names to hook groups" },
  { name: 'a group that is not an object', frontmatter: { hooks: { PreToolUse: ['x'] } }, message: "Invalid hooks in agent 'reviewer': a hook group must be an object" },
  { name: 'a non-string matcher', frontmatter: { hooks: { PreToolUse: [group({ type: 'command', command: 'x' }, 3)] } }, message: "Invalid hooks in agent 'reviewer': 'matcher' must be a string" },
  { name: 'a group without hooks', frontmatter: { hooks: { PreToolUse: [{ matcher: 'Bash' }] } }, message: "Invalid hooks in agent 'reviewer': a hook group needs a 'hooks' list" },
  { name: 'a handler that is not an object', frontmatter: { hooks: { PreToolUse: [group('x')] } }, message: "Invalid hooks in agent 'reviewer': a hook handler must be an object" },
  { name: 'a handler type other than command', frontmatter: { hooks: { PermissionRequest: [group({ type: 'http', command: 'x' })] } }, message: "Invalid hooks in agent 'reviewer': hook type 'http' is not supported" },
  { name: 'a blank command', frontmatter: { hooks: { PreToolUse: [group({ type: 'command', command: '  ' })] } }, message: "Invalid hooks in agent 'reviewer': a command hook needs a non-empty 'command'" },
  { name: 'a non-positive timeout', frontmatter: { hooks: { PreToolUse: [group({ type: 'command', command: 'x', timeout: 0 })] } }, message: "Invalid hooks in agent 'reviewer': 'timeout' must be a positive number of seconds" },
])('guard hooks that cannot load: $name', ({ frontmatter, message }) => {
  expect(parseAgentHooks(frontmatter, 'reviewer')).toEqual({ notes: [], unloadable: message });
});

test.for([
  { matcher: undefined, subject: 'Bash', expected: true },
  { matcher: '', subject: 'Bash', expected: true },
  { matcher: '*', subject: 'anything', expected: true },
  { matcher: 'Bash', subject: 'Bash', expected: true },
  { matcher: 'Bash', subject: 'BashOutput', expected: false },
  { matcher: 'Edit|Write', subject: 'Write', expected: true },
  { matcher: 'Edit|Write', subject: 'Read', expected: false },
  { matcher: '^mcp__.*', subject: 'mcp__github__issue', expected: true },
  { matcher: '^mcp__.*', subject: 'Bash', expected: false },
  { matcher: '(', subject: '(', expected: true },
  { matcher: '(', subject: 'Bash', expected: false },
])('matcher $matcher against $subject is $expected', ({ matcher, subject, expected }) => {
  expect(matchesHook(matcher, subject)).toBe(expected);
});
