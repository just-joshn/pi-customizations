import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

import type { AgentDefinition } from './definitions.ts';
import { parseMemoryScope, resolveMemoryScope } from './memory-scope.ts';

type Scope = 'user' | 'project' | 'local';

const guidance: Record<Scope, string> = {
  user: '- Since this memory is user-scope, keep learnings general since they apply across all projects',
  project: '- Since this memory is project-scope and shared with your team via version control, tailor your memories to this project',
  local: '- Since this memory is local-scope (not checked into version control), tailor your memories to this project and machine',
};

export function memoryDirectory(scope: Scope, agentType: string, cwd: string, home = homedir(), agentDir = join(home, '.pi/agent')): string {
  return resolveMemoryScope(parseMemoryScope({ layer: scope, agentType, ...(scope !== 'user' ? { projectKey: cwd } : {}) }), home, agentDir);
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith('../') && !isAbsolute(path);
}

async function existingParent(directory: string): Promise<string | undefined> {
  try {
    return await realpath(directory);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const entry = await lstat(directory).catch((missing: unknown) => {
      if (missing instanceof Error && 'code' in missing && missing.code === 'ENOENT') return undefined;
      throw missing;
    });
    if (entry?.isSymbolicLink()) return undefined;
    const parent = dirname(directory);
    if (parent === directory) throw error;
    return existingParent(parent);
  }
}

function skipMemory(directory: string, log?: (message: string) => void): '' {
  log?.(`agent memory: ${directory} leads out of the working copy or through a dangling link; its MEMORY.md is not read`);
  return '';
}

async function prepareMemoryDirectory(directory: string, root: string, log?: (message: string) => void, follow = false): Promise<string | undefined> {
  try {
    const boundary = await realpath(root);
    const ancestor = await existingParent(directory);
    if (ancestor === undefined || (!follow && !contained(boundary, ancestor))) {
      skipMemory(directory, log);
      return undefined;
    }
    await mkdir(directory, { recursive: true });
    if (!follow && !contained(boundary, await realpath(directory))) {
      skipMemory(directory, log);
      return undefined;
    }
    return boundary;
  } catch {
    log?.(`agent memory: ${directory} could not be resolved; its MEMORY.md is not read`);
    return undefined;
  }
}

export async function memoryPrompt(definition: Pick<AgentDefinition, 'agentType' | 'memory'> | undefined, cwd: string, env: NodeJS.ProcessEnv, log?: (message: string) => void): Promise<string> {
  if (!definition?.memory || !memoryEnabled(definition, env)) return '';
  const home = env.HOME ?? homedir();
  const configured = env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, home);
  const directory = memoryDirectory(definition.memory, definition.agentType, cwd, home, configured || join(home, '.pi/agent'));
  let content = '';
  const boundary = await prepareMemoryDirectory(directory, definition.memory === 'user' ? configured || home : cwd, log, definition.memory === 'user');
  if (boundary === undefined) return '';
  try {
    const entrypoint = join(directory, 'MEMORY.md');
    const entry = await lstat(entrypoint);
    if (definition.memory === 'user' || entry.isFile()) {
      const file = await realpath(entrypoint);
      if (definition.memory !== 'user' && !contained(boundary, file)) return skipMemory(directory, log);
      content = await readFile(file, 'utf8');
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return `\nPersistent Agent Memory\nScope: ${definition.memory}\nDirectory: ${directory}\nMaintain durable findings in MEMORY.md. Keep entries concise and relevant to this agent.\n${guidance[definition.memory]}\n${env.CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES ?? ''}\n${content}`;
}

export function memoryEnabled(definition: Pick<AgentDefinition, 'memory'>, env: NodeJS.ProcessEnv): boolean {
  if (!definition.memory || env.PI_DISABLE_AGENT_MEMORY) return false;
  const value = env.CLAUDE_CODE_DISABLE_AUTO_MEMORY?.trim().toLowerCase();
  if (value !== undefined && ['1', 'true', 'yes', 'on'].includes(value)) return false;
  if (value !== undefined && ['0', 'false', 'no', 'off'].includes(value)) return true;
  if (env.CLAUDE_CODE_SIMPLE) return false;
  return !env.CLAUDE_CODE_REMOTE || Boolean(env.CLAUDE_CODE_REMOTE_MEMORY_DIR || env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE);
}
