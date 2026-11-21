import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionAPI, type ExtensionContext, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

// A mode keeps a skill in context every turn. Pi rebuilds the system prompt each turn, so the skill rides there.
export const MODE = 'pstack-mode';
export const SKILLS_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'skills');
const skillNames = readdirSync(SKILLS_DIR).filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')));

/** The system prompt section that keeps the skill in force. */
export const modeSection = (name: string): string => {
  const file = join(SKILLS_DIR, name, 'SKILL.md');
  return `The user turned on ${name} mode with /pstack-mode. Follow this skill on every turn until the user turns it off with /pstack-mode off or switches modes. Do not drift back to default agent behavior.\n\n<skill name="${name}" location="${file}">\nReferences are relative to ${dirname(file)}.\n\n${stripFrontmatter(readFileSync(file, 'utf8')).trim()}\n</skill>`;
};

const modeData = z.object({ skill: z.string().optional() });
const recordedSkill = (data: unknown): string | undefined => modeData.safeParse(data).data?.skill;

// The mode lives on the session branch, so a resumed session or a /tree jump gets the mode that branch had.
const branchMode = (ctx: ExtensionContext): string | undefined => {
  const recorded = ctx.sessionManager.getBranch().reduce<string | undefined>((current, entry) => (entry.type === 'custom' && entry.customType === MODE ? recordedSkill(entry.data) : current), undefined);
  return recorded && skillNames.includes(recorded) ? recorded : undefined;
};

const showMode = (mode: string | undefined, ctx: ExtensionContext): void => {
  if (ctx.hasUI) ctx.ui.setStatus(MODE, mode ? `mode: ${mode}` : undefined);
};

const completions = (prefix: string) => {
  const items = ['off', ...skillNames].filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name }));
  return items.length ? items : null;
};

/** Registers /pstack-mode and restores the branch's mode, and returns a reader of the mode now on. */
export function registerMode(pi: ExtensionAPI): () => string | undefined {
  let mode: string | undefined;
  const restore = (ctx: ExtensionContext): void => {
    mode = branchMode(ctx);
    showMode(mode, ctx);
  };

  pi.on('session_start', async (_event, ctx) => restore(ctx));
  pi.on('session_tree', async (_event, ctx) => restore(ctx));
  pi.registerCommand(MODE, {
    description: 'Keep a pstack skill in context every turn. /pstack-mode off ends it.',
    getArgumentCompletions: completions,
    handler: async (args, ctx) => {
      const name = z.string().parse(args).trim();
      if (!name) {
        if (ctx.hasUI) ctx.ui.notify(mode ? `${mode} mode is on. /pstack-mode off ends it.` : 'No pstack mode is on. /pstack-mode <skill> starts one.', 'info');
        return;
      }
      if (name !== 'off' && !skillNames.includes(name)) {
        if (ctx.hasUI) ctx.ui.notify(`${name} is not a pstack skill. Pick one from /pstack-mode's completions.`, 'error');
        return;
      }
      mode = name === 'off' ? undefined : name;
      pi.appendEntry(MODE, { skill: mode });
      showMode(mode, ctx);
    },
  });
  return () => mode;
}
