import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';

import type { ImageContent } from '@earendil-works/pi-ai';
import { type SlashCommandInfo, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { SKILLS_DIR } from './paths.ts';
import { skillBlock } from './skill-block.ts';

const ALIAS = /^\/([a-zA-Z0-9_-]+)(?=\s|$)/;
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

/** A loaded prompt template's body by name, read when a message starts with `/template` and also names a skill. */
export const loadedTemplateBody =
  (commands: readonly SlashCommandInfo[]) =>
  (name: string): string | undefined => {
    const path = commands.find((command) => command.source === 'prompt' && command.name === name)?.sourceInfo.path;
    return path === undefined || !existsSync(path) ? undefined : stripFrontmatter(readFileSync(path, 'utf8'));
  };

function parseTemplateArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = '';
  let hasToken = false;
  let inQuote: string | null = null;
  for (const char of argsString) {
    if (inQuote !== null) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
      hasToken = true;
    } else if (/\s/.test(char)) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += char;
      hasToken = true;
    }
  }
  if (hasToken) args.push(current);
  return args;
}

function substituteTemplateArgs(content: string, args: readonly string[]): string {
  const allArgs = args.join(' ');
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultTarget: string | undefined, defaultValue: string | undefined, sliceStart: string | undefined, sliceLength: string | undefined, simple: string | undefined) => {
      if (defaultTarget !== undefined) {
        const value = defaultTarget === '@' || defaultTarget === 'ARGUMENTS' ? allArgs : args[Number.parseInt(defaultTarget, 10) - 1];
        return value ? value : (defaultValue ?? '');
      }
      if (sliceStart !== undefined) {
        const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1);
        return sliceLength !== undefined ? args.slice(start, start + Number.parseInt(sliceLength, 10)).join(' ') : args.slice(start).join(' ');
      }
      if (simple === 'ARGUMENTS' || simple === '@') return allArgs;
      return args[Number.parseInt(simple ?? '1', 10) - 1] ?? '';
    },
  );
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
 * An explicit `/skill:` command is Pi's own and stays as typed. When a message starts with a prompt template and also
 * references a skill, the template is expanded first so both the template and the referenced skills reach the model.
 */
export function aliasTransform(
  text: string,
  names: ReadonlySet<string>,
  blockFor: (name: string) => string | undefined,
  commands: ReadonlySet<string> = new Set(),
  templateFor: (name: string) => string | undefined = () => undefined,
): string | undefined {
  if (text.startsWith(`/${SKILL_PREFIX}`)) return undefined;
  const commandMatch = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  const commandName = commandMatch?.[1] ?? '';
  let message = text;
  if (commands.has(commandName)) {
    const template = templateFor(commandName);
    if (template === undefined) return undefined;
    message = substituteTemplateArgs(template, parseTemplateArgs(commandMatch?.[2] ?? ''));
  }
  const [first, ...others] = skillReferences(message, names);
  if (first === undefined) return undefined;
  const leading = ALIAS.exec(message);
  const rest = leading?.[1] === first ? message.slice(leading[0].length) : undefined;
  const body = rest === undefined ? message : rest.trim();
  const args = [...others.flatMap((name) => blockFor(name) ?? []), ...(body === '' ? [] : [body])].join('\n\n');
  return args === '' ? `/skill:${first}` : `/skill:${first} ${args}`;
}

export type AliasInputResult = { action: 'continue' } | { action: 'transform'; text: string; images?: ImageContent[] };

/** The `input` handler result: Pi's native skill command carrying every referenced skill, otherwise continue unchanged. */
export function aliasInputResult(
  event: { text: string; images?: ImageContent[] },
  names: ReadonlySet<string>,
  blockFor: (name: string) => string | undefined,
  commands: ReadonlySet<string> = new Set(),
  templateFor: (name: string) => string | undefined = () => undefined,
): AliasInputResult {
  const text = aliasTransform(event.text, names, blockFor, commands, templateFor);
  if (text === undefined) return { action: 'continue' };
  return { action: 'transform', text, ...(event.images === undefined ? {} : { images: event.images }) };
}
