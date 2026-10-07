import { isAbsolute, resolve } from 'node:path';

import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { type CompressOutcome, compressFile } from './compress/compress.ts';

const parameters = Type.Object({
  path: Type.String({ minLength: 1, description: 'Natural-language file to compress in place (.md, .txt, .rst, .tex, .typ, extensionless). The original is backed up out of tree.' }),
});

const outputSchema = Type.Union([
  Type.Object({ kind: Type.Literal('compressed'), path: Type.String(), backupPath: Type.String(), originalBytes: Type.Number(), compressedBytes: Type.Number() }),
  Type.Object({ kind: Type.Literal('skipped'), reason: Type.String() }),
]);

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

export function addUsage(total: Usage, next: Usage): Usage {
  return {
    input: total.input + next.input,
    output: total.output + next.output,
    cacheRead: total.cacheRead + next.cacheRead,
    cacheWrite: total.cacheWrite + next.cacheWrite,
    totalTokens: total.totalTokens + next.totalTokens,
    cost: {
      input: total.cost.input + next.cost.input,
      output: total.cost.output + next.cost.output,
      cacheRead: total.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
      total: total.cost.total + next.cost.total,
    },
  };
}

export function messageText(message: AssistantMessage): string {
  if (message.stopReason === 'error' || message.stopReason === 'aborted') throw new Error(message.errorMessage ?? `model call ${message.stopReason}`);
  return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}

function modelCaller(ctx: ExtensionContext): { complete: (prompt: string, signal?: AbortSignal) => Promise<string>; usage: () => Usage } {
  let usage = emptyUsage();
  const complete = async (prompt: string, signal?: AbortSignal): Promise<string> => {
    const model = ctx.model;
    if (!model) throw new Error('caveman_compress: no model selected');
    const stream = ctx.modelRegistry.streamSimple(model, { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, signal ? { signal } : undefined);
    const message = await stream.result();
    usage = addUsage(usage, message.usage);
    return messageText(message);
  };
  return { complete, usage: () => usage };
}

export function outcomeResult(outcome: CompressOutcome, path: string, usage: Usage) {
  switch (outcome.kind) {
    case 'compressed':
      return {
        content: [{ type: 'text' as const, text: `Compressed ${outcome.path}: ${outcome.originalBytes} → ${outcome.compressedBytes} bytes. Backup: ${outcome.backupPath}` }],
        details: undefined,
        structuredContent: { ...outcome },
        usage,
      };
    case 'skipped':
      return { content: [{ type: 'text' as const, text: `Skipped ${path}: ${outcome.reason}` }], details: undefined, structuredContent: { ...outcome }, usage };
    case 'failed':
      throw new Error(`Compression failed, ${path} left untouched:\n${outcome.errors.join('\n')}`);
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function registerCompress(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'caveman_compress',
    label: 'Caveman compress',
    description:
      'Compress a memory file (AGENTS.md, CLAUDE.md, todos, preferences) into caveman prose to cut input tokens. Detects file type, compresses prose with the current model, ' +
      'validates headings, code, URLs, paths, bullets and inline code, retries targeted fixes twice, backs up the original out of tree, and leaves the file untouched on failure.',
    promptSnippet: 'Compress a natural-language memory file in place with validation and backup',
    parameters,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const path = isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path);
      const caller = modelCaller(ctx);
      const outcome = await compressFile({ path, complete: caller.complete, ...(signal ? { signal } : {}) });
      return outcomeResult(outcome, path, caller.usage());
    },
  });
}
