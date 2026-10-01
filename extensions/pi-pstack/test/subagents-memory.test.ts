import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { memoryDirectory, memoryEnabled, memoryPrompt } from '../src/subagents/memory.ts';
import { workerFixture } from './worker-fixture.ts';

test.for(['1', 'true', ' YES ', 'on'])('[G2-31] positive disable value %s disables memory', (value) => {
  expect(memoryEnabled({ memory: 'project' }, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: value })).toBe(false);
});

test.for(['0', 'false', ' NO ', 'off'])('[G2-31] negative disable value %s forces memory on despite simple mode', (value) => {
  expect(memoryEnabled({ memory: 'project' }, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: value, CLAUDE_CODE_SIMPLE: '1' })).toBe(true);
});

test('[G2-31] unknown disable value defers to default mode', () => {
  expect(memoryEnabled({ memory: 'project' }, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: 'unknown' })).toBe(true);
  expect(memoryEnabled({ memory: 'project' }, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: 'unknown', CLAUDE_CODE_SIMPLE: '1' })).toBe(false);
});

test.for([
  { scope: 'user' as const, guidance: '- Since this memory is user-scope, keep learnings general since they apply across all projects' },
  { scope: 'project' as const, guidance: '- Since this memory is project-scope and shared with your team via version control, tailor your memories to this project' },
  { scope: 'local' as const, guidance: '- Since this memory is local-scope (not checked into version control), tailor your memories to this project and machine' },
])('[G2-30] $scope memory has exact guidance and an initialized directory', async ({ scope, guidance }) => {
  const fixture = await workerFixture();
  try {
    const prompt = await memoryPrompt({ agentType: 'scope-probe', memory: scope }, fixture.dir, { HOME: fixture.dir, CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES: 'EXTRA_MEMORY_RULE' });
    expect(prompt).toContain(guidance);
    expect(prompt).toContain('EXTRA_MEMORY_RULE');
    expect((await stat(memoryDirectory(scope, 'scope-probe', fixture.dir, fixture.dir))).isDirectory()).toBe(true);
  } finally {
    await fixture.close();
  }
});

test('[G2-31] disabled memory does not initialize its directory', async () => {
  const fixture = await workerFixture();
  try {
    expect(await memoryPrompt({ agentType: 'disabled-probe', memory: 'project' }, fixture.dir, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: 'true' })).toBe('');
    await expect(stat(memoryDirectory('project', 'disabled-probe', fixture.dir))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fixture.close();
  }
});

test.for(['project', 'local'] as const)('[G2-30] %s entrypoint policy ignores a symlink even inside the working copy', async (memory) => {
  const fixture = await workerFixture();
  try {
    const directory = memoryDirectory(memory, 'linked', fixture.dir);
    await mkdir(directory, { recursive: true });
    await writeFile(join(fixture.dir, 'linked-source.md'), 'SYMLINK_CONTENT_MUST_NOT_LOAD');
    await symlink(join(fixture.dir, 'linked-source.md'), join(directory, 'MEMORY.md'));
    const prompt = await memoryPrompt({ agentType: 'linked', memory }, fixture.dir, {});
    expect(prompt).toContain('Persistent Agent Memory');
    expect(prompt).not.toContain('SYMLINK_CONTENT_MUST_NOT_LOAD');
  } finally {
    await fixture.close();
  }
});

test('[G2-30] user entrypoint policy follows an explicitly linked file outside the configured root', async () => {
  const fixture = await workerFixture();
  const external = await mkdtemp(join(tmpdir(), 'pstack-linked-memory-'));
  try {
    const directory = join(fixture.dir, 'agent-memory/linked');
    await mkdir(directory, { recursive: true });
    await writeFile(join(external, 'memory.md'), 'EXPLICIT_USER_LINK_SENTINEL');
    await symlink(join(external, 'memory.md'), join(directory, 'MEMORY.md'));
    const prompt = await memoryPrompt({ agentType: 'linked', memory: 'user' }, fixture.dir, { PI_CODING_AGENT_DIR: fixture.dir });
    expect(prompt).toContain('EXPLICIT_USER_LINK_SENTINEL');
  } finally {
    await rm(external, { recursive: true, force: true });
    await fixture.close();
  }
});

test('[G2-29] scope paths sanitize agent names without traversal', () => {
  expect(memoryDirectory('project', '../plugin:probe', '/work', '/home')).toBe('/work/.pi/agent-memory/---plugin-probe');
  expect(memoryDirectory('local', 'probe', '/work', '/home')).toBe('/work/.pi/agent-memory-local/probe');
  expect(memoryDirectory('user', 'probe', '/work', '/home')).toBe('/home/.pi/agent/agent-memory/probe');
});

test.for([
  { disabled: 'true', simple: '', remote: '', remoteDirectory: '', cowork: '', enabled: false },
  { disabled: 'false', simple: '1', remote: '', remoteDirectory: '', cowork: '', enabled: true },
  { disabled: '', simple: '', remote: '1', remoteDirectory: '', cowork: '', enabled: false },
  { disabled: 'false', simple: '', remote: '1', remoteDirectory: '', cowork: '', enabled: true },
  { disabled: '', simple: '', remote: '1', remoteDirectory: '/remote-memory', cowork: '', enabled: true },
  { disabled: '', simple: '', remote: '1', remoteDirectory: '', cowork: '/cowork-memory', enabled: true },
  { disabled: '', simple: '1', remote: '1', remoteDirectory: '/remote-memory', cowork: '', enabled: false },
])('[G2-30][G2-31] switch $disabled simple $simple remote $remote directory $remoteDirectory cowork $cowork controls memory', async ({ disabled, simple, remote, remoteDirectory, cowork, enabled }) => {
  vi.stubEnv('CLAUDE_CODE_DISABLE_AUTO_MEMORY', disabled);
  vi.stubEnv('CLAUDE_CODE_SIMPLE', simple);
  vi.stubEnv('CLAUDE_CODE_REMOTE', remote);
  vi.stubEnv('CLAUDE_CODE_REMOTE_MEMORY_DIR', remoteDirectory);
  vi.stubEnv('CLAUDE_COWORK_MEMORY_PATH_OVERRIDE', cowork);
  const fixture = await workerFixture();
  try {
    const directory = memoryDirectory('project', 'remember', fixture.dir, fixture.dir);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'MEMORY.md'), 'MEMORY_SENTINEL_LIVE');
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/remember.md'), '---\nname: remember\ndescription: memory agent\nmemory: project\ntools: [grep]\n---\nComplete the task.');
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'memory probe', prompt: 'ordinary task', subagent_type: 'remember', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    const input = await readFile(join(fixture.dir, 'child-system.txt'), 'utf8');
    expect(input.includes('Persistent Agent Memory')).toBe(enabled);
    expect(input.includes('MEMORY_SENTINEL_LIVE')).toBe(enabled);
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8'))).toEqual(simple ? (enabled ? ['read'] : []) : enabled ? ['grep', 'read', 'write', 'edit'] : ['grep']);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-29] native child loads user memory from the configured Pi agent directory', async () => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, 'agent-memory/configured'), { recursive: true });
    await writeFile(join(fixture.dir, 'agent-memory/configured/MEMORY.md'), 'CONFIGURED_USER_MEMORY_SENTINEL');
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/configured.md'), '---\nname: configured\ndescription: configured memory\nmemory: user\ntools: [grep]\n---\nComplete the task.');
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'configured memory', prompt: 'ordinary task', subagent_type: 'configured', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(await readFile(join(fixture.dir, 'child-system.txt'), 'utf8')).toContain('CONFIGURED_USER_MEMORY_SENTINEL');
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8'))).toEqual(['grep', 'read', 'write', 'edit']);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-29] native child completes with a skipped dangling memory directory', async () => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi/agent-memory'), { recursive: true });
    const directory = memoryDirectory('project', 'dangling-run', await realpath(fixture.dir));
    await symlink(join(fixture.dir, 'missing-target'), directory);
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/dangling-run.md'), '---\nname: dangling-run\ndescription: dangling memory\nmemory: project\ntools: [read]\n---\nComplete the task.');
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'dangling memory', prompt: 'ordinary task', subagent_type: 'dangling-run', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(await readFile(join(fixture.dir, 'child-system.txt'), 'utf8')).not.toContain('Persistent Agent Memory');
    expect(fixture.subagentLogs).toContain(`agent memory: ${directory} leads out of the working copy or through a dangling link; its MEMORY.md is not read`);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-29] unresolved symlink cycle skips memory with the exact source diagnostic', async () => {
  const fixture = await workerFixture();
  let warnings: readonly string[] = [];
  try {
    await mkdir(join(fixture.dir, '.pi/agent-memory'), { recursive: true });
    const directory = memoryDirectory('project', 'cycle', fixture.dir);
    await symlink(directory, directory);
    expect(
      await memoryPrompt({ agentType: 'cycle', memory: 'project' }, fixture.dir, {}, (message) => {
        warnings = [...warnings, message];
      }),
    ).toBe('');
    expect(warnings).toEqual([`agent memory: ${directory} could not be resolved; its MEMORY.md is not read`]);
  } finally {
    await fixture.close();
  }
});

test('[G2-29] dangling memory symlink is skipped with the source diagnostic', async () => {
  const fixture = await workerFixture();
  let warnings: readonly string[] = [];
  try {
    await mkdir(join(fixture.dir, '.pi/agent-memory'), { recursive: true });
    const directory = memoryDirectory('project', 'dangling', fixture.dir);
    await symlink(join(fixture.dir, 'missing-target'), directory);
    expect(
      await memoryPrompt({ agentType: 'dangling', memory: 'project' }, fixture.dir, {}, (message) => {
        warnings = [...warnings, message];
      }),
    ).toBe('');
    expect(warnings).toEqual([`agent memory: ${directory} leads out of the working copy or through a dangling link; its MEMORY.md is not read`]);
  } finally {
    await fixture.close();
  }
});

test('[G2-29] nonexistent memory below an escaping ancestor is not offered', async () => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi'), { recursive: true });
    await symlink('/tmp', join(fixture.dir, '.pi/agent-memory'));
    expect(await memoryPrompt({ agentType: 'missing-probe-directory', memory: 'project' }, fixture.dir, {})).toBe('');
  } finally {
    await fixture.close();
  }
});

test('[G2-29] escaping project memory symlink does not load content', async () => {
  const fixture = await workerFixture();
  try {
    const directory = memoryDirectory('project', 'escape', fixture.dir, fixture.dir);
    await mkdir(join(fixture.dir, '.pi/agent-memory'), { recursive: true });
    await symlink('/tmp', directory);
    expect(await memoryPrompt({ agentType: 'escape', memory: 'project' }, fixture.dir, {})).not.toContain('Persistent Agent Memory');
  } finally {
    await fixture.close();
  }
});
