// Slash parity (spec 8.2). generated/prompts gives every skill its original `/name`. A name another command owns gets
// `/pstack:<name>`, which the input event rewrites to Pi's own `/skill:<name>`.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI, InputEvent, InputEventResult, SlashCommandInfo } from '@earendil-works/pi-coding-agent';
import { PACKAGE_ROOT } from './paths.ts';

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

const loadedSkillNames = (commands: readonly SlashCommandInfo[]) => new Set(commands.filter((command) => command.source === 'skill').map((command) => command.name.replace(/^skill:/, '')));

export function registerSkillRouting(pi: ExtensionAPI, names: readonly string[] = generatedSkillNames()): { conflicts: () => SlashConflict[] } {
  const conflicts = () => slashConflicts(pi.getCommands(), names);
  pi.on('input', (event) => {
    if (!event.text.startsWith(`/${ALIAS_PREFIX}`)) return { action: 'continue' };
    return aliasInput(event, new Set(conflicts().map((conflict) => conflict.name)), loadedSkillNames(pi.getCommands()));
  });
  return { conflicts };
}
