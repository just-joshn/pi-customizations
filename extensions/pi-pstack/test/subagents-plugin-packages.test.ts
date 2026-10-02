import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installedPluginPackages, packageAgents, pluginPackage } from '../src/subagents/plugin-agents.ts';

let dir = '';
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-packages-')));
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

test('a package without a readable manifest is named after its directory and scans agents/', () => {
  mkdirSync(join(dir, 'bare'));
  expect(pluginPackage(join(dir, 'bare'))).toEqual({ name: 'bare', root: join(dir, 'bare'), agentPaths: [join(dir, 'bare', 'agents')] });
});

test('malformed manifest JSON falls back to the directory name', () => {
  write('broken/package.json', '{ not json');
  expect(pluginPackage(join(dir, 'broken')).name).toBe('broken');
});

test.for([
  { manifest: { name: '@scope/tool' }, expected: 'tool' },
  { manifest: { name: '' }, expected: 'dirname' },
  { manifest: { name: 12 }, expected: 'dirname' },
  { manifest: { name: 'plain' }, expected: 'plain' },
])('manifest $manifest is named $expected', ({ manifest, expected }) => {
  write('dirname/package.json', JSON.stringify(manifest));
  expect(pluginPackage(join(dir, 'dirname')).name).toBe(expected);
});

test('non-string entries in pi.agents are dropped and a non-array value uses the default directory', () => {
  write('mixed/package.json', JSON.stringify({ pi: { agents: ['./a', 4, null, './b'] } }));
  expect(pluginPackage(join(dir, 'mixed')).agentPaths).toEqual([join(dir, 'mixed', 'a'), join(dir, 'mixed', 'b')]);
  write('scalar/package.json', JSON.stringify({ pi: { agents: './a' } }));
  expect(pluginPackage(join(dir, 'scalar')).agentPaths).toEqual([join(dir, 'scalar', 'agents')]);
});

test('agent paths that are missing, or files that are not Markdown, yield nothing', () => {
  write('kit/package.json', JSON.stringify({ name: 'kit', pi: { agents: ['./missing', './notes.txt'] } }));
  write('kit/notes.txt', 'not an agent');
  const pkg = pluginPackage(join(dir, 'kit'));
  const warnings: string[] = [];
  expect(pkg.agentPaths).toHaveLength(2);
  expect(packageAgents(pkg, warnings)).toHaveLength(0);
  expect(warnings).toEqual([]);
});

test('nested directories contribute a namespace and non-Markdown files are ignored', () => {
  write('kit/package.json', JSON.stringify({ name: 'kit' }));
  write('kit/agents/a/b/deep.md', '---\ndescription: deep\n---\nD');
  write('kit/agents/readme.txt', 'ignored');
  const agents = packageAgents(pluginPackage(join(dir, 'kit')), []);
  expect(agents.map((agent) => [agent.agentType, agent.filename])).toEqual([['kit:a:b:deep', 'deep']]);
});

test('a directory named like a Markdown file is skipped with a warning', () => {
  write('kit/package.json', JSON.stringify({ name: 'kit' }));
  mkdirSync(join(dir, 'kit', 'agents', 'folder.md'), { recursive: true });
  const warnings: string[] = [];
  expect(packageAgents(pluginPackage(join(dir, 'kit')), warnings)).toEqual([]);
  expect(warnings).toEqual([`Skipping plugin agent ${join(dir, 'kit', 'agents', 'folder.md')}: not a regular file or exceeds 1048576 byte limit`]);
});

test('PI_PACKAGE_ROOT is interpolated alongside CLAUDE_PLUGIN_ROOT', () => {
  write('kit/package.json', JSON.stringify({ name: 'kit' }));
  write('kit/agents/x.md', '---\ndescription: d\n---\n${PI_PACKAGE_ROOT}/a and ${CLAUDE_PLUGIN_ROOT}/b');
  const [agent] = packageAgents(pluginPackage(join(dir, 'kit')), []);
  expect(agent?.systemPrompt).toBe(`${join(dir, 'kit')}/a and ${join(dir, 'kit')}/b`);
});

test('installed packages from settings resolve to plugin packages', () => {
  const agentDir = join(dir, 'agent');
  const pkg = join(dir, 'installed');
  write('installed/package.json', JSON.stringify({ name: '@acme/installed' }));
  write('agent/settings.json', JSON.stringify({ packages: [pkg] }));
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  const packages = installedPluginPackages(dir);
  expect(packages.map((entry) => [entry.name, entry.root])).toEqual([['installed', pkg]]);
});
