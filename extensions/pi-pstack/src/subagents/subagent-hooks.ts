import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { runShellCommand } from './shell-command.ts';

export const hookOutputLimit = 10_000;
export const hookEventChannel = 'copilot:hook-event';
const defaultTimeoutMs = 30_000;

const HookEntry = Type.Union([Type.String({ minLength: 1 }), Type.Object({ command: Type.String({ minLength: 1 }), timeoutSec: Type.Optional(Type.Number({ exclusiveMinimum: 0 })) })]);
const HookList = Type.Array(HookEntry);
export type HookSpec = Readonly<{ command: string; timeoutMs: number }>;
export type SubagentHooks = Readonly<{ start: readonly HookSpec[]; stop: readonly HookSpec[] }>;
export type HookInput = Readonly<{ agentId: string; agentType: string; sessionId: string; cwd: string; timestamp: string; transcriptPath?: string }>;
export type HookReport = Readonly<{ context: string; failures: readonly string[] }>;
export type HookRunner = (command: string, input: string, cwd: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;

function specs(raw: unknown): readonly HookSpec[] {
  if (!Check(HookList, raw)) return [];
  return raw.map((entry: Static<typeof HookEntry>) => (typeof entry === 'string' ? { command: entry, timeoutMs: defaultTimeoutMs } : { command: entry.command, timeoutMs: (entry.timeoutSec ?? defaultTimeoutMs / 1000) * 1000 }));
}

export function parseSubagentHooks(settings: unknown): SubagentHooks {
  const hooks = typeof settings === 'object' && settings !== null && 'hooks' in settings && typeof settings.hooks === 'object' && settings.hooks !== null ? settings.hooks : {};
  return { start: specs('subagentStart' in hooks ? hooks.subagentStart : undefined), stop: specs('subagentStop' in hooks ? hooks.subagentStop : undefined) };
}

const shell: HookRunner = (command, input, cwd, timeoutMs) => runShellCommand(command, { cwd, input, env: process.env, timeoutMs });

function contextOf(stdout: string): string {
  const text = stdout.trim();
  if (!text.startsWith('{')) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'additionalContext' in parsed && typeof parsed.additionalContext === 'string') return parsed.additionalContext.trim();
  } catch {
    return text;
  }
  return '';
}

export function combineContexts(contexts: readonly string[], limit = hookOutputLimit): string {
  const joined = contexts.filter((context) => context.length > 0).join('\n\n');
  return joined.length > limit ? `${joined.slice(0, limit)}\n[hook output truncated at ${limit} characters]` : joined;
}

/** Runs the hooks in parallel with the event as JSON on stdin. A failing hook is reported and never blocks the spawn. */
export async function runHooks(hooks: readonly HookSpec[], input: HookInput, run: HookRunner = shell): Promise<HookReport> {
  const payload = JSON.stringify(input);
  const results = await Promise.all(hooks.map(async (hook) => ({ hook, result: await run(hook.command, payload, input.cwd, hook.timeoutMs) })));
  const failures = results.filter(({ result }) => result.code !== 0).map(({ hook, result }) => `${hook.command} exited ${result.code}: ${result.stderr.trim()}`);
  return { context: combineContexts(results.filter(({ result }) => result.code === 0).map(({ result }) => contextOf(result.stdout))), failures };
}
