import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ProseMode } from './modes.ts';

export const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url));

const SWITCH_LINE = 'Switch: /caveman, /ultracave, /megacave. Off: "stop caveman" or "normal mode".';

const FALLBACK_THESIS: Readonly<Record<ProseMode, string>> = {
  caveman: 'Respond terse like smart caveman. All technical substance stay. Only fluff die.',
  ultracave: 'Respond terse like smart caveman. All technical substance stay. Only fluff die. Then cut again.',
  // biome-ignore lint/security/noSecrets: Classical Chinese thesis line, not a credential
  megacave: '以文言答。技術之實皆存，唯贅言去之。',
};

export function loadRuleset(mode: ProseMode, skillsDir: string = SKILLS_DIR): string | null {
  try {
    return readFileSync(`${skillsDir}/${mode}/SKILL.md`, 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  } catch {
    // A missing skills directory degrades to the built-in thesis, as upstream's fallback ruleset does.
    return null;
  }
}

export function thesisLine(mode: ProseMode, skillsDir: string = SKILLS_DIR): string {
  const lines = (loadRuleset(mode, skillsDir) ?? '').split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === `# ${mode}`);
  const line = heading === -1 ? undefined : lines.slice(heading + 1).find((candidate) => candidate.trim());
  return line ? line.trim() : FALLBACK_THESIS[mode];
}

export function rulesetBanner(mode: string): string {
  return `CAVEMAN MODE ACTIVE — mode: ${mode}`;
}

export function rulesetSection(mode: ProseMode, skillsDir: string = SKILLS_DIR): string {
  const body = loadRuleset(mode, skillsDir);
  return `${rulesetBanner(mode)}\n\n${body ? body.trimEnd() : FALLBACK_THESIS[mode]}\n\n${SWITCH_LINE}`;
}

export function reinforcement(mode: ProseMode, skillsDir: string = SKILLS_DIR): string {
  return (
    `CAVEMAN MODE ACTIVE (${mode}). ${thesisLine(mode, skillsDir)}` +
    ' Answer only what was asked: no unrequested background, lists, examples,' +
    ' walkthroughs, or follow-up offers; give code, steps, or warnings when the' +
    ' task needs them. Security warnings, irreversible actions, multi-step order:' +
    ' normal prose. Technical terms, code, commands, paths, and errors stay exact.'
  );
}
