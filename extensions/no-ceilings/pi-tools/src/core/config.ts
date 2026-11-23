import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';
import { DEFAULT_IGNORE_FILES, PROJECT_CONFIG_FILE, USER_CONFIG_FILE } from '../constants.ts';
import type { ApprovalMode, PolicyRule, RuleAction, RuleKind } from '../types.ts';
import { createPolicy, type Policy } from './policy.ts';

const RuleSchema = z.object({
  kind: z.enum(['read', 'write', 'exec']),
  action: z.enum(['allow', 'deny']),
  pattern: z.string().min(1),
});

const WebSearchSchema = z.object({
  /** URL template. `{query}` is replaced with the encoded search term. */
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  /** JSON path of the result array. Defaults to `results`, then `references`. */
  resultsPath: z.string().optional(),
});

export const PiToolsConfigSchema = z.object({
  mode: z.enum(['unrestricted', 'auto', 'allowlist']).optional(),
  workspaceRoots: z.array(z.string()).optional(),
  ignoreFiles: z.array(z.string()).optional(),
  rules: z.array(RuleSchema).optional(),
  web: z
    .object({
      search: WebSearchSchema.optional(),
    })
    .optional(),
});

export type PiToolsConfig = z.infer<typeof PiToolsConfigSchema>;

export interface LoadedConfig {
  readonly config: PiToolsConfig;
  readonly policy: Policy;
  /** Paths of the files that supplied settings. */
  readonly sources: readonly string[];
  readonly errors: readonly string[];
}

export interface LoadConfigOptions {
  readonly cwd: string;
  readonly home: string;
  readonly agentDir: string;
  /** Project configuration is trusted only for a trusted project. */
  readonly projectTrusted: boolean;
  /** Environment overrides, for tests and for headless runs. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

async function readConfigFile(file: string): Promise<{ config: PiToolsConfig; error?: string }> {
  try {
    const body = await readFile(file, 'utf8');
    const parsed = PiToolsConfigSchema.safeParse(JSON.parse(body));
    if (!parsed.success) {
      return { config: {}, error: `${file}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}` };
    }
    return { config: parsed.data };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { config: {} };
    }
    return { config: {}, error: `${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function rulesFromEnv(env: Readonly<Record<string, string | undefined>>): { rules: PolicyRule[]; errors: string[] } {
  const raw = env['PI_TOOLS_RULES'];
  if (!raw) {
    return { rules: [], errors: [] };
  }
  const rules: PolicyRule[] = [];
  const errors: string[] = [];
  for (const entry of raw.split(',')) {
    const [kind, action, ...rest] = entry.split(':');
    const pattern = rest.join(':').trim();
    if ((kind === 'read' || kind === 'write' || kind === 'exec') && (action === 'allow' || action === 'deny') && pattern !== '') {
      rules.push({ kind: kind as RuleKind, action: action as RuleAction, pattern });
    } else {
      errors.push(`Invalid PI_TOOLS_RULES entry: ${entry.trim()}`);
    }
  }
  return { rules, errors };
}

/** Merge user config, project config, and environment overrides into the policy for a session. */
export async function loadConfig(options: LoadConfigOptions): Promise<LoadedConfig> {
  const env = options.env ?? process.env;
  const sources: string[] = [];
  const errors: string[] = [];

  const userFile = path.join(options.agentDir, USER_CONFIG_FILE);
  const projectFile = path.join(options.cwd, PROJECT_CONFIG_FILE);
  const user = await readConfigFile(userFile);
  if (user.error) {
    errors.push(user.error);
  } else if (Object.keys(user.config).length > 0) {
    sources.push(userFile);
  }
  const project = options.projectTrusted ? await readConfigFile(projectFile) : { config: {} };
  if (configError(project)) {
    errors.push(project.error);
  } else if (Object.keys(project.config).length > 0) {
    sources.push(projectFile);
  }

  const envRules = rulesFromEnv(env);
  errors.push(...envRules.errors);
  const merged: PiToolsConfig = {
    ...user.config,
    ...project.config,
    rules: [...(user.config.rules ?? []), ...(project.config.rules ?? []), ...envRules.rules],
  };
  const modeOverride = env['PI_TOOLS_MODE'];
  const mode: ApprovalMode | undefined = modeOverride === 'unrestricted' || modeOverride === 'auto' || modeOverride === 'allowlist' ? modeOverride : merged.mode;
  const ignoreFiles = env['PI_TOOLS_IGNORE_FILES']
    ? env['PI_TOOLS_IGNORE_FILES']
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : (merged.ignoreFiles ?? [...DEFAULT_IGNORE_FILES]);

  const policy = createPolicy({
    cwd: options.cwd,
    home: options.home,
    ...(mode === undefined ? {} : { mode }),
    rules: merged.rules ?? [],
    ...(merged.workspaceRoots === undefined ? {} : { workspaceRoots: merged.workspaceRoots }),
    ignoreFiles,
  });

  return { config: merged, policy, sources, errors };
}

function configError(value: { config: PiToolsConfig; error?: string }): value is { config: PiToolsConfig; error: string } {
  return typeof value.error === 'string';
}
