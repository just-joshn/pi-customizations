import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

export const fileTrackingRefusal = 'File-change tracking requires a persisted session.';
const tracked = new Set(['edit', 'write']);

export function fileTrackingGate(depth: number, persisted: boolean): { enabled: boolean; refusal?: string } {
  if (depth === 0 && !persisted) return { enabled: false, refusal: fileTrackingRefusal };
  return { enabled: persisted };
}

/** Records the files a session changes as durable entries. Offered to persisted roots, not to children. */
export function fileTrackingExtension(): ExtensionFactory {
  return (pi) => {
    pi.on('tool_execution_start', (event) => {
      if (event.parentToolCallId !== undefined || !tracked.has(event.toolName)) return;
      const path = typeof event.args?.path === 'string' ? event.args.path : undefined;
      if (path) pi.appendEntry('copilot-file-change', { path, at: Date.now() });
    });
  };
}
