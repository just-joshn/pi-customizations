import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';
import { isInsideHostPath } from '../paths.ts';

export type SkillMountOptions = { packageRoot: string; agentDir: string; homeDir: string; localCwd: string };

const TILDE_PREFIX = '~/';

const SettingsSkillsSchema = z.object({ skills: z.array(z.string()).optional() });

const SUBAGENT_LOG_DIR_MODE = 0o700;

const isDirectory = (dir: string): boolean => existsSync(dir) && statSync(dir).isDirectory();

/** Creates the subagent log directory when the agent directory exists, so even a fresh session gets the read-only `.output` mount. */
function ensureSubagentLogDir(agentDir: string): string {
  const dir = path.join(agentDir, 'pstack-v2', 'subagents');
  if (isDirectory(agentDir)) mkdirSync(dir, { recursive: true, mode: SUBAGENT_LOG_DIR_MODE });
  return dir;
}

/** The `skills` paths of the agent's settings.json. A missing or malformed file lists none. */
function settingsSkillPaths({ agentDir, homeDir }: SkillMountOptions): string[] {
  try {
    const parsed = SettingsSkillsSchema.parse(JSON.parse(readFileSync(path.join(agentDir, 'settings.json'), 'utf8')));
    return (parsed.skills ?? []).map((entry) => (entry.startsWith(TILDE_PREFIX) ? path.join(homeDir, entry.slice(TILDE_PREFIX.length)) : path.resolve(agentDir, entry)));
  } catch {
    return [];
  }
}

/** Skill roots to mount read-only at their host paths: existing directories outside the workspace, with no root inside an earlier one. */
export function discoverReadonlySkillMounts(options: SkillMountOptions): readonly string[] {
  const candidates = [options.packageRoot, path.join(options.agentDir, 'skills'), ensureSubagentLogDir(options.agentDir), path.join(options.homeDir, '.agents', 'skills'), ...settingsSkillPaths(options)].map((dir) => path.resolve(dir));
  return candidates.reduce<readonly string[]>((mounts, dir) => {
    const skip = !isDirectory(dir) || isInsideHostPath(options.localCwd, dir) || mounts.some((mounted) => isInsideHostPath(mounted, dir));
    return skip ? mounts : [...mounts, dir];
  }, []);
}
