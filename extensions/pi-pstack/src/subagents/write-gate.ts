import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

export const planModeMessage = 'The parent session is in plan mode, so this agent cannot modify files.';
const writes = new Set(['edit', 'write']);

/** The plan-mode write gate is a live callback to the parent: while it reports plan mode, the child cannot write. */
export function writeGateExtension(canWrite: () => boolean): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', (event) => (writes.has(event.toolName) && !canWrite() ? { block: true, reason: planModeMessage } : undefined));
  };
}
