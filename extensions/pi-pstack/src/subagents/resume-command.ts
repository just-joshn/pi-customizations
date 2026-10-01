import { randomUUID } from 'node:crypto';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { WorkerRuntime } from '../worker-runtime.ts';
import type { ContinueOutcome, ContinueRequest } from './agent-continue.ts';

type Continue = (request: ContinueRequest, ctx: ExtensionContext) => Promise<ContinueOutcome>;

export function parseResumeArgs(args: string): { reference: string; message: string | undefined } | undefined {
  const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match?.[1]) return undefined;
  const message = match[2]?.trim();
  return { reference: match[1], message: message ? message : undefined };
}

export function registerResumeCommand(pi: ExtensionAPI, runtime: WorkerRuntime, resume: Continue): void {
  pi.registerCommand('resume-agent', {
    description: 'Resume a stopped or finished agent as a user-initiated request: /resume-agent <agent> [message]. Without a message, continues an interrupted turn.',
    handler: async (args, ctx) => {
      const parsed = parseResumeArgs(args);
      const record = parsed && runtime.find(parsed.reference);
      if (!parsed || !record) {
        ctx.ui.notify(parsed ? `No agent found with ID or name: ${parsed.reference}` : 'Usage: /resume-agent <agent> [message]', 'error');
        return;
      }
      try {
        const outcome = await resume({ callId: `resume-agent-${randomUUID()}`, record, message: parsed.message, userInitiated: true, signal: undefined }, ctx);
        ctx.ui.notify(outcome.message, 'info');
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
    },
  });
}
