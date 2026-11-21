import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerMode } from './mode.ts';
import { registerPrompt } from './prompt.ts';
import { registerTmuxTools } from './tmux-tools.ts';
import { createJobWatch, registerWatcher } from './watcher.ts';

export default function pstack(pi: ExtensionAPI) {
  const watch = createJobWatch();
  const currentMode = registerMode(pi);
  registerWatcher(pi, watch);
  registerPrompt(pi, currentMode);
  registerTmuxTools(pi, watch);
}
