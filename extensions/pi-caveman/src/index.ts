import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerCavecrew } from './cavecrew-tool.ts';
import { registerHelp, registerModeCommands, registerStats } from './commands.ts';
import { registerCompress } from './compress-tool.ts';
import { registerModeTracking } from './controller.ts';
import { registerRenderers } from './renderers.ts';
import { registerRuntime } from './runtime.ts';

export default function caveman(pi: ExtensionAPI): void {
  const controller = registerModeTracking(pi);
  registerModeCommands(pi, controller);
  registerHelp(pi);
  registerStats(pi, controller);
  registerCavecrew(pi);
  registerCompress(pi);
  registerRenderers(pi);
  // After mode tracking, so its ruleset section is already in the prompt that the runtime's Core extends.
  registerRuntime(pi);
}
