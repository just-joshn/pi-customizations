import { isAbsolute, join, relative, sep } from 'node:path';

type Narrowing = Readonly<{ agentType: string; relPath?: string }> | Readonly<{ agentType?: never; relPath?: never }>;
export type MemoryScope = Narrowing & (Readonly<{ layer: 'user'; projectKey?: never }> | Readonly<{ layer: 'project' | 'local'; projectKey: string }>);

export function parseMemoryScope(value: unknown): MemoryScope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid agent-memory scope');
  const data = value as Record<string, unknown>;
  if (data.layer !== 'user' && data.layer !== 'project' && data.layer !== 'local') throw new Error('scope.layer must be user, project or local');
  if (data.layer === 'user' && 'projectKey' in data) throw new Error('scope.projectKey the user layer is not keyed by project');
  if (data.layer !== 'user' && typeof data.projectKey !== 'string') throw new Error('scope.projectKey required for the project and local layers');
  if (data.agentType === undefined && data.relPath !== undefined) throw new Error('scope.relPath requires scope.agentType: an agent-memory relPath narrows one agent directory');
  if (data.agentType !== undefined && typeof data.agentType !== 'string') throw new Error('scope.agentType must be a string');
  if (data.relPath !== undefined && typeof data.relPath !== 'string') throw new Error('scope.relPath must be a string');
  const narrow: Narrowing = typeof data.agentType === 'string' ? { agentType: data.agentType, ...(typeof data.relPath === 'string' ? { relPath: data.relPath } : {}) } : {};
  return data.layer === 'user' ? { ...narrow, layer: 'user' } : { ...narrow, layer: data.layer, projectKey: data.projectKey as string };
}

export function resolveMemoryScope(scope: MemoryScope, home: string, agentDir = join(home, '.pi/agent')): string {
  const base = scope.layer === 'user' ? join(agentDir, 'agent-memory') : join(scope.projectKey, scope.layer === 'local' ? '.pi/agent-memory-local' : '.pi/agent-memory');
  const name = scope.agentType?.replace(/[^A-Za-z0-9_-]/g, '-');
  if (name === '') throw new Error('Agent memory requires a nonempty agent type.');
  const directory = name === undefined ? base : join(base, name);
  if (scope.relPath === undefined) return directory;
  const path = relative(directory, join(directory, scope.relPath));
  if (isAbsolute(scope.relPath) || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new Error('Invalid agent-memory relative path');
  return join(directory, scope.relPath);
}
