import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { readSettingsLayers, type SettingsRoots } from './settings-layers.ts';
import { runShellCommand, type ShellResult } from './shell-command.ts';
import { type AgentWorktree, createWorktree, finalizeWorktree, type WorktreeOutcome } from './worktree.ts';

export type HookWorktree = Readonly<{ hookBased: true; path: string }>;
export type AgentCheckout = AgentWorktree | HookWorktree;
export type CheckoutContext = SettingsRoots & Readonly<{ sessionId: string; transcriptPath?: string; trusted: boolean }>;

type CommandHook = Readonly<{ command: string; timeoutMs: number }>;
const defaultHookTimeoutMs = 600_000;
const CommandHookSchema = Type.Object({ type: Type.Literal('command'), command: Type.String(), timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })) });
const notRun = 'WorktreeCreate hook failed: hook is configured but did not run (workspace not trusted or matcher mismatch)';
const noPath = 'WorktreeCreate hook failed: hook succeeded but returned no worktree path (command: echo the path to stdout; http/callback: return hookSpecificOutput.worktreePath)';

function entries(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function commandHooks(settings: Record<string, unknown>, event: string): CommandHook[] {
  const events = settings.hooks !== null && typeof settings.hooks === 'object' ? (settings.hooks as Record<string, unknown>)[event] : undefined;
  return entries(events)
    .flatMap((group) => entries(group !== null && typeof group === 'object' ? (group as { hooks?: unknown }).hooks : undefined))
    .filter((hook) => Check(CommandHookSchema, hook))
    .map((hook) => ({ command: hook.command, timeoutMs: hook.timeout === undefined ? defaultHookTimeoutMs : hook.timeout * 1000 }));
}

function failure(command: string, result: ShellResult): string {
  return `${command}: ${(result.stderr.trim() || result.stdout.trim()) || 'no output'}`;
}

async function hookPath(hooks: readonly CommandHook[], context: CheckoutContext, name: string): Promise<string> {
  const input = JSON.stringify({ session_id: context.sessionId, transcript_path: context.transcriptPath, cwd: context.cwd, hook_event_name: 'WorktreeCreate', name });
  const env = { ...process.env, CLAUDE_PROJECT_DIR: context.cwd };
  const results = await Promise.all(hooks.map(async (hook) => ({ hook, result: await runShellCommand(hook.command, { cwd: context.cwd, input, env, timeoutMs: hook.timeoutMs }) })));
  const emitted = results.find(({ result }) => result.code === 0 && result.stdout.trim())?.result.stdout.trim();
  if (emitted !== undefined) return isAbsolute(emitted) ? emitted : resolve(context.cwd, emitted);
  const failed = results.filter(({ result }) => result.code !== 0);
  if (!failed.length) throw new Error(noPath);
  throw new Error(`WorktreeCreate hook failed: ${failed.map(({ hook, result }) => failure(hook.command, result)).join('; ')}`);
}

async function hookCheckout(hooks: readonly CommandHook[], context: CheckoutContext, agentId: string): Promise<HookWorktree> {
  const path = await hookPath(hooks, context, `agent-${agentId}`);
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(
      `Cannot use the WorktreeCreate hook's worktree: the hook emitted a path with dot segments (${path}). The symlink screen cannot verify a dotted spelling — have the hook emit a normalized (dot-free) absolute path and retry.`,
    );
  }
  return { hookBased: true, path: await realpath(path) };
}

export async function createAgentCheckout(context: CheckoutContext, agentId: string): Promise<AgentCheckout> {
  const layers = await readSettingsLayers(context);
  const hooks = [...layers.user, ...(context.trusted ? layers.project : [])].flatMap((settings) => commandHooks(settings, 'WorktreeCreate'));
  if (hooks.length) return hookCheckout(hooks, context, agentId);
  if (!context.trusted && layers.project.some((settings) => commandHooks(settings, 'WorktreeCreate').length)) throw new Error(notRun);
  return createWorktree(context.cwd, agentId);
}

export function checkoutContext(ctx: ExtensionContext): CheckoutContext {
  const transcriptPath = ctx.sessionManager.getSessionFile();
  return { cwd: ctx.cwd, home: homedir(), agentDir: getAgentDir(), sessionId: ctx.sessionManager.getSessionId(), ...(transcriptPath ? { transcriptPath } : {}), trusted: ctx.isProjectTrusted() };
}

export function keptFields(outcome: Extract<WorktreeOutcome, { kept: true }>): { worktreePath: string; worktreeBranch?: string } {
  return { worktreePath: outcome.path, ...(outcome.branch ? { worktreeBranch: outcome.branch } : {}) };
}

export async function finalizeCheckout(checkout: AgentCheckout, log: (message: string) => void): Promise<WorktreeOutcome> {
  if (!('hookBased' in checkout)) return finalizeWorktree(checkout);
  log(`Hook-based agent worktree kept at: ${checkout.path}`);
  return { kept: true, path: checkout.path };
}
