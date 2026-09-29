/**
 * Installs the implemented the reference CLI commands as pi extension commands. Mapped ids
 * stay unregistered so pi built-ins win; unmet ids have no handler to run.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { TuiSession } from '../state.ts';
import { TUI_COMMANDS } from './registry.ts';

export function installCommands(pi: ExtensionAPI, session: TuiSession): void {
  for (const entry of TUI_COMMANDS) {
    const handler = entry.handler;
    if (entry.status !== 'implemented' || !handler) continue;
    if (entry.registeredBy) continue;
    pi.registerCommand(entry.id, {
      description: entry.description,
      handler: async (args, ctx) => {
        await handler(args, ctx, session);
      },
    });
  }
}
