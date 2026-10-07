import { isAbsolute, resolve } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { compressFile } from './compress/compress.ts';

const parameters = Type.Object({
  path: Type.String({ description: 'Natural-language file to compress in place (.md, .txt, .rst, .tex, .typ, extensionless). The original is backed up out of tree.' }),
});

function completer(ctx: ExtensionContext) {
  return async (prompt: string, signal?: AbortSignal): Promise<string> => {
    const model = ctx.model;
    if (!model) throw new Error('caveman_compress: no model selected');
    const stream = ctx.modelRegistry.streamSimple(model, { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, signal ? { signal } : undefined);
    const message = await stream.result();
    if (message.stopReason === 'error' || message.stopReason === 'aborted') throw new Error(message.errorMessage ?? `model call ${message.stopReason}`);
    return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
  };
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
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const path = isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path);
      const outcome = await compressFile({ path, complete: completer(ctx), ...(signal ? { signal } : {}) });
      switch (outcome.kind) {
        case 'compressed':
          return {
            content: [{ type: 'text', text: `Compressed ${outcome.path}: ${outcome.originalBytes} → ${outcome.compressedBytes} bytes. Backup: ${outcome.backupPath}` }],
            details: outcome,
          };
        case 'skipped':
          return { content: [{ type: 'text', text: `Skipped ${path}: ${outcome.reason}` }], details: outcome };
        case 'failed':
          throw new Error(`Compression failed, ${path} left untouched:\n${outcome.errors.join('\n')}`);
        default: {
          const exhaustive: never = outcome;
          return exhaustive;
        }
      }
    },
  });
}
