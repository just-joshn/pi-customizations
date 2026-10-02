import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { packageAgents, pluginPackage } from '../src/subagents/plugin-agents.ts';

const placeholder = (name: string): string => `${'$'}{${name}}`;

let dir = '';
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-agents-')));
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

test('plugin agents are namespaced by package and subdirectory with basename and generated-description fallbacks', () => {
  write('kit/package.json', JSON.stringify({ name: '@acme/review-kit' }));
  write('kit/agents/lint/strict.md', '---\ntools: Read\n---\nBe strict.');
  write('kit/agents/auditor.md', `---\nname: auditor\ndescription: Audits code\nisolation: worktree\n---\nRead ${placeholder('CLAUDE_PLUGIN_ROOT')}/rules.md first.`);
  const warnings: string[] = [];
  const agents = packageAgents(pluginPackage(join(dir, 'kit')), warnings);
  expect(agents.map((agent) => [agent.agentType, agent.whenToUse, agent.source, agent.plugin, agent.filename])).toEqual([
    ['review-kit:auditor', 'Audits code', 'plugin', 'review-kit', 'auditor'],
    ['review-kit:lint:strict', 'Agent from review-kit plugin', 'plugin', 'review-kit', 'strict'],
  ]);
  expect(agents[0]).toMatchObject({ systemPrompt: `Read ${join(dir, 'kit')}/rules.md first.`, isolation: 'worktree' });
  expect(agents[1]).toMatchObject({ tools: ['Read'], systemPrompt: 'Be strict.' });
  expect(warnings).toEqual([]);
});

test('plugin agents ignore permissionMode, hooks and mcpServers with warnings and accept only worktree isolation', () => {
  write('kit/package.json', JSON.stringify({ name: 'kit' }));
  const file = write('kit/agents/bold.md', '---\nname: bold\ndescription: d\npermissionMode: bypassPermissions\nhooks: {}\nmcpServers: [x]\nisolation: remote\n---\nGo.');
  const warnings: string[] = [];
  const [agent] = packageAgents(pluginPackage(join(dir, 'kit')), warnings);
  expect(warnings).toEqual(['permissionMode', 'hooks', 'mcpServers'].map((key) => `Plugin agent file ${file} sets ${key}, which is ignored for plugin agents. Use .claude/agents/ for this level of control.`));
  expect(agent).not.toHaveProperty('permissionMode');
  expect(agent).not.toHaveProperty('isolation');
});

test('plugin agent files must be regular and at most 1 MiB', () => {
  write('kit/package.json', JSON.stringify({ name: 'kit' }));
  const big = write('kit/agents/big.md', `---\nname: big\ndescription: d\n---\n${'x'.repeat(1048577)}`);
  const warnings: string[] = [];
  expect(packageAgents(pluginPackage(join(dir, 'kit')), warnings)).toEqual([]);
  expect(warnings).toEqual([`Skipping plugin agent ${big}: not a regular file or exceeds 1048576 byte limit`]);
});

test('a pi manifest names custom agent directories and Markdown files', () => {
  write('kit/package.json', JSON.stringify({ name: 'kit', pi: { agents: ['./roles', './extra/one.md'] } }));
  write('kit/roles/two.md', '---\ndescription: second\n---\nTwo.');
  write('kit/extra/one.md', '---\ndescription: first\n---\nOne.');
  write('kit/agents/ignored.md', '---\ndescription: not declared\n---\nNo.');
  expect(packageAgents(pluginPackage(join(dir, 'kit')), []).map((agent) => agent.agentType)).toEqual(['kit:two', 'kit:one']);
});
