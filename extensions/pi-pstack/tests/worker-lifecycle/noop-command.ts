// Test-only Pi extension: a command that handles its prompt and starts no run.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function noopCommand(pi: ExtensionAPI): void {
  pi.registerCommand('pstack-noop', { description: 'Test only: handled without a run', handler: async () => undefined });
}
