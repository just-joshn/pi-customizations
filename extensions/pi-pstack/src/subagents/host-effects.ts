import type { ModelOption } from './model-selection.ts';
import type { PromptSection } from './prompt-assembly.ts';
import { rewindingSubagentMessage } from './tool-results.ts';

export const toolsUnavailableMessage = 'Cannot start subagent: tools are not available for this session';
export const unsupportedActionMessage = 'Unsupported start-subagent host action';
export const startActions = ['prepareTools', 'resolveSubconscious', 'resolveRubberDuckRollout', 'resolveSelectedModel', 'checkStartAllowed'] as const;
export type StartAction = (typeof startActions)[number];

export type SubagentHost = Readonly<{
  blocksStart: () => boolean;
  toolsAvailable: () => boolean;
  selectedModel: () => ModelOption | undefined;
  rubberDuckRollout: () => boolean;
  subconscious: () => boolean;
  availableCustomAgents: () => readonly string[];
  customPrompt: (agent: string) => string | undefined;
  hasActiveBackgroundWork: () => boolean;
  transformSection: (section: PromptSection, text: string) => string;
}>;

export type HostEffect =
  | Readonly<{ kind: 'start_subagent'; action: string }>
  | Readonly<{ kind: 'custom_agent_prompt'; agent: string }>
  | Readonly<{ kind: 'custom_agent_system_prompt'; agent: string }>
  | Readonly<{ kind: 'system_prompt_section_transform'; section: PromptSection; text: string }>
  | Readonly<{ kind: 'has_active_background_work' }>;

export type EffectReply = Readonly<{ allowed: true }> | Readonly<{ model: ModelOption | undefined }> | Readonly<{ enabled: boolean }> | Readonly<{ text: string }> | Readonly<{ active: boolean }>;

function isStartAction(action: string): action is StartAction {
  return startActions.some((known) => known === action);
}

function startSubagent(host: SubagentHost, action: string): EffectReply {
  if (!isStartAction(action)) throw new Error(unsupportedActionMessage);
  switch (action) {
    case 'checkStartAllowed':
      if (host.blocksStart()) throw new Error(rewindingSubagentMessage);
      return { allowed: true };
    case 'prepareTools':
      if (!host.toolsAvailable()) throw new Error(toolsUnavailableMessage);
      return { allowed: true };
    case 'resolveSelectedModel':
      return { model: host.selectedModel() };
    case 'resolveRubberDuckRollout':
      return { enabled: host.rubberDuckRollout() };
    case 'resolveSubconscious':
      return { enabled: host.subconscious() };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

function customPrompt(host: SubagentHost, agent: string): EffectReply {
  if (!host.availableCustomAgents().includes(agent)) throw new Error(`Custom agent '${agent}' is not available in this session.`);
  return { text: host.customPrompt(agent) ?? '' };
}

export function runHostEffect(host: SubagentHost, effect: HostEffect): EffectReply {
  switch (effect.kind) {
    case 'start_subagent':
      return startSubagent(host, effect.action);
    case 'custom_agent_prompt':
    case 'custom_agent_system_prompt':
      return customPrompt(host, effect.agent);
    case 'system_prompt_section_transform':
      return { text: host.transformSection(effect.section, effect.text) };
    case 'has_active_background_work':
      return { active: host.hasActiveBackgroundWork() };
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}
