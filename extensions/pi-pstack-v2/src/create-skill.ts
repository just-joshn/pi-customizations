import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { type ExtensionAPI, type ExtensionCommandContext, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { SKILLS_DIR } from './mode.ts';

const CREATE_SKILL_COMMAND = 'create-skill';
const VALIDATE_SUBCOMMAND = 'validate';
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FENCED_CODE_PATTERN = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EXTERNAL_TARGET_PATTERN = /^(?:https?:|mailto:|#|<)/;

export type SkillValidationResult = {
  readonly ok: boolean;
  readonly errors: readonly string[];
};

function stripCode(markdown: string): string {
  return markdown.replace(FENCED_CODE_PATTERN, '').replace(INLINE_CODE_PATTERN, '');
}

function brokenRelativeLinks(filePath: string, body: string): readonly string[] {
  const dir = dirname(filePath);
  return [...stripCode(body).matchAll(MARKDOWN_LINK_PATTERN)]
    .map((match) => (match[1] ?? '').split('#')[0] ?? '')
    .filter((target) => target.length > 0 && !EXTERNAL_TARGET_PATTERN.test(target) && !existsSync(resolve(dir, target)))
    .map((target) => `broken relative link: ${target}`);
}

/** Validates a SKILL.md file against Pi's Agent Skills frontmatter and local-link rules. */
export function validateSkillFile(skillFilePath: string): SkillValidationResult {
  const absPath = resolve(skillFilePath);
  if (!existsSync(absPath) || !statSync(absPath).isFile()) return { ok: false, errors: [`file not found: ${absPath}`] };
  const content = readFileSync(absPath, 'utf8');
  if (!/^---\r?\n/.test(content)) return { ok: false, errors: ['missing YAML frontmatter (--- ... ---)'] };

  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  const folder = basename(dirname(absPath));
  const name = typeof frontmatter['name'] === 'string' ? frontmatter['name'].trim() : '';
  const description = typeof frontmatter['description'] === 'string' ? frontmatter['description'].trim() : '';
  const errors = [
    ...(name ? [] : ['frontmatter is missing required field: name']),
    ...(name && !SKILL_NAME_PATTERN.test(name) ? [`name "${name}" must be lowercase kebab-case`] : []),
    ...(name && name !== folder ? [`name "${name}" does not match directory "${folder}"`] : []),
    ...(description ? [] : ['frontmatter is missing required field: description']),
    ...brokenRelativeLinks(absPath, body),
  ];
  return { ok: errors.length === 0, errors };
}

const createSkillCompletions = (prefix: string) => {
  const items = [VALIDATE_SUBCOMMAND].filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name }));
  return items.length ? items : null;
};

function handleValidate(target: string, ctx: ExtensionCommandContext): void {
  if (!target) {
    if (ctx.hasUI) ctx.ui.notify('Usage: /create-skill validate <path/to/SKILL.md>.', 'error');
    return;
  }
  const resolved = resolve(ctx.cwd, target);
  const filePath = resolved.endsWith('SKILL.md') ? resolved : join(resolved, 'SKILL.md');
  const result = validateSkillFile(filePath);
  if (ctx.hasUI) ctx.ui.notify(result.ok ? `Valid skill: ${filePath}` : `Invalid skill (${filePath}):\n- ${result.errors.join('\n- ')}`, result.ok ? 'info' : 'error');
}

/** Registers /create-skill to author or validate Pi Agent Skills. */
export function registerCreateSkill(pi: ExtensionAPI): void {
  const skillPath = join(SKILLS_DIR, CREATE_SKILL_COMMAND, 'SKILL.md');
  pi.registerCommand(CREATE_SKILL_COMMAND, {
    description: 'Author or validate a Pi Agent Skill (/create-skill <goal> | /create-skill validate <path>).',
    getArgumentCompletions: createSkillCompletions,
    handler: async (args, ctx) => {
      const trimmed = z.string().parse(args).trim();
      if (!trimmed) {
        if (ctx.hasUI) ctx.ui.notify('Usage: /create-skill <skill name or workflow> or /create-skill validate <path/to/SKILL.md>.', 'info');
        return;
      }
      if (trimmed === VALIDATE_SUBCOMMAND || trimmed.startsWith(`${VALIDATE_SUBCOMMAND} `)) {
        handleValidate(trimmed.slice(VALIDATE_SUBCOMMAND.length).trim(), ctx);
        return;
      }
      pi.sendUserMessage(`Read ${skillPath} and follow it to create or update this Pi Agent Skill: ${trimmed}`);
    },
  });
}
