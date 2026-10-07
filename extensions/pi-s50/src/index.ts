import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { defaultContext, runCli } from './cli/commands.ts';

const MAX_OUTPUT = 16000;
const SKILL_AWARE = new Set(['feature', 'bug', 'frontend']);

type Host = Pick<ExtensionAPI, 'registerCommand' | 'registerTool' | 'getCommands'>;

// Splits slash-command text like a shell so `apply '{"kind":"advance"}'` stays one argument.
export function splitArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of text) {
    if (quote !== null) {
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

function withInstalled(pi: Host, argv: readonly string[]): readonly string[] {
  if (!SKILL_AWARE.has(argv[0] ?? '') || argv.includes('--installed')) return argv;
  const installed = pi
    .getCommands()
    .filter((command) => command.source === 'skill')
    .map((command) => command.name.replace(/^skill:/, ''));
  return [...argv, '--installed', installed.join(',')];
}

function bounded(stdout: string): string {
  if (stdout.length <= MAX_OUTPUT) return stdout;
  return `${stdout.slice(0, MAX_OUTPUT)}\n[truncated at ${MAX_OUTPUT} chars; run \`s50 explain\` for the decision log]\n`;
}

const NOTIFY_LEVEL = { 0: 'info', 1: 'error', 2: 'warning' } as const;

export default function s50(pi: Host) {
  pi.registerCommand('s50', {
    description: 's50 feature|bug|frontend <text> | status | verify | resume | explain | apply <json> | registry refresh|show|verify',
    handler: async (args, ctx) => {
      const result = await runCli(withInstalled(pi, splitArgs(args)), defaultContext(ctx.cwd));
      ctx.ui.notify(bounded(result.stdout), NOTIFY_LEVEL[result.code]);
    },
  });

  pi.registerTool({
    name: 's50',
    label: 'S50',
    description:
      'Run the S50 coordinator with CLI argv, e.g. ["status"], ["resume"], ["apply", "<command json>"], ["feature", "<objective>"]. ' +
      'This tool is the only writer of .s50/ state; never edit .s50/ by hand. ' +
      'Exit code 2 means rejected or blocked on a gate. User-only skills are never invoked by the model: when blocked on a user_workflow gate, tell the user the /skill:<name> to run and stop.',
    promptSnippet: 'Drive S50 engineering runs; sole writer of .s50/ state',
    parameters: Type.Object({ argv: Type.Array(Type.String(), { minItems: 1 }) }),
    // registry refresh fetches skills.sh, so the tool reaches the open web.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const result = await runCli(withInstalled(pi, params.argv), defaultContext(ctx.cwd));
      if (result.code === 1) throw new Error(result.stdout);
      return { content: [{ type: 'text', text: bounded(result.stdout) }], details: { code: result.code } };
    },
  });
}
