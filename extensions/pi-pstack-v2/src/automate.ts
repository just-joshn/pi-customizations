import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { createJobSpec, launch, list, readJson } from './jobs.ts';
import { validateOutputNotificationConfig } from './output-notify.ts';
import { type JobWatch, jobsRoot, stopRuns } from './watcher.ts';

const AUTOMATE_COMMAND = 'automate';
const AUTOMATIONS_DIR = join('.pi', 'automations');
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBCOMMANDS = ['list', 'status', 'create', 'run', 'stop'] as const;
const JSON_INDENT = 2;
const BENNY_SKILL_PATHS: Readonly<Record<string, string>> = {
  'benny-triage': '.pi/automations/benny/skills/triage-issue-reports/SKILL.md',
  'benny-reproduce': '.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md',
};

export const AutomationManifestSchema = z.object({
  name: z.string().regex(NAME_PATTERN),
  description: z.string().min(1),
  enabled: z.boolean(),
  skillPath: z.string().min(1),
  triggerCommand: z.string().min(1),
  pattern: z.string().min(1),
  reason: z.string().min(1),
  draftPrOnly: z.boolean().optional(),
});

export type AutomationManifest = z.infer<typeof AutomationManifestSchema>;

const manifestPath = (cwd: string, name: string): string => join(cwd, AUTOMATIONS_DIR, `${name}.json`);
const notify = (ctx: ExtensionContext, message: string, level: 'info' | 'error' = 'info'): void => {
  if (ctx.hasUI) ctx.ui.notify(message, level);
};

function patternErrors(pattern: string, reason: string): readonly string[] {
  try {
    validateOutputNotificationConfig({ pattern, reason, notificationLimit: null });
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'invalid output notification pattern'];
  }
}

/** Validates an automation manifest on disk, failing closed on missing fields, disabled state, invalid regex, or missing skillPath. */
export function validateAutomation(cwd: string, name: string): { readonly ok: boolean; readonly manifest?: AutomationManifest; readonly errors: readonly string[] } {
  if (!NAME_PATTERN.test(name)) return { ok: false, errors: [`invalid automation name "${name}" (use lowercase kebab-case)`] };
  const file = manifestPath(cwd, name);
  if (!existsSync(file)) return { ok: false, errors: [`automation manifest not found: ${file}`] };
  const manifest = readJson(file, AutomationManifestSchema);
  if (!manifest) return { ok: false, errors: [`invalid or unreadable automation manifest: ${file}`] };
  const skillFile = resolve(cwd, manifest.skillPath);
  const errors = [
    ...(manifest.name === name ? [] : [`manifest name "${manifest.name}" does not match "${name}"`]),
    ...(existsSync(skillFile) ? [] : [`skillPath does not exist: ${manifest.skillPath}`]),
    ...(manifest.enabled ? [] : ['automation is disabled (set "enabled": true after review to run)']),
    ...patternErrors(manifest.pattern, manifest.reason),
  ];
  return { ok: errors.length === 0, manifest, errors };
}

function listManifestNames(cwd: string): readonly string[] {
  const dir = join(cwd, AUTOMATIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length))
    .toSorted();
}

function createDraftManifest(cwd: string, name: string, explicitSkillPath?: string): { readonly ok: boolean; readonly message: string } {
  if (!NAME_PATTERN.test(name)) return { ok: false, message: `Invalid automation name "${name}". Use lowercase kebab-case.` };
  const file = manifestPath(cwd, name);
  if (existsSync(file)) return { ok: false, message: `Automation "${name}" already exists at ${file}. Review it with /automate status ${name}.` };
  mkdirSync(join(cwd, AUTOMATIONS_DIR), { recursive: true });
  const draft: AutomationManifest = {
    name,
    description: `Local Pi automation for ${name}`,
    enabled: false,
    skillPath: explicitSkillPath || BENNY_SKILL_PATHS[name] || `.pi/automations/${name}/SKILL.md`,
    triggerCommand: 'echo "replace with watcher command"',
    pattern: '^TRIGGER:',
    reason: `Run ${name} automation workflow`,
    draftPrOnly: true,
  };
  writeFileSync(file, `${JSON.stringify(draft, null, JSON_INDENT)}\n`);
  return { ok: true, message: `Drafted disabled automation at ${file}. Review config, set "enabled": true after approval, then run /automate run ${name}.` };
}

function runAutomation(cwd: string, name: string, ctx: ExtensionContext): { readonly ok: boolean; readonly message: string } {
  const check = validateAutomation(cwd, name);
  if (!check.ok || !check.manifest) return { ok: false, message: `Fail-closed: cannot run "${name}":\n- ${check.errors.join('\n- ')}` };
  const m = check.manifest;
  const owner = ctx.sessionManager.getSessionId();
  const jobName = `automate-${m.name}`;
  const existing = list(jobsRoot(), owner).find((job) => job.spec.name === jobName && job.status.state === 'running');
  if (existing) return { ok: true, message: `Automation "${m.name}" is already running as watcher job ${existing.spec.id}.` };
  const prClause = m.draftPrOnly ? '; DRAFT PR only, never merge or deploy' : '';
  const spec = createJobSpec({
    name: jobName,
    shellCommand: m.triggerCommand,
    cwd,
    owner,
    notifyOnOutput: { pattern: m.pattern, reason: `${m.reason} (read ${m.skillPath}${prClause})`, notificationLimit: null },
  });
  const job = launch(jobsRoot(), spec);
  return { ok: true, message: `Started automation "${m.name}" as watcher job ${job.spec.id}.` };
}

async function stopAutomation(name: string, watch: JobWatch, ctx: ExtensionContext): Promise<string> {
  const owner = ctx.sessionManager.getSessionId();
  const targetName = `automate-${name}`;
  const jobs = list(jobsRoot(), owner).filter((job) => job.spec.name === targetName && job.status.state === 'running');
  if (jobs.length === 0) return `No running automation named "${name}".`;
  await stopRuns(watch, owner, jobs);
  return `Stopped ${jobs.length} running job(s) for automation "${name}".`;
}

const automateCompletions = (prefix: string) => {
  const items = SUBCOMMANDS.filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name }));
  return items.length ? items : null;
};

async function handleAutomateAction(action: string, name: string, extra: string | undefined, watch: JobWatch, ctx: ExtensionContext): Promise<void> {
  switch (action) {
    case 'create': {
      const res = createDraftManifest(ctx.cwd, name, extra);
      notify(ctx, res.message, res.ok ? 'info' : 'error');
      return;
    }
    case 'status': {
      const res = validateAutomation(ctx.cwd, name);
      notify(ctx, res.ok ? `Automation "${name}" is valid and enabled.` : `Automation "${name}" checklist:\n- ${res.errors.join('\n- ')}`, res.ok ? 'info' : 'error');
      return;
    }
    case 'run': {
      const res = runAutomation(ctx.cwd, name, ctx);
      notify(ctx, res.message, res.ok ? 'info' : 'error');
      return;
    }
    case 'stop':
      notify(ctx, await stopAutomation(name, watch, ctx));
      return;
    default:
      notify(ctx, `Unknown /automate action "${action}". Use list, status, create, run, or stop.`, 'error');
  }
}

/** Registers /automate for local, fail-closed, approval-gated Pi automations. */
export function registerAutomate(pi: ExtensionAPI, watch: JobWatch): void {
  pi.registerCommand(AUTOMATE_COMMAND, {
    description: 'Manage local fail-closed automations (/automate list|status|create|run|stop <name>).',
    getArgumentCompletions: automateCompletions,
    handler: async (args, ctx) => {
      const [action = 'list', name = '', extra] = z.string().parse(args).trim().split(/\s+/).filter(Boolean);
      if (action === 'list') {
        const names = listManifestNames(ctx.cwd);
        notify(ctx, names.length ? `Automations:\n${names.map((n) => `- ${n}`).join('\n')}` : 'No automations configured under .pi/automations/.');
        return;
      }
      if (!name) {
        notify(ctx, `Usage: /automate ${action} <name>.`, 'error');
        return;
      }
      await handleAutomateAction(action, name, extra, watch, ctx);
    },
  });
}
