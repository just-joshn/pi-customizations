import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { agentDirectories, userAgentDirectories } from '../src/subagents/agent-locations.ts';
import { scratchDir } from './support/scratch.ts';

test('user directories are the Copilot one then the pi agent directory', () => {
  expect(userAgentDirectories('/pi/agent', '/home/me')).toEqual(['/home/me/.copilot/agents', '/pi/agent/agents']);
});

test('project directories run from the repository root down to the working directory', () => {
  const home = scratchDir('pstack-locations-home-');
  const repo = join(home, 'work', 'repo');
  const inner = join(repo, 'packages', 'app');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(inner, { recursive: true });
  expect(agentDirectories({ cwd: inner, agentDir: '/pi/agent', home }).map((entry) => entry.dir.replace(home, '~'))).toEqual([
    '~/.copilot/agents',
    '/pi/agent/agents',
    '~/work/repo/.github/agents',
    '~/work/repo/.pi/agents',
    '~/work/repo/packages/.github/agents',
    '~/work/repo/packages/.pi/agents',
    '~/work/repo/packages/app/.github/agents',
    '~/work/repo/packages/app/.pi/agents',
  ]);
});

test('additional roots sit between user and project directories', () => {
  const home = scratchDir('pstack-locations-home-');
  const repo = join(home, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const found = agentDirectories({ cwd: repo, agentDir: '/pi/agent', home, additionalRoots: ['/elsewhere'] });
  expect(found.map((entry) => `${entry.source}:${entry.dir.replace(home, '~')}`)).toEqual([
    'user:~/.copilot/agents',
    'user:/pi/agent/agents',
    'project:/elsewhere/.github/agents',
    'project:/elsewhere/.pi/agents',
    'project:~/repo/.github/agents',
    'project:~/repo/.pi/agents',
  ]);
});

test('an additional root that is already a project root is not repeated', () => {
  const home = scratchDir('pstack-locations-home-');
  const repo = join(home, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  expect(agentDirectories({ cwd: repo, agentDir: '/pi/agent', home, additionalRoots: [repo] }).filter((entry) => entry.dir.endsWith('.github/agents'))).toHaveLength(1);
});

test('a working directory outside any repository walks up to the filesystem root', () => {
  const home = scratchDir('pstack-locations-home-');
  const found = agentDirectories({ cwd: '/', agentDir: '/pi/agent', home });
  expect(found.map((entry) => entry.dir)).toEqual(expect.arrayContaining(['/.github/agents', '/.pi/agents']));
});
