import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

import { getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { DEFAULT_SUBAGENT_TYPE, type SubagentDefinition, type SubagentPermissionMode, type SubagentSource, ZERO } from './types.ts';

const AGENT_FILE_EXTENSIONS = new Set(['.md', '.mdc', '.markdown']);
const FRONTMATTER_BLOCK_REGEX = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

const BUILTIN_SUBAGENTS: readonly SubagentDefinition[] = [
  {
    name: 'general-purpose',
    description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
    tools: [],
    model: 'inherit',
    forceDefaultModel: false,
    prompt: 'You are a focused subagent executing a delegated task. Complete the task thoroughly and return a concise, accurate summary of findings and changes.',
    permissionMode: 'default',
    isBackground: false,
    nestedTasks: false,
    source: 'builtin',
  },
  {
    name: 'explore',
    description: 'Fast read-only agent specialized for exploring codebases, finding files by pattern, searching code for keywords, and answering questions about the codebase.',
    tools: ['read', 'grep', 'find', 'ls', 'bash'],
    model: 'fast',
    forceDefaultModel: false,
    prompt: 'You are a fast read-only codebase exploration subagent. Inspect files, search patterns, trace symbols, and return a clear, evidence-backed report with exact file paths and line numbers. Do not modify any files.',
    permissionMode: 'readonly',
    isBackground: false,
    nestedTasks: false,
    source: 'builtin',
  },
  {
    name: 'shell',
    description: 'Command execution specialist for running bash commands, git operations, builds, and test suites.',
    tools: ['bash', 'read'],
    model: 'inherit',
    forceDefaultModel: false,
    prompt: 'You are a shell command execution specialist. Run the requested commands carefully, inspect output and exit codes, and report the concise result.',
    permissionMode: 'default',
    isBackground: false,
    nestedTasks: false,
    source: 'builtin',
  },
  {
    name: 'debug',
    description: 'Debugging specialist for tracing failures, inspecting logs, forming hypotheses, and isolating root causes.',
    tools: [],
    model: 'inherit',
    forceDefaultModel: false,
    prompt: 'You are a debugging subagent. Investigate symptoms systematically, verify hypotheses against real evidence, and report root causes with exact locations.',
    permissionMode: 'default',
    isBackground: false,
    nestedTasks: false,
    source: 'builtin',
  },
];

const SUBAGENT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  unspecified: 'general-purpose',
  generalpurpose: 'general-purpose',
  'general-purpose': 'general-purpose',
  bash: 'shell',
  shell: 'shell',
  explore: 'explore',
  debug: 'debug',
};

interface DirectorySpec {
  readonly dirPath: string;
  readonly source: SubagentSource;
}

type RawFrontmatter = Record<string, unknown>;

function readTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > ZERO ? trimmed : undefined;
}

function parseToolsField(value: unknown): readonly string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > ZERO);
}

function parsePermissionMode(frontmatter: RawFrontmatter): SubagentPermissionMode {
  if (readTruthy(frontmatter['readonly'])) {
    return 'readonly';
  }
  const modeVal = readTrimmedString(frontmatter['permissionMode'] ?? frontmatter['permissionmode'] ?? frontmatter['permission_mode']);
  return modeVal?.toLowerCase() === 'readonly' ? 'readonly' : 'default';
}

function fallbackNameFromPath(filePath: string): string {
  const base = basename(filePath, extname(filePath));
  return base.replace(/[\s_]+/g, '-');
}

function safeParseAgentFrontmatter(filePath: string): { readonly frontmatter: RawFrontmatter; readonly body: string } | undefined {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return undefined;
    }
    const content = readFileSync(filePath, 'utf8');
    if (!FRONTMATTER_BLOCK_REGEX.test(content)) {
      return undefined;
    }
    return parseFrontmatter<RawFrontmatter>(content);
  } catch {
    return undefined;
  }
}

function parseSubagentFile(filePath: string, source: SubagentSource): SubagentDefinition | undefined {
  const parsed = safeParseAgentFrontmatter(filePath);
  if (!parsed) {
    return undefined;
  }
  const { frontmatter, body } = parsed;
  const prompt = body.trim();
  if (prompt.length === ZERO) {
    return undefined;
  }
  return {
    name: readTrimmedString(frontmatter['name']) ?? fallbackNameFromPath(filePath),
    description: readTrimmedString(frontmatter['description']) ?? '',
    tools: parseToolsField(frontmatter['tools']),
    model: readTrimmedString(frontmatter['model']) ?? 'inherit',
    forceDefaultModel: readTruthy(frontmatter['force-default-model']),
    prompt,
    permissionMode: parsePermissionMode(frontmatter),
    isBackground: readTruthy(frontmatter['background'] ?? frontmatter['is_background']),
    nestedTasks: readTruthy(frontmatter['nested-tasks']),
    source,
    fullPath: filePath,
  };
}

function safeReadDirEntries(dirPath: string) {
  try {
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      return [];
    }
    return readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function walkAgentFiles(dirPath: string): readonly string[] {
  const entries = safeReadDirEntries(dirPath);
  return entries.flatMap((entry) => {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return walkAgentFiles(fullPath);
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      return [];
    }
    return AGENT_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase()) ? [fullPath] : [];
  });
}

function computeAgentDirectories(cwd: string, userHome: string, agentDir: string): readonly DirectorySpec[] {
  const workspaceRoot = resolve(cwd);
  return [
    { dirPath: join(workspaceRoot, '.pi', 'agents'), source: 'workspace' },
    { dirPath: join(workspaceRoot, '.agents', 'agents'), source: 'shared-workspace' },
    { dirPath: join(agentDir, 'agents'), source: 'user' },
    { dirPath: join(userHome, '.agents', 'agents'), source: 'shared-user' },
  ];
}

export function discoverSubagents(cwd: string, options?: { readonly homeDir?: string; readonly agentDir?: string }): readonly SubagentDefinition[] {
  const dirs = computeAgentDirectories(cwd, options?.homeDir ?? homedir(), options?.agentDir ?? getAgentDir());
  const discoveredCustom = dirs.flatMap((spec) =>
    walkAgentFiles(spec.dirPath)
      .map((filePath) => parseSubagentFile(filePath, spec.source))
      .filter((def): def is SubagentDefinition => def !== undefined),
  );
  const combined = [...discoveredCustom, ...BUILTIN_SUBAGENTS];
  const deduped = combined.reduce<Readonly<Record<string, SubagentDefinition>>>((acc, def) => {
    const key = def.name.trim();
    if (key.length === ZERO || acc[key] !== undefined) {
      return acc;
    }
    return { ...acc, [key]: def };
  }, {});
  return Object.values(deduped);
}

export function normalizeSubagentTypeName(rawType: string | undefined): string {
  const trimmed = (rawType ?? '').trim();
  if (trimmed.length === ZERO) {
    return DEFAULT_SUBAGENT_TYPE;
  }
  const lower = trimmed.toLowerCase();
  return SUBAGENT_TYPE_ALIASES[lower] ?? trimmed;
}

export function resolveSubagentDefinition(definitions: readonly SubagentDefinition[], rawType: string | undefined): SubagentDefinition | undefined {
  const normalized = normalizeSubagentTypeName(rawType);
  const exact = definitions.find((def) => def.name === normalized);
  if (exact) {
    return exact;
  }
  const lower = normalized.toLowerCase();
  return definitions.find((def) => def.name.toLowerCase() === lower);
}
