import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ExtensionAPI, getAgentDir } from '@earendil-works/pi-coding-agent';
import { MODE, modeSection, SKILLS_DIR } from './mode.ts';
import { PLAN_ENTRY, PLAN_SECTION } from './plan.ts';

const SKILLS_HINT = `pstack skills, including ones hidden from the skill list, live at ${SKILLS_DIR}/<name>/SKILL.md. When a skill says to run another skill, read that file and follow it.`;
const modelsFile = (agentDir: string): string => join(agentDir, 'pstack-v2-models.md');

function promptSections(transcript: string | undefined, mode: string | undefined, planActive: boolean): Record<string, string> {
  const models = modelsFile(getAgentDir());
  return {
    ...(transcript && {
      'pstack-session': `This session's transcript is ${transcript}. A worker cannot find this file by itself, so put the path in any brief that asks a worker to read the transcript.`,
    }),
    ...(mode && { [MODE]: modeSection(mode) }),
    ...(planActive && { [PLAN_ENTRY]: PLAN_SECTION }),
    ...(existsSync(models) && { 'pstack-models': `Role lines from ${models}, written by /skill:setup-pstack:\n${readFileSync(models, 'utf8').trim()}` }),
  };
}

// Pi 1.5.2 reads prompt additions only from the options object it passes in (runner.js emitBeforeAgentStart),
// so this is the one place that writes into a host-owned object.
function writeIntoHostPrompt(options: { promptGuidelines: string[]; sections: Record<string, string> }, guideline: string, sections: Record<string, string>): void {
  if (!options.promptGuidelines.includes(guideline)) options.promptGuidelines.push(guideline);
  Object.assign(options.sections, sections);
}

/** Adds the skills hint, the session transcript, the mode's skill, plan mode state, and the role models to each turn's system prompt. */
export function registerPrompt(pi: ExtensionAPI, currentMode: () => string | undefined, isPlanActive: () => boolean): void {
  pi.on('before_agent_start', async (event, ctx) => {
    writeIntoHostPrompt(event.systemPromptOptions, SKILLS_HINT, promptSections(ctx.sessionManager.getSessionFile(), currentMode(), isPlanActive()));
  });
}
