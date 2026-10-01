import type { CommandHook } from './hook-table.ts';
import { runShellCommand } from './shell-command.ts';

export type HookRun = Readonly<{ command: string; code: number; stdout: string; stderr: string; json?: Readonly<Record<string, unknown>> }>;
export type HookRunContext = Readonly<{ cwd: string; env?: NodeJS.ProcessEnv; timeoutCapMs?: number }>;

const defaultTimeoutMs = 60_000;

function parseJson(stdout: string): Record<string, unknown> | undefined {
  const text = stdout.trim();
  if (!text.startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function runOne(hook: CommandHook, input: string, { cwd, env = process.env, timeoutCapMs }: HookRunContext): Promise<HookRun> {
  const timeoutMs = Math.min(hook.timeoutMs ?? defaultTimeoutMs, timeoutCapMs ?? Number.POSITIVE_INFINITY);
  const result = await runShellCommand(hook.command, { cwd, input, env: { ...env, CLAUDE_PROJECT_DIR: cwd }, timeoutMs });
  const json = result.code === 0 ? parseJson(result.stdout) : undefined;
  return { command: hook.command, code: result.code, stdout: result.stdout, stderr: result.stderr, ...(json ? { json } : {}) };
}

/** Runs matching hooks in parallel, once per distinct command, with the event payload as JSON on stdin. */
export function runCommandHooks(hooks: readonly CommandHook[], input: Readonly<Record<string, unknown>>, context: HookRunContext): Promise<HookRun[]> {
  const distinct = [...new Map(hooks.map((hook) => [hook.command, hook])).values()];
  const payload = JSON.stringify(input);
  return Promise.all(distinct.map((hook) => runOne(hook, payload, context)));
}
