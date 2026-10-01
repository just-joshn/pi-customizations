import { agentAppendJourney } from './agent-append-journey.mjs';
import { agentDepthSettingJourney } from './agent-depth-setting-journey.mjs';
import { agentGuidanceJourney } from './agent-guidance-journey.mjs';
import { agentJsonInheritanceJourney } from './agent-json-inheritance-journey.mjs';
import { agentJsonJourney } from './agent-json-journey.mjs';
import { agentLegacyDepthJourney } from './agent-legacy-depth-journey.mjs';
import { agentMemoryRemoteJourney } from './agent-memory-remote-journey.mjs';
import { agentRemoteJourney } from './agent-remote-journey.mjs';
import { agentSimpleJourney } from './agent-simple-journey.mjs';
import { agentTurnLimitJourney } from './agent-turn-limit-journey.mjs';
import { agentWorktreeUiJourney } from './agent-worktree-ui-journey.mjs';

export function agentJourneys(check, startPi) {
  return [
    agentTurnLimitJourney(startPi, check),
    agentGuidanceJourney(check),
    agentRemoteJourney(check),
    agentJsonJourney(check, startPi),
    agentMemoryRemoteJourney(check, startPi),
    agentJsonInheritanceJourney(check, startPi),
    agentAppendJourney(check, startPi),
    agentSimpleJourney(check, startPi),
    agentLegacyDepthJourney(check, startPi),
    agentDepthSettingJourney(check, startPi),
    agentWorktreeUiJourney(check, startPi),
  ];
}
