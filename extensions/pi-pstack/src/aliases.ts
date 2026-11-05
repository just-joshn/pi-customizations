import { existsSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';

import type { ImageContent } from '@earendil-works/pi-ai';
import type { SlashCommandInfo } from '@earendil-works/pi-coding-agent';
import { SKILLS_DIR } from './paths.ts';
import { skillBlock } from './skill-block.ts';

const ALIAS = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/;
// Cursor CLI `findSkillReferences`: every `/name` at the start or after whitespace that names a skill attaches it.
const REFERENCE = /(?:^|\s)\/([a-zA-Z0-9_-]+)/g;
const SKILL_PREFIX = 'skill:';

const isSkill = (command: SlashCommandInfo) => command.source === 'skill' && command.name.startsWith(SKILL_PREFIX);

/** Names that prompt templates and extension commands own. Pi expands a leading template after the input event. */
export function commandNames(commands: readonly SlashCommandInfo[]): ReadonlySet<string> {
  return new Set(commands.filter((command) => command.source !== 'skill').map((command) => command.name));
}

/**
 * `/name` aliases with their descriptions: every skill Pi loaded, so any skill attaches by name
 * (pstack itself creates skills such as `/<handle>-mode`), minus any name a prompt template or extension command owns.
 * Settings that filter a skill out also drop its alias. Pi handles its built-in commands before the input event.
 */
export function aliasTable(commands: readonly SlashCommandInfo[]): ReadonlyMap<string, string> {
  const taken = commandNames(commands);
  const table = new Map<string, string>();
  for (const command of commands.filter(isSkill)) {
    const name = command.name.slice(SKILL_PREFIX.length);
    if (!taken.has(name)) table.set(name, command.description ?? '');
  }
  return table;
}

/** A loaded skill's block by name, read when a message names it. */
export const loadedSkillBlock =
  (commands: readonly SlashCommandInfo[]) =>
  (name: string): string | undefined => {
    const path = commands.find((command) => isSkill(command) && command.name === `${SKILL_PREFIX}${name}`)?.sourceInfo.path;
    return path === undefined ? undefined : skillBlock(name, path);
  };

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

/** The aliased skills a message names, each once, in order of first reference. */
export function skillReferences(text: string, names: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const [, name = ''] of text.matchAll(REFERENCE)) if (names.has(name) && !found.includes(name)) found.push(name);
  return found;
}

/**
 * Attaches every skill the message names, as Cursor does, and keeps the message. The first skill rides Pi's native
 * `/skill:name args` expansion; a leading `/name` becomes that command, as Pi's own syntax drops it. Each further skill
 * is a block at the head of the arguments. Pi splits the skill name at the first space and trims the arguments.
 * An explicit `/skill:` command is Pi's own and stays as typed, and so does a message that starts with a prompt
 * template, which Pi can expand only while the message still starts with it.
 */
export function aliasTransform(text: string, names: ReadonlySet<string>, blockFor: (name: string) => string | undefined, commands: ReadonlySet<string> = new Set()): string | undefined {
  if (text.startsWith(`/${SKILL_PREFIX}`) || commands.has(/^\/(\S+)/.exec(text)?.[1] ?? '')) return undefined;
  const [first, ...others] = skillReferences(text, names);
  if (first === undefined) return undefined;
  const leading = ALIAS.exec(text);
  const rest = leading?.[1] === first ? text.slice(leading[0].length) : undefined;
  const body = rest === undefined ? text : rest.startsWith(' ') ? rest.slice(1) : rest;
  const args = [...others.flatMap((name) => blockFor(name) ?? []), ...(body === '' ? [] : [body])].join('\n\n');
  return args === '' ? `/skill:${first}` : `/skill:${first} ${args}`;
}

export type AliasInputResult = { action: 'continue' } | { action: 'transform'; text: string; images?: ImageContent[] };

/** The `input` handler result: Pi's native skill command carrying every referenced skill, otherwise continue unchanged. */
export function aliasInputResult(event: { text: string; images?: ImageContent[] }, names: ReadonlySet<string>, blockFor: (name: string) => string | undefined, commands: ReadonlySet<string> = new Set()): AliasInputResult {
  const text = aliasTransform(event.text, names, blockFor, commands);
  if (text === undefined) return { action: 'continue' };
  return { action: 'transform', text, ...(event.images === undefined ? {} : { images: event.images }) };
}
