import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

import { DefaultPackageManager, getAgentDir, parseFrontmatter, SettingsManager } from '@earendil-works/pi-coding-agent';
import { maxAgentFileBytes } from './agent-sources.ts';
import { parseAgentColor } from './colors.ts';
import type { AgentDefinition } from './definitions.ts';
import { toolList } from './tool-specs.ts';

export type PluginPackage = Readonly<{ name: string; root: string; agentPaths: readonly string[] }>;
type PluginFile = Readonly<{ filePath: string; pluginName: string; namespace: readonly string[]; root: string }>;
type Mutable = { -readonly [K in keyof AgentDefinition]: AgentDefinition[K] };

const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];

function describe(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function interpolate(body: string, root: string): string {
  return body.replaceAll('${CLAUDE_PLUGIN_ROOT}', root).replaceAll('${PI_PACKAGE_ROOT}', root);
}

function limits(fm: Record<string, unknown>, path: string, warnings: string[]): Partial<Mutable> {
  const agent: Partial<Mutable> = {};
  if (fm.memory !== undefined) {
    if (fm.memory === 'user' || fm.memory === 'project' || fm.memory === 'local') agent.memory = fm.memory;
    else warnings.push(`Plugin agent file ${path} has invalid memory value '${String(fm.memory)}'. Valid options: user, project, local`);
  }
  if (fm.effort !== undefined) {
    const raw = typeof fm.effort === 'string' ? fm.effort.trim().toLowerCase() : fm.effort;
    if ((typeof raw === 'number' && Number.isInteger(raw)) || (typeof raw === 'string' && efforts.includes(raw))) agent.effort = raw;
    else warnings.push(`Plugin agent file ${path} has invalid effort '${String(fm.effort)}'. Valid options: ${efforts.join(', ')} or an integer`);
  }
  if (fm.maxTurns !== undefined) {
    if (typeof fm.maxTurns === 'number' && Number.isInteger(fm.maxTurns) && fm.maxTurns > 0) agent.maxTurns = fm.maxTurns;
    else warnings.push(`Plugin agent file ${path} has invalid maxTurns '${String(fm.maxTurns)}'. Must be a positive integer.`);
  }
  for (const key of ['permissionMode', 'hooks', 'mcpServers']) if (fm[key] !== undefined) warnings.push(`Plugin agent file ${path} sets ${key}, which is ignored for plugin agents. Use .claude/agents/ for this level of control.`);
  return agent;
}

function presentation(fm: Record<string, unknown>): Partial<Mutable> {
  const color = parseAgentColor(fm.color);
  const model = typeof fm.model === 'string' && fm.model.trim() ? fm.model.trim() : undefined;
  const disallowed = toolList(fm.disallowedTools);
  return {
    ...(toolList(fm.tools) ? { tools: toolList(fm.tools) } : {}),
    ...(disallowed ? { disallowedTools: disallowed } : {}),
    ...(Array.isArray(fm.skills) ? { skills: fm.skills.filter((skill): skill is string => typeof skill === 'string') } : {}),
    ...(color ? { color } : {}),
    ...(model ? { model: model.toLowerCase() === 'inherit' ? 'inherit' : model } : {}),
    ...(fm.background === true || fm.background === 'true' ? { background: true as const } : {}),
    ...(fm.omitContextFiles === true || fm.omitContextFiles === 'true' ? { omitContextFiles: true } : {}),
    ...(fm.isolation === 'worktree' ? { isolation: 'worktree' as const } : {}),
    ...(fm.cacheTtl === '1h' ? { cacheTtl: '1h' as const } : {}),
  };
}

export function parsePluginAgent(file: PluginFile, text: string, warnings: string[]): AgentDefinition {
  const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(text);
  const filename = (fm.name != null ? String(fm.name) : undefined) || basename(file.filePath).replace(/\.md$/, '');
  const agentType = [file.pluginName, ...file.namespace, filename].join(':');
  return {
    ...limits(fm, file.filePath, warnings),
    ...presentation(fm),
    agentType,
    whenToUse: describe(fm.description) ?? describe(fm.when_to_use) ?? describe(fm['when-to-use']) ?? `Agent from ${file.pluginName} plugin`,
    systemPrompt: interpolate(body.trim(), file.root),
    source: 'plugin',
    baseDir: file.root,
    plugin: file.pluginName,
    filename,
    filePath: file.filePath,
  };
}

function loadPluginFile(file: PluginFile, warnings: string[]): AgentDefinition[] {
  const stats = statSync(file.filePath, { throwIfNoEntry: false });
  if (!stats?.isFile() || stats.size > maxAgentFileBytes) {
    warnings.push(`Skipping plugin agent ${file.filePath}: not a regular file or exceeds ${maxAgentFileBytes} byte limit`);
    return [];
  }
  try {
    return [parsePluginAgent(file, readFileSync(file.filePath, 'utf8'), warnings)];
  } catch (error) {
    warnings.push(`Failed to load agent from ${file.filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function scanDirectory(dir: string, pkg: PluginPackage, warnings: string[]): AgentDefinition[] {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.md'))
    .toSorted();
  return files.flatMap((entry) =>
    loadPluginFile(
      {
        filePath: join(dir, entry),
        pluginName: pkg.name,
        namespace: relative(dir, join(dir, entry, '..'))
          .split(sep)
          .filter(Boolean),
        root: pkg.root,
      },
      warnings,
    ),
  );
}

export function packageAgents(pkg: PluginPackage, warnings: string[]): AgentDefinition[] {
  return pkg.agentPaths.flatMap((path) => {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats?.isDirectory()) return scanDirectory(path, pkg, warnings);
    if (stats?.isFile() && path.endsWith('.md')) return loadPluginFile({ filePath: path, pluginName: pkg.name, namespace: [], root: pkg.root }, warnings);
    return [];
  });
}

function readManifest(root: string): { name?: unknown; pi?: { agents?: unknown } } {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function pluginPackage(root: string): PluginPackage {
  const manifest = readManifest(root);
  const declared = Array.isArray(manifest.pi?.agents) ? manifest.pi.agents.filter((path): path is string => typeof path === 'string') : undefined;
  const name = typeof manifest.name === 'string' && manifest.name ? manifest.name.replace(/^@[^/]+\//, '') : basename(root);
  return { name, root, agentPaths: (declared ?? ['agents']).map((path) => resolve(root, path)) };
}

export function installedPluginPackages(cwd: string): PluginPackage[] {
  const agentDir = getAgentDir();
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir) });
  return manager.listConfiguredPackages().flatMap((configured) => (configured.installedPath ? [pluginPackage(configured.installedPath)] : []));
}
