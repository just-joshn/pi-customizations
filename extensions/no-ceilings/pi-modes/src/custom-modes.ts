import { basename, dirname } from 'node:path';

import { formatSkillBlock, readSkillDocument, type SkillDocument } from './skill-frontmatter.ts';
import { type ActiveCustomMode, CUSTOM_MODE_ENTERED_CUSTOM_TYPE, CUSTOM_MODE_REMINDER_CUSTOM_TYPE, type CustomModeSkill, type PendingExitedCustomMode, SKILL_REFERENCE_CUSTOM_TYPE, ZERO } from './types.ts';

const SKILL_COMMAND_PREFIX = 'skill:';
const SKILL_COMMAND_SOURCE = 'skill';
const SKILL_PATH_PATTERN = /(?:^|[/\\])SKILL\.md$/;
const SKILLS_DIR_NAME = 'skills';
const MARKDOWN_EXT = '.md';
const UNHYDRATED_PREFIX = 'unhydrated:';
const CUSTOM_MODE_ID_PREFIX = 'custom-mode:';
const REFERENCE_PATTERN = /(?:^|\s)\/[a-zA-Z0-9_-]/;
const REFERENCE_TOKEN_PATTERN = /(?:^|\s)\/([a-zA-Z0-9_-]+)(?![a-zA-Z0-9_-]|\.[a-zA-Z0-9])/g;

export interface SlashCommandLike {
  readonly name: string;
  readonly description?: string;
  readonly source: string;
  readonly sourceInfo: { readonly path: string };
}

export interface CustomModeInstructionInput {
  readonly active: ActiveCustomMode | undefined;
  readonly pendingExited: PendingExitedCustomMode | undefined;
}

export interface CustomModeContextMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}

function trimToUndefined(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > ZERO ? trimmed : undefined;
}

export function toCustomModeId(commandName: string): string {
  return commandName.startsWith(SKILL_COMMAND_PREFIX) ? commandName.slice(SKILL_COMMAND_PREFIX.length) : commandName;
}

export function resolveSkillFileReference(filePath: string): string | undefined {
  const trimmed = trimToUndefined(filePath);
  if (trimmed === undefined || trimmed.startsWith(UNHYDRATED_PREFIX) || trimmed.startsWith(CUSTOM_MODE_ID_PREFIX)) {
    return undefined;
  }
  if (SKILL_PATH_PATTERN.test(trimmed) || isDirectSkillsMarkdown(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function isDirectSkillsMarkdown(filePath: string): boolean {
  return basename(dirname(filePath)) === SKILLS_DIR_NAME && basename(filePath).endsWith(MARKDOWN_EXT);
}

export function buildEnteredInstruction(mode: Pick<CustomModeSkill, 'label' | 'filePath'>): string {
  const reference = resolveSkillFileReference(mode.filePath);
  const follow = reference === undefined ? 'Follow the attached skill' : `Follow the skill instructions in ${JSON.stringify(reference)}`;
  return `The user has entered ${mode.label} custom mode. ${follow} until the user exits or switches modes. Do not drift back to default agent behavior.`;
}

export function buildActiveInstruction(mode: Pick<CustomModeSkill, 'label' | 'filePath'>): string {
  const reference = resolveSkillFileReference(mode.filePath);
  const skill = reference === undefined ? 'the skill' : JSON.stringify(reference);
  return `Reminder: you are still in ${mode.label} mode. Follow that mode's skill on this turn. Do not drop it because the request looks small or you already have context. Do not drift back to default agent behavior. If you cannot state the mode's hard rules, read ${skill} before acting.`;
}

export function buildExitInstruction(exited: Pick<PendingExitedCustomMode, 'label'>): string {
  return `The user has exited ${exited.label} custom mode. Stop following that mode's skill. Continue without those constraints.`;
}

export function buildCustomModeInstructions(input: CustomModeInstructionInput): string | undefined {
  const parts = [
    input.pendingExited && input.pendingExited.id !== input.active?.id ? buildExitInstruction(input.pendingExited) : undefined,
    input.active ? (input.active.lifecycle === 'entered' ? buildEnteredInstruction(input.active) : buildActiveInstruction(input.active)) : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length === ZERO ? undefined : parts.join('\n\n');
}

/**
 * Building for the entered turn also attaches the mode's skill, which is the persistent-invocation
 * half of a custom mode; later turns only carry the reminder.
 */
export function buildCustomModeMessage(input: CustomModeInstructionInput): CustomModeContextMessage | undefined {
  const instructions = buildCustomModeInstructions(input);
  if (instructions === undefined) {
    return undefined;
  }
  if (input.active === undefined || input.active.lifecycle !== 'entered') {
    return { customType: CUSTOM_MODE_REMINDER_CUSTOM_TYPE, content: instructions, display: false };
  }
  return {
    customType: CUSTOM_MODE_ENTERED_CUSTOM_TYPE,
    content: `${instructions}\n\n${formatSkillBlock(toSkillBlockInput(input.active))}`,
    display: true,
  };
}

function toSkillBlockInput(skill: CustomModeSkill): Pick<SkillDocument, 'name' | 'filePath' | 'baseDir' | 'body'> {
  return { name: skill.name ?? skill.id, filePath: skill.filePath, baseDir: dirname(skill.filePath), body: skill.body };
}

function isSkillCommand(command: SlashCommandLike): boolean {
  return command.source === SKILL_COMMAND_SOURCE && typeof command.sourceInfo?.path === 'string';
}

async function toCustomModeSkill(command: SlashCommandLike): Promise<CustomModeSkill> {
  const id = toCustomModeId(command.name);
  const document = await readSkillDocument(command.sourceInfo.path, id);
  return {
    id,
    name: document.name,
    label: document.label,
    filePath: command.sourceInfo.path,
    description: trimToUndefined(command.description) ?? document.label,
    icon: document.icon,
    colorId: document.colorId,
    body: document.body,
  };
}

export async function listCustomModes(commands: readonly SlashCommandLike[]): Promise<readonly CustomModeSkill[]> {
  const results = await Promise.allSettled(commands.filter(isSkillCommand).map(toCustomModeSkill));
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

function matchesName(skill: CustomModeSkill, needle: string): boolean {
  const normalized = needle.trim().toLowerCase();
  return skill.id.toLowerCase() === normalized || skill.label.toLowerCase() === normalized;
}

export function findCustomMode(modes: readonly CustomModeSkill[], name: string): CustomModeSkill | undefined {
  const needle = trimToUndefined(name);
  return needle === undefined ? undefined : modes.find((mode) => matchesName(mode, needle));
}

function collectReferenceTokens(prompt: string): readonly string[] {
  if (!REFERENCE_PATTERN.test(prompt)) {
    return [];
  }
  return [...prompt.matchAll(REFERENCE_TOKEN_PATTERN)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

export function referencesSkill(prompt: string): boolean {
  return REFERENCE_PATTERN.test(prompt);
}

export function findReferencedCustomModes(prompt: string, modes: readonly CustomModeSkill[]): readonly CustomModeSkill[] {
  const seen = new Set<string>();
  return collectReferenceTokens(prompt).flatMap((token) => {
    const mode = modes.find((candidate) => matchesName(candidate, token));
    if (mode === undefined || seen.has(mode.filePath)) {
      return [];
    }
    seen.add(mode.filePath);
    return [mode];
  });
}

/**
 * One-message skill invocation: the referenced skills ride along with this turn only. A skill that
 * the active custom mode already attached is skipped, so its body appears once in the request.
 */
export function buildSkillReferenceMessage(prompt: string, modes: readonly CustomModeSkill[], excludedFilePaths: readonly string[] = []): CustomModeContextMessage | undefined {
  const referenced = findReferencedCustomModes(prompt, modes).filter((mode) => !excludedFilePaths.includes(mode.filePath));
  if (referenced.length === ZERO) {
    return undefined;
  }
  return {
    customType: SKILL_REFERENCE_CUSTOM_TYPE,
    content: referenced.map((mode) => formatSkillBlock(toSkillBlockInput(mode))).join('\n\n'),
    display: true,
  };
}
