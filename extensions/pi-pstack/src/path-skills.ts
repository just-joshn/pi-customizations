// Cursor attaches a skill to the conversation when the agent reads a file matching its `paths`/`globs` frontmatter.
// Pi has no path-scoped skills, so this module tracks the files a session reads or edits and attaches the matching
// skill body once per session, in the same <skill> block shape Pi's own /skill:name expansion uses.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, matchesGlob, relative, sep } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';

/** A skill whose frontmatter scopes it to file patterns. */
export interface PathSkill {
  name: string;
  file: string;
  globs: string[];
  body: string;
}

const TOUCHED_TOOLS = new Set(['read', 'edit', 'write']);
const SECTION_LIMIT = 40_000;

function globsOf(value: unknown): string[] {
  if (typeof value === 'string')
    return value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  if (!Array.isArray(value)) return [];
  return value.filter((part): part is string => typeof part === 'string' && part.trim() !== '').map((part) => part.trim());
}

/** Every loaded skill that declares `paths` (Cursor's name for skill globs) or `globs`. */
export function loadPathSkills(commands: readonly { name: string; source: string; sourceInfo: { path: string } }[]): PathSkill[] {
  const skills: PathSkill[] = [];
  for (const command of commands) {
    if (command.source !== 'skill' || !command.name.startsWith('skill:')) continue;
    const file = command.sourceInfo.path;
    if (!existsSync(file)) continue;
    const { frontmatter, body } = parseFrontmatter(readFileSync(file, 'utf8'));
    // `metadata` is the portable Agent Skills extension point; Cursor's own field is the top-level `paths`/`globs`.
    const metadata = typeof frontmatter['metadata'] === 'object' && frontmatter['metadata'] !== null ? (frontmatter['metadata'] as Record<string, unknown>) : {};
    const globs = [...new Set([...globsOf(frontmatter['paths']), ...globsOf(frontmatter['globs']), ...globsOf(metadata['paths']), ...globsOf(metadata['globs'])])];
    if (globs.length === 0) continue;
    skills.push({ name: command.name.slice('skill:'.length), file, globs, body: body.trim() });
  }
  return skills;
}

const slash = (path: string) => path.split(sep).join('/');

/** The skills whose patterns match a path the session read or edited. Paths outside the workspace are ignored. */
export function matchPathSkills(skills: readonly PathSkill[], paths: Iterable<string>, cwd: string): PathSkill[] {
  const relativePaths = [...paths].map((path) => slash(isAbsolute(path) ? relative(cwd, path) : path)).filter((path) => path !== '' && path !== '..' && !path.startsWith('../'));
  return skills.filter((skill) => relativePaths.some((path) => skill.globs.some((glob) => matchesGlob(path, glob))));
}

/** The attached bodies as <skill> blocks, in the shape Pi's /skill:name expansion builds. */
export function pathSkillsSection(skills: readonly PathSkill[]): string | undefined {
  if (skills.length === 0) return undefined;
  const blocks: string[] = [];
  let size = 0;
  for (const skill of skills) {
    const block = [`<skill name="${skill.name}" location="${skill.file}">`, `References are relative to ${dirname(skill.file)}.`, '', skill.body, '</skill>'].join('\n');
    if (size + block.length > SECTION_LIMIT) break;
    size += block.length;
    blocks.push(block);
  }
  return blocks.length === 0 ? undefined : blocks.join('\n\n');
}

export interface PathSkillsHandle {
  /** The skills to attach to the next request, empty until a matching file has been read or edited. */
  section: () => string | undefined;
}

/** Tracks read and edit paths and attaches each matching skill once per session. */
export function createPathSkills(pi: ExtensionAPI): PathSkillsHandle {
  let catalog: PathSkill[] | undefined;
  let cwd = process.cwd();
  let touched = new Set<string>();
  const injected = new Set<string>();

  pi.on('session_start', (_event, ctx) => {
    catalog = undefined;
    touched = new Set();
    injected.clear();
    cwd = ctx.cwd;
  });
  pi.on('tool_call', (event) => {
    if (!TOUCHED_TOOLS.has(event.toolName)) return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path === 'string' && path !== '') touched.add(path);
  });

  return {
    section: () => {
      if (touched.size === 0) return undefined;
      catalog ??= loadPathSkills(pi.getCommands());
      const matches = matchPathSkills(catalog, touched, cwd).filter((skill) => !injected.has(skill.name));
      if (matches.length === 0) return undefined;
      for (const skill of matches) injected.add(skill.name);
      return pathSkillsSection(matches);
    },
  };
}
