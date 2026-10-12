import { existsSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';

import type { ImageContent } from '@earendil-works/pi-ai';
import type { SlashCommandInfo } from '@earendil-works/pi-coding-agent';
import { SKILLS_DIR } from './paths.ts';

const ALIAS = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/;
const SKILL_PREFIX = 'skill:';

const isSkill = (command: SlashCommandInfo) => command.source === 'skill' && command.name.startsWith(SKILL_PREFIX);

/**
 * Cursor-style `/name` aliases with their descriptions: every skill Pi loaded, as Cursor attaches any skill by name
 * (pstack itself creates skills such as `/<handle>-mode`), minus any name a prompt template or extension command owns.
 * Settings that filter a skill out also drop its alias. Pi handles its built-in commands before the input event.
 */
export function aliasTable(commands: readonly SlashCommandInfo[]): ReadonlyMap<string, string> {
  const taken = new Set(commands.filter((command) => command.source !== 'skill').map((command) => command.name));
  const table = new Map<string, string>();
  for (const command of commands.filter(isSkill)) {
    const name = command.name.slice(SKILL_PREFIX.length);
    if (!taken.has(name)) table.set(name, command.description ?? '');
  }
  return table;
}

// Pi records a skill path as configured, which can run through a symlink; realpaths are cached per runtime.
const realPaths = new Map<string, string | undefined>();
function realPath(path: string): string | undefined {
  if (!realPaths.has(path)) realPaths.set(path, existsSync(path) ? realpathSync(path) : undefined);
  return realPaths.get(path);
}

/** Names of the loaded skills that live in this package, sorted; the host map's skill list. */
export function packageSkillNames(commands: readonly SlashCommandInfo[], skillsDir: string = SKILLS_DIR): string[] {
  const root = `${realPath(skillsDir) ?? skillsDir}${sep}`;
  return commands
    .filter((command) => isSkill(command) && realPath(command.sourceInfo.path)?.startsWith(root) === true)
    .map((command) => command.name.slice(SKILL_PREFIX.length))
    .toSorted();
}

/**
 * Rewrites `/name args` to Pi's native `/skill:name args` for an aliased skill, keeping the argument text.
 * Pi splits the skill name at the first space and trims the arguments, so a space always follows the name.
 */
export function aliasTransform(text: string, names: ReadonlySet<string>): string | undefined {
  const match = ALIAS.exec(text);
  const name = match?.[1];
  if (match === null || name === undefined || !names.has(name)) return undefined;
  const rest = text.slice(match[0].length);
  if (rest.length === 0) return `/skill:${name}`;
  return `/skill:${name} ${rest.startsWith(' ') ? rest.slice(1) : rest}`;
}

export type AliasInputResult = { action: 'continue' } | { action: 'transform'; text: string; images?: ImageContent[] };

/** The `input` handler result: Pi's native skill command for an aliased skill, otherwise continue unchanged. */
export function aliasInputResult(event: { text: string; images?: ImageContent[] }, names: ReadonlySet<string>): AliasInputResult {
  const text = aliasTransform(event.text, names);
  if (text === undefined) return { action: 'continue' };
  return { action: 'transform', text, ...(event.images === undefined ? {} : { images: event.images }) };
}
