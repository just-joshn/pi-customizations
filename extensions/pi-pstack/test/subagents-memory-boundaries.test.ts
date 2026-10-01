import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { memoryDirectory, memoryPrompt } from '../src/subagents/memory.ts';

let dir = '';
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'memory-boundaries-')));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('an agent without a definition or memory scope gets no memory section', async () => {
  expect(await memoryPrompt(undefined, dir, { HOME: dir })).toBe('');
  expect(await memoryPrompt({ agentType: 'plain', memory: undefined }, dir, { HOME: dir })).toBe('');
});

test('a project memory path that crosses a regular file is logged as unresolvable', async () => {
  await writeFile(join(dir, '.pi'), 'not a directory');
  const logs: string[] = [];
  const prompt = await memoryPrompt({ agentType: 'blocked', memory: 'project' }, dir, { HOME: dir }, (message) => logs.push(message));
  expect(prompt).toBe('');
  expect(logs).toEqual([`agent memory: ${memoryDirectory('project', 'blocked', dir)} could not be resolved; its MEMORY.md is not read`]);
});

test('project memory that resolves outside the working copy through a symlink is skipped', async () => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'memory-outside-')));
  try {
    const project = join(dir, 'project');
    await mkdir(project);
    await symlink(outside, join(project, '.pi'));
    const logs: string[] = [];
    const prompt = await memoryPrompt({ agentType: 'escape', memory: 'project' }, project, { HOME: dir }, (message) => logs.push(message));
    expect(prompt).toBe('');
    expect(logs).toEqual([`agent memory: ${memoryDirectory('project', 'escape', project)} leads out of the working copy or through a dangling link; its MEMORY.md is not read`]);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('a dangling symlink in place of the memory directory is skipped', async () => {
  const project = join(dir, 'project');
  await mkdir(join(project, '.pi', 'agent-memory'), { recursive: true });
  await symlink(join(dir, 'missing-target'), join(project, '.pi', 'agent-memory', 'dangling'));
  const logs: string[] = [];
  const prompt = await memoryPrompt({ agentType: 'dangling', memory: 'project' }, project, { HOME: dir }, (message) => logs.push(message));
  expect(prompt).toBe('');
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain('leads out of the working copy or through a dangling link');
});

test('user memory reads MEMORY.md from the configured agent directory with a tilde expanded to HOME', async () => {
  const agentDir = join(dir, 'cfg');
  const memoryDir = join(agentDir, 'agent-memory', 'reviewer');
  await mkdir(memoryDir, { recursive: true });
  await writeFile(join(memoryDir, 'MEMORY.md'), 'REMEMBER_THIS');
  const prompt = await memoryPrompt({ agentType: 'reviewer', memory: 'user' }, dir, { HOME: dir, PI_CODING_AGENT_DIR: '~/cfg' });
  expect(prompt).toBe(
    `\nPersistent Agent Memory\nScope: user\nDirectory: ${memoryDir}\nMaintain durable findings in MEMORY.md. Keep entries concise and relevant to this agent.\n- Since this memory is user-scope, keep learnings general since they apply across all projects\n\nREMEMBER_THIS`,
  );
});

test('a user MEMORY.md that is unreadable for a reason other than absence surfaces the error', async () => {
  const memoryDir = join(dir, '.pi', 'agent', 'agent-memory', 'broken');
  await mkdir(join(memoryDir, 'MEMORY.md'), { recursive: true });
  await expect(memoryPrompt({ agentType: 'broken', memory: 'user' }, dir, { HOME: dir })).rejects.toMatchObject({ code: 'EISDIR' });
});

test('a project MEMORY.md that is a directory is ignored and the section is still produced', async () => {
  const memoryDir = memoryDirectory('local', 'dirmem', dir);
  await mkdir(join(memoryDir, 'MEMORY.md'), { recursive: true });
  const prompt = await memoryPrompt({ agentType: 'dirmem', memory: 'local' }, dir, { HOME: dir });
  expect(prompt).toContain('Scope: local');
  expect(prompt.endsWith('\n')).toBe(true);
});
