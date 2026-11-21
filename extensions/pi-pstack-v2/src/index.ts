import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerAutomate } from './automate.ts';
import { registerCreateSkill } from './create-skill.ts';
import { registerGuards } from './guards.ts';
import { registerLoop } from './loop.ts';
import { registerMode } from './mode.ts';
import { registerPlan } from './plan.ts';
import { registerPrompt } from './prompt.ts';
import { registerTmuxTools } from './tmux-tools.ts';
import { createJobWatch, registerWatcher } from './watcher.ts';

export default function pstack(pi: ExtensionAPI) {
  const watch = createJobWatch();
  const currentMode = registerMode(pi);
  const isPlanActive = registerPlan(pi);
  registerGuards(pi);
  registerWatcher(pi, watch);
  registerPrompt(pi, currentMode, isPlanActive);
  registerTmuxTools(pi, watch);
  registerLoop(pi, watch);
  registerCreateSkill(pi);
  registerAutomate(pi, watch);
}
