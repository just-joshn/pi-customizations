import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { type ExtensionAPI, type ExtensionContext, isToolCallEventType, truncateHead, withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { hashInstalled } from './adapters/skills.ts';
import { type CliResult, defaultContext, type Host, runCli, SUBCOMMANDS, USAGE } from './cli/commands.ts';
import { isRecord, parseJson } from './orchestrator/decode.ts';
import { S50_DIR } from './orchestrator/persistence.ts';
import { gatedAction } from './policy/authorization.ts';

type Pi = Pick<ExtensionAPI, 'registerCommand' | 'registerTool' | 'getCommands' | 'getAllTools' | 'sendMessage' | 'on'>;

const SUBAGENT_TOOLS = new Set(['subagent', 'Task']);

// Pi hands a slash command its arguments as one raw string and has no public argv splitter, so `/s50` splits it the way a shell would.
export function splitArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\' && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

function piHost(pi: Pi): Host {
  return {
    installedSkills: () =>
      hashInstalled(
        pi
          .getCommands()
          .filter((command) => command.source === 'skill')
          .map((command) => ({ name: command.name.replace(/^skill:/, ''), path: command.sourceInfo.path })),
      ),
    capabilities: () => ({ independentAgents: pi.getAllTools().some((tool) => SUBAGENT_TOOLS.has(tool.name)) }),
  };
}

// The CLI and /s50 are typed by the human; the tool is called by the model, so commands that record a human decision need a live confirmation.
const HUMAN_ONLY = new Set(['confirm_understanding', 'confirm_seams', 'grant_authorization', 'complete_user_workflow']);

function decidedBy({ decidedBy: who }: Readonly<Record<string, unknown>>): unknown {
  return who;
}

export function humanOnlyKind(argv: readonly string[]): string | null {
  if (argv[0] !== 'apply') return null;
  const parsed = parseJson(argv[1] ?? '');
  if (parsed.kind === 'invalid' || !isRecord(parsed.value)) return null;
  const { kind, decisions } = parsed.value;
  if (typeof kind !== 'string') return null;
  if (HUMAN_ONLY.has(kind)) return kind;
  const userDecision = kind === 'answer_decisions' && Array.isArray(decisions) && decisions.some((decision) => isRecord(decision) && decidedBy(decision) === 'user');
  return userDecision ? kind : null;
}

function bounded(stdout: string): string {
  const cut = truncateHead(stdout);
  return cut.truncated ? `${cut.content}\n[truncated ${cut.outputLines} of ${cut.totalLines} lines; run s50 explain or read .s50/ for the full record]\n` : stdout;
}

function run(pi: Pi, cwd: string, argv: readonly string[], signal: AbortSignal | undefined): Promise<CliResult> {
  return withFileMutationQueue(join(cwd, S50_DIR), () => runCli(argv, defaultContext(cwd, signal, piHost(pi))));
}

async function hasRun(cwd: string): Promise<boolean> {
  return access(join(cwd, S50_DIR, 'run.json')).then(
    () => true,
    () => false,
  );
}

function kindOf({ kind }: Readonly<Record<string, unknown>>): unknown {
  return kind;
}

async function authorizeBash(pi: Pi, command: string, ctx: ExtensionContext): Promise<{ readonly block: true; readonly reason: string } | undefined> {
  const action = gatedAction(command);
  if (action === null || !(await hasRun(ctx.cwd))) return undefined;
  if (!ctx.hasUI) return { block: true, reason: `S50 stops for ${action}: ask the user to authorize this exact command` };
  if (!(await ctx.ui.confirm(`S50: authorize ${action}?`, command))) return { block: true, reason: `user declined ${action}` };
  for (const step of ['request_authorization', 'grant_authorization']) {
    const recorded = await run(pi, ctx.cwd, ['apply', JSON.stringify({ kind: step, action, scope: command })], ctx.signal);
    const outcome = parseJson(recorded.stdout);
    const applied = outcome.kind === 'ok' && isRecord(outcome.value) && kindOf(outcome.value) === 'ok';
    if (!applied) return { block: true, reason: `S50 could not record the ${action} authorization: ${recorded.stdout.trim()}` };
  }
  return undefined;
}

const NOTIFY_LEVEL = { 0: 'info', 1: 'error', 2: 'warning' } as const;

export default function s50(pi: Pi) {
  pi.registerCommand('s50', {
    description: USAGE.split('\n').slice(1, 3).join(' ').trim(),
    getArgumentCompletions: (prefix) => {
      const items = SUBCOMMANDS.filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name }));
      return items.length === 0 ? null : items;
    },
    handler: async (args, ctx) => {
      try {
        const result = await run(pi, ctx.cwd, splitArgs(args), ctx.signal);
        pi.sendMessage({ customType: 's50', content: bounded(result.stdout), display: true, details: { code: result.code } });
        if (result.code !== 0) ctx.ui.notify(`s50 exited ${result.code}`, NOTIFY_LEVEL[result.code]);
      } catch (error) {
        ctx.ui.notify(`s50: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    },
  });

  pi.registerTool({
    name: 's50',
    label: 'S50',
    description: 'Run the S50 coordinator with CLI argv, for example ["status"], ["resume"], ["apply", "<command json>"], or ["feature", "<objective>"]. Exit code 2 means the run is blocked or the command was refused.',
    promptSnippet: 'Drive S50 engineering runs; the only writer of .s50/ state',
    promptGuidelines: [
      'Change S50 state only through the s50 tool; never edit files under .s50/.',
      'When the run is blocked on a user_workflow gate, tell the user the exact /skill:<name> to run and stop; never imitate a user-only skill.',
      'Stop at authorization gates; force-push, merge, deploy, destructive deletion, publishing, and public or customer messages need the user.',
    ],
    parameters: Type.Object({ argv: Type.Array(Type.String(), { minItems: 1 }) }),
    executionMode: 'sequential',
    // The tool writes .s50/, runs git, creates worktrees, and registry refresh fetches skills.sh and GitHub.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const human = humanOnlyKind(params.argv);
      if (human !== null) {
        if (!ctx.hasUI) throw new Error(`${human} records a user decision; ask the user to run /s50 ${params.argv.join(' ')}`);
        if (!(await ctx.ui.confirm(`S50: ${human}`, params.argv[1] ?? ''))) throw new Error(`user declined ${human}`);
      }
      const result = await run(pi, ctx.cwd, params.argv, signal);
      if (result.code === 1) throw new Error(bounded(result.stdout));
      return { content: [{ type: 'text', text: bounded(result.stdout) }], details: { code: result.code }, ...(result.code === 2 ? { isError: true } : {}) };
    },
  });

  pi.on('tool_call', async (event, ctx) => (isToolCallEventType('bash', event) ? authorizeBash(pi, event.input.command, ctx) : undefined));
}
