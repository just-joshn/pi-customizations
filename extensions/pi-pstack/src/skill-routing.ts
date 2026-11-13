// Slash parity (spec 8.2). generated/prompts gives every skill its original `/name`. A name another command owns gets
// `/pstack:<name>`, which the input event rewrites to Pi's own `/skill:<name>`. A `/name` later in a message attaches
// its skill as Cursor does (`skillReferences`, `referenceInput`), only inside an active pstack workflow (`workflowActive`),
// and then for every skill Pi loaded.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI, InputEvent, InputEventResult, SlashCommandInfo } from '@earendil-works/pi-coding-agent';
import { PACKAGE_ROOT } from './paths.ts';
import { skillBlock } from './skill-block.ts';
import { styleOn } from './style.ts';

export const GENERATED_SKILLS = join(PACKAGE_ROOT, 'generated', 'skills');
export const GENERATED_PROMPTS = join(PACKAGE_ROOT, 'generated', 'prompts');
export const ALIAS_PREFIX = 'pstack:';

/** Pi's built-in interactive commands (docs/slash-commands.md, Pi 1.5.2). Pi exports no list, and getCommands omits them. */
export const PI_BUILTIN_COMMANDS: readonly string[] = [
  'settings',
  'model',
  'thinking',
  'scoped-models',
  'login',
  'logout',
  'llama',
  'new',
  'resume',
  'name',
  'session',
  'tree',
  'fork',
  'clone',
  'compact',
  'import',
  'copy',
  'export',
  'share',
  'bug',
  'trust',
  'mcp',
  'reload',
  'hotkeys',
  'changelog',
  'quit',
];

export interface SlashConflict {
  name: string;
  /** Who owns `/name` instead of the skill's prompt. */
  owner: string;
}

export function generatedSkillNames(dir = GENERATED_SKILLS): string[] {
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'SKILL.md')))
    .sort();
}

const sameFile = (a: string, b: string) => existsSync(a) && existsSync(b) && realpathSync(a) === realpathSync(b);

/** Skill names whose `/name` runs something other than this package's prompt for that skill. */
export function slashConflicts(commands: readonly SlashCommandInfo[], names: readonly string[], promptsDir = GENERATED_PROMPTS): SlashConflict[] {
  const conflicts: SlashConflict[] = [];
  for (const name of names) {
    if (PI_BUILTIN_COMMANDS.includes(name)) {
      conflicts.push({ name, owner: `Pi's built-in /${name}` });
      continue;
    }
    const extension = commands.find((command) => command.source === 'extension' && command.name === name);
    if (extension !== undefined) {
      conflicts.push({ name, owner: `extension command /${name} (${extension.sourceInfo.path})` });
      continue;
    }
    const prompt = commands.find((command) => command.source === 'prompt' && command.name === name);
    if (prompt !== undefined && !sameFile(prompt.sourceInfo.path, join(promptsDir, `${name}.md`))) conflicts.push({ name, owner: `prompt template /${name} (${prompt.sourceInfo.path})` });
  }
  return conflicts;
}

/** `/pstack:<name> rest` becomes `/skill:<name> rest` for an aliased name whose skill Pi loaded; images ride along. */
export function aliasInput(event: Pick<InputEvent, 'text' | 'images'>, aliased: ReadonlySet<string>, loadedSkills: ReadonlySet<string>): InputEventResult {
  const match = /^\/pstack:([a-z0-9-]+)(?=\s|$)([\s\S]*)$/.exec(event.text);
  const name = match?.[1];
  if (name === undefined || !aliased.has(name) || !loadedSkills.has(name)) return { action: 'continue' };
  return { action: 'transform', text: `/skill:${name}${match?.[2] ?? ''}`, ...(event.images === undefined ? {} : { images: event.images }) };
}

const loadedSkills = (commands: readonly SlashCommandInfo[]) => new Map(commands.filter((command) => command.source === 'skill').map((command) => [command.name.replace(/^skill:/, ''), command.sourceInfo.path]));

// Cursor CLI `findSkillReferences`: a `/name` at the start or after whitespace. A name that continues into `/`, `.ext`,
// or more word characters is a path or another word.
const REFERENCE = /(?:^|\s)\/([a-zA-Z0-9_-]+)(?![\w/-]|\.\w)/g;
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/** The pstack skills a message names, each once, in order of first reference. Code spans and fences name nothing. */
export function skillReferences(text: string, names: ReadonlySet<string>): string[] {
  const prose = text.replace(CODE, (span) => '\0'.repeat(span.length));
  const found: string[] = [];
  for (const [, name = ''] of prose.matchAll(REFERENCE)) if (names.has(name) && !found.includes(name)) found.push(name);
  return found;
}

/**
 * Attaches every pstack skill a message names beyond its start, in Pi's own `/skill:<name> args` form: Pi expands the
 * first command into the skill block it builds for `/skill:`, and every further skill is a block at the head of the
 * arguments (`skillBlock`). The message stays. A leading `/<name>` that is this package's own prompt, and a leading
 * `/skill:<name>`, are the first skill. A message led by any other command is left alone, as is a skill already
 * attached to the message.
 */
export function referenceInput(
  event: Pick<InputEvent, 'text' | 'images'>,
  skills: ReadonlyMap<string, string>,
  names: ReadonlySet<string>,
  conflicts: ReadonlySet<string>,
  commands: readonly SlashCommandInfo[],
): InputEventResult {
  const { text } = event;
  const leading = /^\/(\S+)/.exec(text)?.[1];
  const native = /^\/skill:([^\s]+)(?: |$)/.exec(text)?.[1];
  let first: string | undefined;
  let rest = text;
  if (native !== undefined) {
    if (!skills.has(native)) return { action: 'continue' };
    first = native;
    rest = text.slice(`/skill:${native}`.length);
  } else if (leading !== undefined && names.has(leading) && !conflicts.has(leading)) {
    if (!skills.has(leading)) return { action: 'continue' };
    first = leading;
    rest = text.slice(leading.length + 1);
  } else if (leading !== undefined && (PI_BUILTIN_COMMANDS.includes(leading) || commands.some((command) => command.source !== 'skill' && command.name === leading))) {
    return { action: 'continue' };
  }
  const blocks = new Map<string, string>();
  for (const name of skillReferences(text, new Set(skills.keys()))) {
    const path = skills.get(name);
    const block = path === undefined || name === first || text.includes(`<skill name="${name}" location=`) ? undefined : skillBlock(name, path);
    if (block !== undefined) blocks.set(name, block);
  }
  const [lead, ...others] = first === undefined ? [...blocks.keys()] : [first, ...blocks.keys()];
  if (lead === undefined || (blocks.size === 0 && (first === undefined || native !== undefined))) return { action: 'continue' };
  const args = [...others.flatMap((name) => blocks.get(name) ?? []), ...(first === undefined ? [text] : [rest.trim()])].filter((part) => part !== '').join('\n\n');
  return { action: 'transform', text: args === '' ? `/skill:${lead}` : `/skill:${lead} ${args}`, ...(event.images === undefined ? {} : { images: event.images }) };
}

/**
 * A pstack workflow is active for a message when the persistent style is on, or the message invokes a pstack skill: a
 * leading `/name`, `/skill:name`, or `/pstack:name`, or a pstack skill named mid-message. Outside it Pi runs natively.
 */
export function workflowActive(text: string, styleIsOn: boolean, names: ReadonlySet<string>, conflicts: ReadonlySet<string>): boolean {
  if (styleIsOn) return true;
  const leading = /^\/(?:skill:|pstack:)?([a-z0-9-]+)(?=\s|$)/.exec(text)?.[1];
  if (leading !== undefined && names.has(leading) && (!conflicts.has(leading) || /^\/(?:skill|pstack):/.test(text))) return true;
  return skillReferences(text, names).length > 0;
}

export function registerSkillRouting(pi: ExtensionAPI, names: readonly string[] = generatedSkillNames()): { conflicts: () => SlashConflict[] } {
  const conflicts = () => slashConflicts(pi.getCommands(), names);
  pi.on('input', (event, ctx) => {
    if (event.source === 'extension') return { action: 'continue' };
    const commands = pi.getCommands();
    const owned = new Set(conflicts().map((conflict) => conflict.name));
    const skills = loadedSkills(commands);
    const aliased = event.text.startsWith(`/${ALIAS_PREFIX}`) ? aliasInput(event, owned, new Set(skills.keys())) : { action: 'continue' as const };
    const current = aliased.action === 'transform' ? { text: aliased.text, ...(event.images === undefined ? {} : { images: event.images }) } : event;
    const pstack = new Set(names);
    if (!workflowActive(current.text, styleOn(ctx.sessionManager.getBranch()), pstack, owned)) return aliased;
    const referenced = referenceInput(current, skills, pstack, owned, commands);
    return referenced.action === 'transform' ? referenced : aliased;
  });
  return { conflicts };
}
