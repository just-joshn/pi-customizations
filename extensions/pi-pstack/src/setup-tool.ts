import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { setupPstack } from './commands.ts';
import type { StateStore } from './state.ts';

export function registerSetupTool(pi: ExtensionAPI, store: StateStore): void {
  pi.registerTool({
    name: 'pstack_setup',
    label: 'Configure pstack models',
    description: 'Open native Pi model setup when the user asks to configure pstack models or reasoning budget. Requires interactive confirmation before writing.',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const written = await setupPstack(pi, ctx, store);
      return { content: [{ type: 'text', text: written ? 'Model configuration confirmed and saved.' : 'Setup cancelled. No configuration was written.' }], details: { written } };
    },
  });
}
