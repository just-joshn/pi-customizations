import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import type { SubagentsConfig } from './config.ts';
import { DEFAULT_SUBAGENT_TYPE, ONE, type SubagentDefinition, type SubagentPermissionMode, type SubagentSampling, type SubagentSource, type SubagentThinkingLevel, ThinkingLevelSchema, ZERO } from './types.ts';

const AGENT_FILE_EXTENSIONS = new Set(['.md', '.mdc', '.markdown']);
const FRONTMATTER_BLOCK_REGEX = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const MIN_KEYWORD_CHARS = 4;
const MIN_AUTO_SELECT_SCORE = 2;
const WORD_SPLIT_REGEX = /[^a-z0-9]+/;
const NAME_BOUNDARY = '[^a-z0-9_-]';
const NAME_CHAR = '[a-z0-9_-]';
const YAML_TRUE_SPELLINGS = new Set(['true', 'yes', 'on', 'y', '1']);
const SUBAGENT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  unspecified: 'general-purpose',
  generalpurpose: 'general-purpose',
  'general-purpose': 'general-purpose',
  bash: 'shell',
  shell: 'shell',
  explore: 'explore',
  debug: 'debug',
};
const WRITE_VERBS =
  'fix(?:ing)?|edit(?:ing)?|chang(?:e|ing)|modify|modifying|implement(?:ing)?|add(?:ing)?|create|creating|write|writing|update|updating|refactor(?:ing)?|rename|renaming|delete|deleting|remove|removing|patch(?:ing)?|migrate|migrating|bump(?:ing)?|upgrade|upgrading|rewrite|rewriting|split(?:ting)?|move|moving|optimize|optimizing|port(?:ing)?|format(?:ting)?|extract(?:ing)?|convert(?:ing)?|replace(?:ing)?|set(?:ting)?|insert(?:ing)?|apply|applying|generate|generating|simplify|simplifying|clean\\s+up|cleaning\\s+up|swap(?:ping)?|drop(?:ping)?|strip(?:ping)?|make|address|improve|rework|get|ensure';
const WRITE_VERB = `(?:${WRITE_VERBS})`;
const VERB_GAP = '(?:\\s*,\\s*(?:(?:and|or)\\s+)?|\\s+(?:and|or)\\s+|\\s*/\\s*|\\s*[\\u2014\\u2013]\\s*(?:(?:and|or)\\s+)?|\\s*\\(\\s*(?:(?:and|or)\\s+)?)';
const COORDINATED_WRITE = `${WRITE_VERB}(?:${VERB_GAP}${WRITE_VERB})*`;
const BROAD_NEGATION = "\\b(?:under no circumstances|do not|don['\\u2019]t|cannot|can['\\u2019]t|must not|should not)\\b";
const NEGATION_FILLER = 'just|simply|really|actually|please|under|any|circumstances|at|all|first|then|also|even|still|only|must|should|you|now|ever';
const NEGATION_GAP = `(?:[\\s,]+(?:${NEGATION_FILLER})\\b)*[\\s,]*`;
const SHORT_NEGATION = '\\b(?:never|avoid|without|no)\\b(?:\\s+\\w+){0,4}\\s+';
const NEGATED_WRITE = `${BROAD_NEGATION}${NEGATION_GAP}${COORDINATED_WRITE}\\b(?:\\s*\\))?|${SHORT_NEGATION}${COORDINATED_WRITE}\\b(?:\\s*\\))?`;
const HOW_TO_WRITE = `\\bhow\\s+to\\s+${WRITE_VERB}\\b`;
const WHAT_TO_WRITE = `\\bwhat\\s+to\\s+${WRITE_VERB}\\b`;
const DESCRIPTIVE_CUE = '(?:the|a|an|this|that|its|their|our|we|i|they|it|he|she)';
const DESCRIPTIVE_WRITE = `\\b${DESCRIPTIVE_CUE}\\s+${WRITE_VERB}\\b`;

const CLAUDE_TOOL_NAMES: Readonly<Record<string, string>> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  Bash: 'bash',
  Grep: 'grep',
  Glob: 'find',
  LS: 'ls',
};

const SELECTION_STOPWORDS = new Set([
  'with',
  'from',
  'that',
  'this',
  'then',
  'when',
  'your',
  'into',
  'over',
  'code',
  'file',
  'files',
  'task',
  'work',
  'agent',
  'agent.',
  'subagent',
  'uses',
  'using',
  'also',
  'more',
  'than',
  'they',
  'them',
  'have',
  'will',
  'must',
  'should',
]);

const EXPLORE_DEFAULT_TOOLS = ['read', 'grep', 'find', 'ls', 'bash'] as const;
const SHELL_DEFAULT_TOOLS = ['bash', 'read'] as const;
const MCP_TOOL_SEPARATOR = '__';

const CLAUDE_MODEL_ALIASES: Readonly<Record<string, string>> = {
  haiku: 'fast',
  sonnet: 'inherit',
  opus: 'inherit',
  inherit: 'inherit',
  default: 'inherit',
};

const THINKING_ALIASES: Readonly<Record<string, SubagentThinkingLevel>> = {
  none: 'off',
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

/** One entry per frontmatter concept. Every key spelling an agent author may use lives here. */
const FRONTMATTER_KEYS = {
  name: ['name'],
  description: ['description', 'when-to-use', 'when_to_use', 'whenToUse'],
  tools: ['tools'],
  model: ['model'],
  forceDefaultModel: ['force-default-model', 'force_default_model', 'forceDefaultModel'],
  readonly: ['readonly', 'read-only', 'read_only'],
  permissionMode: ['permissionMode', 'permission-mode', 'permission_mode', 'permission'],
  sandbox: ['sandbox_mode', 'sandbox-mode', 'sandboxMode', 'sandbox'],
  background: ['background', 'is_background', 'is-background', 'isBackground'],
  nestedTasks: ['nested-tasks', 'nested_tasks', 'nestedTasks', 'nested'],
  thinking: ['thinking', 'reasoning-effort', 'reasoning_effort', 'reasoningEffort', 'effort'],
  sampling: ['model-params', 'model_params', 'modelParams', 'sampling', 'sampling-params', 'sampling_params'],
  contextWindow: ['context-window', 'context_window', 'contextWindow', 'max-context', 'max_context', 'maxContext'],
  maxTokens: ['max-tokens', 'max_tokens', 'maxTokens'],
  retry: ['retry', 'max-attempts', 'max_attempts', 'maxAttempts'],
  worktree: ['worktree', 'isolate'],
  mcp: ['mcp'],
  enabled: ['enabled'],
  disabled: ['disabled'],
} as const;

type RawFrontmatter = Record<string, unknown>;

interface DirectorySpec {
  readonly dirPath: string;
  readonly source: SubagentSource;
}

interface BuiltinSpec {
  readonly definition: Omit<SubagentDefinition, 'source' | 'fullPath' | 'enabled'>;
}

export interface DiscoverSubagentsOptions {
  readonly homeDir?: string;
  readonly agentDir?: string;
  readonly config?: SubagentsConfig;
  /** Names of MCP servers or `mcp__` tools that look like a browser integration. */
  readonly browserIntegration?: string | undefined;
  /** Project agent directories load only for trusted projects. User directories always load. */
  readonly projectTrusted?: boolean;
}

function readField(frontmatter: RawFrontmatter, key: keyof typeof FRONTMATTER_KEYS): unknown {
  for (const alias of FRONTMATTER_KEYS[key]) {
    const value = frontmatter[alias];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function hasField(frontmatter: RawFrontmatter, key: keyof typeof FRONTMATTER_KEYS): boolean {
  return FRONTMATTER_KEYS[key].some((alias) => frontmatter[alias] !== undefined && frontmatter[alias] !== null);
}

function readTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === ONE;
  }
  return typeof value === 'string' && YAML_TRUE_SPELLINGS.has(value.trim().toLowerCase());
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > ZERO ? trimmed : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > ZERO) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > ZERO ? parsed : undefined;
  }
  return undefined;
}

export function parseContextWindow(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > ZERO) {
    return Math.floor(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*([km])?\s*$/i.exec(value);
  if (!match) {
    return undefined;
  }
  const [, amount, unit] = match;
  if (amount === undefined) {
    return undefined;
  }
  const multiplier = unit?.toLowerCase() === 'm' ? 1_000_000 : unit?.toLowerCase() === 'k' ? 1000 : ONE;
  return Math.floor(Number.parseFloat(amount) * multiplier);
}

function mapToolName(name: string): string {
  return CLAUDE_TOOL_NAMES[name] ?? name;
}

/** Maps Claude tool names onto Pi tool names for any tool list, whatever produced the definition. */
export function normalizeToolNames(tools: readonly string[]): readonly string[] {
  return tools.map(mapToolName);
}

function parseToolsField(value: unknown): readonly string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
  return normalizeToolNames(
    raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > ZERO),
  );
}

function parseThinking(value: unknown): SubagentThinkingLevel | undefined {
  const raw = readTrimmedString(value)?.toLowerCase();
  if (raw === undefined) {
    return undefined;
  }
  const alias = THINKING_ALIASES[raw];
  if (alias !== undefined) {
    return alias;
  }
  return ThinkingLevelSchema.safeParse(raw).success ? (raw as SubagentThinkingLevel) : undefined;
}

function mergeTopLevelMaxTokens(sampling: SubagentSampling | undefined, frontmatter: RawFrontmatter): SubagentSampling | undefined {
  const maxTokens = readPositiveInteger(readField(frontmatter, 'maxTokens'));
  return maxTokens === undefined ? sampling : { ...sampling, maxTokens };
}

function parseSampling(value: unknown): SubagentSampling | undefined {
  const raw = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  if (!raw) {
    return undefined;
  }
  const readNumber = (...keys: readonly string[]): number | undefined => {
    for (const key of keys) {
      const candidate = raw[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
    }
    return undefined;
  };
  const sampling: SubagentSampling = {
    ...(readNumber('temperature') !== undefined ? { temperature: readNumber('temperature') } : {}),
    ...(readNumber('topP', 'top_p', 'topp') !== undefined ? { topP: readNumber('topP', 'top_p', 'topp') } : {}),
    ...(readNumber('topK', 'top_k', 'topk') !== undefined ? { topK: readNumber('topK', 'top_k', 'topk') } : {}),
    ...(readNumber('maxTokens', 'max_tokens', 'maxOutputTokens') !== undefined ? { maxTokens: readNumber('maxTokens', 'max_tokens', 'maxOutputTokens') } : {}),
  };
  return Object.keys(sampling).length > ZERO ? sampling : undefined;
}

function parsePermissionMode(frontmatter: RawFrontmatter): SubagentPermissionMode {
  if (readTruthy(readField(frontmatter, 'readonly'))) {
    return 'readonly';
  }
  const modeVal = readTrimmedString(readField(frontmatter, 'permissionMode'))?.toLowerCase();
  if (modeVal === 'readonly' || modeVal === 'read-only' || modeVal === 'plan') {
    return 'readonly';
  }
  const sandbox = readTrimmedString(readField(frontmatter, 'sandbox'))?.toLowerCase();
  return sandbox === 'read-only' || sandbox === 'readonly' ? 'readonly' : 'default';
}

function parseModel(value: unknown): string {
  const raw = readTrimmedString(value);
  if (raw === undefined) {
    return 'inherit';
  }
  return CLAUDE_MODEL_ALIASES[raw.toLowerCase()] ?? raw;
}

function resolveEnabled(frontmatter: RawFrontmatter): boolean {
  if (readTruthy(readField(frontmatter, 'disabled'))) {
    return false;
  }
  if (!hasField(frontmatter, 'enabled')) {
    return true;
  }
  return readTruthy(readField(frontmatter, 'enabled'));
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
    const parsed = parseFrontmatter<RawFrontmatter>(content);
    return parsed;
  } catch {
    return undefined;
  }
}

export function parseSubagentFile(filePath: string, source: SubagentSource): SubagentDefinition | undefined {
  const parsed = safeParseAgentFrontmatter(filePath);
  if (!parsed) {
    return undefined;
  }
  const { frontmatter, body } = parsed;
  const prompt = body.trim();
  if (prompt.length === ZERO) {
    return undefined;
  }
  const tools = parseToolsField(readField(frontmatter, 'tools'));
  const name = readTrimmedString(readField(frontmatter, 'name')) ?? fallbackNameFromPath(filePath);
  return {
    name,
    description: readTrimmedString(readField(frontmatter, 'description')) ?? '',
    tools,
    ...(hasField(frontmatter, 'tools') ? { hasToolsField: true } : {}),
    model: parseModel(readField(frontmatter, 'model')),
    forceDefaultModel: readTruthy(readField(frontmatter, 'forceDefaultModel')),
    prompt,
    permissionMode: parsePermissionMode(frontmatter),
    isBackground: hasField(frontmatter, 'background') ? readTruthy(readField(frontmatter, 'background')) : undefined,
    nestedTasks: readTruthy(readField(frontmatter, 'nestedTasks')),
    thinking: parseThinking(readField(frontmatter, 'thinking')),
    sampling: mergeTopLevelMaxTokens(parseSampling(readField(frontmatter, 'sampling')), frontmatter),
    contextWindow: parseContextWindow(readField(frontmatter, 'contextWindow')),
    retryAttempts: readPositiveInteger(readField(frontmatter, 'retry')),
    worktree: readTruthy(readField(frontmatter, 'worktree')),
    mcp: readTruthy(readField(frontmatter, 'mcp')) || tools.some((tool) => tool.startsWith('mcp__')),
    enabled: resolveEnabled(frontmatter),
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

function isInsideProject(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(resolve(projectRoot), resolve(candidate));
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath));
}

export function computeAgentDirectories(cwd: string, userHome: string, agentDir: string, config?: SubagentsConfig, projectTrusted = true): readonly DirectorySpec[] {
  const workspaceRoot = resolve(cwd);
  const workspaceDirs: readonly DirectorySpec[] = projectTrusted
    ? [
        { dirPath: join(workspaceRoot, '.pi', 'agents'), source: 'workspace' },
        { dirPath: join(workspaceRoot, '.claude', 'agents'), source: 'claude-workspace' },
        { dirPath: join(workspaceRoot, '.codex', 'agents'), source: 'codex-workspace' },
        { dirPath: join(workspaceRoot, '.agents', 'agents'), source: 'shared-workspace' },
      ]
    : [];
  const userDirs: readonly DirectorySpec[] = [
    { dirPath: join(agentDir, 'agents'), source: 'user' },
    { dirPath: join(userHome, '.claude', 'agents'), source: 'claude-user' },
    { dirPath: join(userHome, '.codex', 'agents'), source: 'codex-user' },
    { dirPath: join(userHome, '.agents', 'agents'), source: 'shared-user' },
  ];
  const configured = (config?.extraAgentDirectories ?? []).filter((dirPath) => projectTrusted || !isInsideProject(workspaceRoot, dirPath)).map((dirPath): DirectorySpec => ({ dirPath, source: 'configured' }));
  return [...workspaceDirs, ...configured, ...userDirs];
}

function builtinGeneralPurpose(): BuiltinSpec {
  return {
    definition: {
      name: 'general-purpose',
      description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
      tools: [],
      model: 'inherit',
      forceDefaultModel: false,
      prompt: 'You are a focused subagent executing a delegated task. Complete the task thoroughly and return a concise, accurate summary of findings and changes.',
      permissionMode: 'default',
      isBackground: undefined,
      nestedTasks: false,
      thinking: undefined,
      sampling: undefined,
      contextWindow: undefined,
      retryAttempts: undefined,
      worktree: false,
      mcp: false,
    },
  };
}

function builtinExplore(config: SubagentsConfig | undefined): BuiltinSpec {
  return {
    definition: {
      name: 'explore',
      description: 'Fast read-only agent specialized for exploring codebases, finding files by pattern, searching code for keywords, and answering questions about the codebase.',
      tools: [...EXPLORE_DEFAULT_TOOLS],
      model: config === undefined || config.explore.model === 'default' ? 'fast' : config.explore.model,
      forceDefaultModel: false,
      prompt: 'You are a fast read-only codebase exploration subagent. Inspect files, search patterns, trace symbols, and return a clear, evidence-backed report with exact file paths and line numbers. Do not modify any files.',
      permissionMode: 'readonly',
      isBackground: undefined,
      nestedTasks: false,
      thinking: undefined,
      sampling: undefined,
      contextWindow: undefined,
      retryAttempts: undefined,
      worktree: false,
      mcp: false,
    },
  };
}

function builtinShell(): BuiltinSpec {
  return {
    definition: {
      name: 'shell',
      description: 'Command execution specialist for running bash commands, git operations, builds, and test suites.',
      tools: [...SHELL_DEFAULT_TOOLS],
      model: 'inherit',
      forceDefaultModel: false,
      prompt: 'You are a shell command execution specialist. Run the requested commands carefully, inspect output and exit codes, and report the concise result.',
      permissionMode: 'default',
      isBackground: undefined,
      nestedTasks: false,
      thinking: undefined,
      sampling: undefined,
      contextWindow: undefined,
      retryAttempts: undefined,
      worktree: false,
      mcp: false,
    },
  };
}

function builtinDebug(): BuiltinSpec {
  return {
    definition: {
      name: 'debug',
      description: 'Debugging specialist for tracing failures, inspecting logs, forming hypotheses, and isolating root causes.',
      tools: [],
      model: 'inherit',
      forceDefaultModel: false,
      prompt: 'You are a debugging subagent. Investigate symptoms systematically, verify hypotheses against real evidence, and report root causes with exact locations.',
      permissionMode: 'default',
      isBackground: undefined,
      nestedTasks: false,
      thinking: undefined,
      sampling: undefined,
      contextWindow: undefined,
      retryAttempts: undefined,
      worktree: false,
      mcp: false,
    },
  };
}

function browserToolPattern(integration: string): string {
  const prefix = `mcp${MCP_TOOL_SEPARATOR}`;
  if (integration.startsWith(prefix)) {
    const second = integration.indexOf(MCP_TOOL_SEPARATOR, prefix.length);
    if (second !== -ONE) {
      return `${integration.slice(ZERO, second + MCP_TOOL_SEPARATOR.length)}*`;
    }
  }
  return `${prefix}${integration.replace(/[^A-Za-z0-9_]/g, '_')}${MCP_TOOL_SEPARATOR}*`;
}

function builtinBrowser(integration: string): BuiltinSpec {
  return {
    definition: {
      name: 'browser',
      description: `Browser work through the ${integration} MCP integration: open pages, click, type, read the DOM, and capture screenshots.`,
      tools: [browserToolPattern(integration)],
      model: 'inherit',
      forceDefaultModel: false,
      prompt: 'You are a browser automation subagent. Use the available MCP browser tools to inspect and drive the page. Report what you observed with concrete evidence such as page titles, selectors, and captured text.',
      permissionMode: 'default',
      isBackground: undefined,
      nestedTasks: false,
      thinking: undefined,
      sampling: undefined,
      contextWindow: undefined,
      retryAttempts: undefined,
      worktree: false,
      mcp: true,
    },
  };
}

function toDefinition(spec: BuiltinSpec): SubagentDefinition {
  return { ...spec.definition, enabled: true, source: 'builtin', fullPath: undefined };
}

function buildBuiltins(config: SubagentsConfig | undefined, browserIntegration: string | undefined): readonly SubagentDefinition[] {
  const explore = config?.explore.enabled === false ? [] : [toDefinition(builtinExplore(config))];
  const browser = browserIntegration !== undefined && config?.browser.enabled !== false ? [toDefinition(builtinBrowser(browserIntegration))] : [];
  return [toDefinition(builtinGeneralPurpose()), ...explore, toDefinition(builtinShell()), toDefinition(builtinDebug()), ...browser];
}

function dedupeByName(definitions: readonly SubagentDefinition[]): readonly SubagentDefinition[] {
  const seen = new Set<string>();
  return definitions.filter((definition) => {
    const key = definition.name.trim().toLowerCase();
    if (key.length === ZERO || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function discoverSubagents(cwd: string, options: DiscoverSubagentsOptions = {}): readonly SubagentDefinition[] {
  const config = options.config;
  const dirs = computeAgentDirectories(cwd, options.homeDir ?? homedir(), options.agentDir ?? getAgentDir(), config, options.projectTrusted ?? true);
  const discovered = dirs.flatMap((spec) =>
    walkAgentFiles(spec.dirPath)
      .map((filePath) => parseSubagentFile(filePath, spec.source))
      .filter((definition): definition is SubagentDefinition => definition !== undefined),
  );
  const disabled = new Set((config?.disabledAgents ?? []).map((name) => name.trim().toLowerCase()));
  const combined = dedupeByName([...discovered, ...buildBuiltins(config, options.browserIntegration)]);
  return combined.filter((definition) => definition.enabled && !disabled.has(definition.name.toLowerCase()));
}

export function normalizeSubagentTypeName(rawType: string | undefined): string {
  const trimmed = (rawType ?? '').trim();
  if (trimmed.length === ZERO) {
    return DEFAULT_SUBAGENT_TYPE;
  }
  return SUBAGENT_TYPE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function findDefinitionByName(definitions: readonly SubagentDefinition[], name: string): SubagentDefinition | undefined {
  const exact = definitions.find((definition) => definition.name === name);
  if (exact) {
    return exact;
  }
  const lower = name.toLowerCase();
  return definitions.find((definition) => definition.name.toLowerCase() === lower);
}

export function resolveSubagentDefinition(definitions: readonly SubagentDefinition[], rawType: string | undefined): SubagentDefinition | undefined {
  const trimmed = (rawType ?? '').trim();
  const discovered = trimmed.length === ZERO ? undefined : findDefinitionByName(definitions, trimmed);
  if (discovered) {
    return discovered;
  }
  return findDefinitionByName(definitions, normalizeSubagentTypeName(rawType));
}

const PLURAL_SUFFIX_CHARS = 1;

function normalizeWord(word: string): string {
  return word.length > MIN_KEYWORD_CHARS && word.endsWith('s') ? word.slice(ZERO, -PLURAL_SUFFIX_CHARS) : word;
}

function descriptionKeywords(description: string): readonly string[] {
  const keywords = description
    .toLowerCase()
    .split(WORD_SPLIT_REGEX)
    .map(normalizeWord)
    .filter((word) => word.length >= MIN_KEYWORD_CHARS && !SELECTION_STOPWORDS.has(word));
  return [...new Set(keywords)];
}

function countMentionedKeywords(text: string, keywords: readonly string[]): number {
  const words = new Set(text.toLowerCase().split(WORD_SPLIT_REGEX).map(normalizeWord));
  return keywords.filter((keyword) => words.has(keyword)).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namePattern(name: string, suffix: string): RegExp | undefined {
  const needle = name.trim().toLowerCase();
  if (needle.length === ZERO) {
    return undefined;
  }
  return new RegExp(`(?:^|${NAME_BOUNDARY})${escapeRegExp(needle)}${suffix}`);
}

function mentionsName(text: string, name: string): boolean {
  const pattern = namePattern(name, `(?:${NAME_BOUNDARY}|$)`);
  return pattern !== undefined && pattern.test(text.toLowerCase());
}

function extendsName(text: string, name: string): boolean {
  const pattern = namePattern(name, NAME_CHAR);
  return pattern !== undefined && pattern.test(text.toLowerCase());
}

function stripDiscoveredNames(text: string, names: readonly string[]): string {
  const ordered = names
    .map((name) => name.trim())
    .filter((name) => name.length > ZERO)
    .toSorted((left, right) => right.length - left.length);
  return ordered.reduce((current, name) => current.replace(new RegExp(`(?:^|${NAME_BOUNDARY})${escapeRegExp(name)}(?=${NAME_BOUNDARY}|$)`, 'gi'), ' '), text);
}

function textHasWriteIntent(text: string, names: readonly string[]): boolean {
  const stripped = stripDiscoveredNames(text, names);
  const withoutNegation = stripped.replace(new RegExp(NEGATED_WRITE, 'gi'), ' ');
  const withoutPhrases = withoutNegation.replace(new RegExp(`${HOW_TO_WRITE}|${WHAT_TO_WRITE}`, 'gi'), ' ');
  const withoutDescriptive = withoutPhrases.replace(new RegExp(DESCRIPTIVE_WRITE, 'gi'), ' ');
  return new RegExp(`\\b(?:${WRITE_VERBS})\\b`, 'i').test(withoutDescriptive);
}

function nameContainedIn(name: string, other: string): boolean {
  return other.length > name.length && other.toLowerCase().includes(name.toLowerCase());
}

function longestNamedMatches(matches: readonly SubagentDefinition[]): readonly SubagentDefinition[] {
  return matches.filter((candidate) => !matches.some((other) => nameContainedIn(candidate.name, other.name)));
}

function isPartOfLongerName(text: string, definition: SubagentDefinition, definitions: readonly SubagentDefinition[]): boolean {
  const name = definition.name.trim().toLowerCase();
  return definitions.some((other) => {
    const longer = other.name.trim().toLowerCase();
    if (longer.length <= name.length || !longer.startsWith(name)) {
      return false;
    }
    const separator = longer[name.length];
    if (separator !== ' ' && separator !== '-') {
      return false;
    }
    const next = longer.slice(name.length).trim().replace(/^-+/, '').split(/\s+/)[0];
    if (next === undefined || next.length === ZERO) {
      return false;
    }
    return new RegExp(`(?:^|${NAME_BOUNDARY})${escapeRegExp(name)}\\s+${escapeRegExp(next)}(?:s|es)?(?:${NAME_BOUNDARY}|$)`, 'i').test(text);
  });
}

/**
 * Picks the subagent for a task that did not name one. An explicit name in the task text wins, then
 * the definition whose description shares the most keywords with the task. Overlapping names keep the
 * longest match. Two or more distinct names fall back to the general-purpose agent when it is available,
 * otherwise the first available definition. A change request with no writable agent returns general-purpose.
 */
function fallbackSubagentType(definitions: readonly SubagentDefinition[]): string {
  const general = definitions.find((definition) => definition.name.toLowerCase() === DEFAULT_SUBAGENT_TYPE);
  return general?.name ?? definitions[ZERO]?.name ?? DEFAULT_SUBAGENT_TYPE;
}

export function selectSubagentType(definitions: readonly SubagentDefinition[], hint: { readonly subagentType?: string | undefined; readonly description: string; readonly prompt: string }): string {
  const named = hint.subagentType?.trim();
  if (named !== undefined && named.length > ZERO) {
    return resolveSubagentDefinition(definitions, named)?.name ?? named;
  }
  const text = `${hint.description} ${hint.prompt}`;
  const asksForChange = textHasWriteIntent(
    text,
    definitions.map((definition) => definition.name),
  );
  const writable = definitions.filter((definition) => definition.permissionMode !== 'readonly');
  if (asksForChange && writable.length === ZERO) {
    return DEFAULT_SUBAGENT_TYPE;
  }
  const eligible = asksForChange ? writable : definitions;
  const namedMatches = longestNamedMatches(eligible.filter((definition) => mentionsName(text, definition.name))).filter((definition) => !isPartOfLongerName(text, definition, eligible));
  if (namedMatches.length > ONE) {
    return fallbackSubagentType(eligible);
  }
  const singleMatch = namedMatches[ZERO];
  if (singleMatch !== undefined) {
    return singleMatch.name;
  }
  const keywordPool = eligible.filter((definition) => !extendsName(text, definition.name) && !isPartOfLongerName(text, definition, eligible));
  const scored = keywordPool.map((definition) => ({ name: definition.name, score: countMentionedKeywords(text, descriptionKeywords(definition.description)) })).toSorted((left, right) => right.score - left.score);
  const best = scored[ZERO];
  const runnerUp = scored[ONE];
  const fallback = fallbackSubagentType(eligible);
  if (best === undefined || (runnerUp !== undefined && runnerUp.score >= best.score)) {
    return fallback;
  }
  const uniqueLeader = best.score > ZERO && runnerUp?.score === ZERO;
  return best.score >= MIN_AUTO_SELECT_SCORE || uniqueLeader ? best.name : fallback;
}
