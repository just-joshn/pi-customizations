/**
 * Official built-in tool definitions, cached per working directory.
 *
 * Pi registers the built-ins before extensions load, so a same-name
 * `pi.registerTool()` replaces the original. This module hands the wrapper the
 * original definition to spread for its behavior-affecting metadata and to
 * delegate execution to. Definitions are cwd-sensitive, so they are built and
 * cached per cwd.
 */

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from '@earendil-works/pi-coding-agent';

export type BuiltinName = 'read' | 'bash' | 'powershell' | 'edit' | 'write' | 'grep' | 'find' | 'ls';

function createBuiltins(cwd: string) {
  return {
    read: createReadToolDefinition(cwd),
    bash: createBashToolDefinition(cwd),
    powershell: createPowerShellToolDefinition(cwd),
    edit: createEditToolDefinition(cwd),
    write: createWriteToolDefinition(cwd),
    grep: createGrepToolDefinition(cwd),
    find: createFindToolDefinition(cwd),
    ls: createLsToolDefinition(cwd),
  };
}

export type Builtins = ReturnType<typeof createBuiltins>;

const cache = new Map<string, Builtins>();

export function getBuiltins(cwd: string): Builtins {
  const cached = cache.get(cwd);
  if (cached) return cached;
  const built = createBuiltins(cwd);
  cache.set(cwd, built);
  return built;
}

export function getBuiltin<K extends BuiltinName>(cwd: string, name: K): Builtins[K] {
  return getBuiltins(cwd)[name];
}
