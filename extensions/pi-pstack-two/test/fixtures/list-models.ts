// Test-only Pi extension for scripts/live-e2e.mjs: `/list-models` prints the available models with the thinking
// levels Pi supports for each, one JSON object per line, so the runner checks rule values the way Task resolves them.
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function listModels(pi: ExtensionAPI): void {
  pi.registerCommand('list-models', {
    description: 'Test only: print available models with their thinking levels',
    handler: async (_args, ctx) => {
      for (const model of ctx.modelRegistry.getAvailable()) {
        process.stdout.write(`${JSON.stringify({ provider: model.provider, id: model.id, reasoning: model.reasoning, levels: getSupportedThinkingLevels(model) })}\n`);
      }
    },
  });
}
