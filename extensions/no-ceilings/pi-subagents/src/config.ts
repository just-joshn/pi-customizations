import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { z } from 'zod';
import { DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_DELAY_MS, DEFAULT_WORKTREE_BRANCH_PREFIX, HARD_MAX_NESTED_TASK_DEPTH, MAX_NESTED_TASK_DEPTH, ONE, SUBAGENTS_CONFIG_FILE_NAME, ZERO } from './types.ts';

export const DEFAULT_BROWSER_SERVER_HINTS = ['playwright', 'puppeteer', 'browser', 'chrome', 'chromium', 'firefox', 'webkit', 'selenium', 'cdp'] as const;

const ExploreConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    model: z.string().default('default'),
  })
  .strict();

const BrowserConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    serverHints: z.array(z.string()).default([...DEFAULT_BROWSER_SERVER_HINTS]),
  })
  .strict();

const AgentsConfigSchema = z
  .object({
    disabled: z.array(z.string()).default([]),
    directories: z.array(z.string()).default([]),
  })
  .strict();

const NestingConfigSchema = z
  .object({
    maxDepth: z.number().int().min(ZERO).max(HARD_MAX_NESTED_TASK_DEPTH).default(MAX_NESTED_TASK_DEPTH),
  })
  .strict();

const DefaultsConfigSchema = z
  .object({
    background: z.boolean().default(false),
  })
  .strict();

const RetryConfigSchema = z
  .object({
    maxAttempts: z.number().int().min(ONE).max(10).default(DEFAULT_RETRY_ATTEMPTS),
    delayMs: z.number().int().min(ZERO).max(60_000).default(DEFAULT_RETRY_DELAY_MS),
  })
  .strict();

const WorktreesConfigSchema = z
  .object({
    root: z.string().min(ONE).optional(),
    branchPrefix: z.string().min(ONE).default(DEFAULT_WORKTREE_BRANCH_PREFIX),
  })
  .strict();

const CONFIG_SECTION_KEYS = new Set<string>(['explore', 'browser', 'agents', 'nesting', 'defaults', 'retry', 'worktrees']);

export interface ExploreConfig {
  readonly enabled: boolean;
  /** `default` uses the built-in fast model pick, `inherit` uses the parent model, anything else is a model id. */
  readonly model: string;
}

export interface BrowserConfig {
  readonly enabled: boolean;
  readonly serverHints: readonly string[];
}

export interface SubagentsConfig {
  readonly explore: ExploreConfig;
  readonly browser: BrowserConfig;
  readonly disabledAgents: readonly string[];
  readonly extraAgentDirectories: readonly string[];
  readonly maxNestingDepth: number;
  readonly defaultBackground: boolean;
  readonly retry: Readonly<{ maxAttempts: number; delayMs: number }>;
  readonly worktrees: Readonly<{ root: string | undefined; branchPrefix: string }>;
  readonly configFiles: readonly string[];
  readonly errors: readonly string[];
}

interface ConfigFlagOverrides {
  readonly exploreModel?: string | undefined;
  readonly maxNestingDepth?: string | undefined;
}

function readConfigFile(filePath: string): { readonly raw: unknown; readonly error?: string } | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return { raw: JSON.parse(readFileSync(filePath, 'utf8')) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { raw: undefined, error: `${filePath}: ${message}` };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Project values win over user values, section by section. One level is enough for this config shape. */
function mergeRawConfigs(userRaw: unknown, projectRaw: unknown): unknown {
  const user = asRecord(userRaw);
  const project = asRecord(projectRaw);
  const keys = new Set([...Object.keys(user), ...Object.keys(project)]);
  return Object.fromEntries(
    [...keys].map((key) => {
      const userSection = user[key];
      const projectSection = project[key];
      if (projectSection === undefined) {
        return [key, userSection];
      }
      if (userSection === undefined) {
        return [key, projectSection];
      }
      const userIsObject = typeof userSection === 'object' && userSection !== null && !Array.isArray(userSection);
      const projectIsObject = typeof projectSection === 'object' && projectSection !== null && !Array.isArray(projectSection);
      return [key, userIsObject && projectIsObject ? { ...asRecord(userSection), ...asRecord(projectSection) } : projectSection];
    }),
  );
}

function unknownSectionErrors(merged: Record<string, unknown>): readonly string[] {
  return Object.keys(merged)
    .filter((key) => !CONFIG_SECTION_KEYS.has(key))
    .map((key) => `${key}: unrecognized section`);
}

function parseDepthOverride(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === ZERO) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < ZERO) {
    return undefined;
  }
  return Math.min(parsed, HARD_MAX_NESTED_TASK_DEPTH);
}

function resolveConfiguredPath(rawPath: string, cwd: string): string {
  return rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath) ? rawPath : resolve(cwd, rawPath);
}

/** Parses one section, so one bad value cannot reset the sections that are valid. */
function parseSection<T>(schema: z.ZodType<T>, raw: unknown, key: string, errors: string[]): T {
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  for (const issue of parsed.error.issues) {
    errors.push(`${key}.${issue.path.join('.') || key}: ${issue.message}`);
  }
  return schema.parse({});
}

export function parseSubagentsConfig(userRaw: unknown, projectRaw: unknown, options: { readonly cwd: string; readonly flags?: ConfigFlagOverrides }): { readonly config: SubagentsConfig; readonly errors: readonly string[] } {
  const merged = asRecord(mergeRawConfigs(userRaw, projectRaw));
  const errors: string[] = [...unknownSectionErrors(merged)];
  const explore = parseSection(ExploreConfigSchema, merged['explore'], 'explore', errors);
  const browser = parseSection(BrowserConfigSchema, merged['browser'], 'browser', errors);
  const agents = parseSection(AgentsConfigSchema, merged['agents'], 'agents', errors);
  const nesting = parseSection(NestingConfigSchema, merged['nesting'], 'nesting', errors);
  const defaults = parseSection(DefaultsConfigSchema, merged['defaults'], 'defaults', errors);
  const retry = parseSection(RetryConfigSchema, merged['retry'], 'retry', errors);
  const worktrees = parseSection(WorktreesConfigSchema, merged['worktrees'], 'worktrees', errors);
  const depthOverride = parseDepthOverride(options.flags?.maxNestingDepth);
  const exploreModelOverride = options.flags?.exploreModel?.trim();
  return {
    config: {
      explore: {
        enabled: explore.enabled,
        model: exploreModelOverride !== undefined && exploreModelOverride.length > ZERO ? exploreModelOverride : explore.model,
      },
      browser: { enabled: browser.enabled, serverHints: browser.serverHints },
      disabledAgents: agents.disabled,
      extraAgentDirectories: agents.directories.map((dirPath) => resolveConfiguredPath(dirPath, options.cwd)),
      maxNestingDepth: depthOverride ?? nesting.maxDepth,
      defaultBackground: defaults.background,
      retry: { maxAttempts: retry.maxAttempts, delayMs: retry.delayMs },
      worktrees: {
        root: worktrees.root === undefined ? undefined : resolveConfiguredPath(worktrees.root, options.cwd),
        branchPrefix: worktrees.branchPrefix,
      },
      configFiles: [],
      errors,
    },
    errors,
  };
}

export function subagentsConfigPaths(cwd: string, agentDir: string): { readonly user: string; readonly project: string } {
  return { user: join(agentDir, SUBAGENTS_CONFIG_FILE_NAME), project: join(cwd, '.pi', SUBAGENTS_CONFIG_FILE_NAME) };
}

export function loadSubagentsConfig(cwd: string, agentDir: string, flags?: ConfigFlagOverrides, projectTrusted = true): SubagentsConfig {
  const paths = subagentsConfigPaths(cwd, agentDir);
  const userFile = readConfigFile(paths.user);
  const projectFile = projectTrusted ? readConfigFile(paths.project) : undefined;
  const parsed = parseSubagentsConfig(userFile?.raw, projectFile?.raw, { cwd, ...(flags ? { flags } : {}) });
  const fileErrors = [userFile?.error, projectFile?.error].filter((item): item is string => item !== undefined);
  const configFiles = [paths.user, projectTrusted ? paths.project : undefined].filter((filePath): filePath is string => filePath !== undefined && existsSync(filePath));
  return { ...parsed.config, configFiles, errors: [...fileErrors, ...parsed.config.errors] };
}
