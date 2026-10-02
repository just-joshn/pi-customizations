import type { McpServerSpec } from './mcp-specs.ts';
import type { EffortLevel, ModelPolicy } from './settings.ts';

export type AgentSourceKind = 'built-in' | 'organization' | 'plugin' | 'user' | 'project' | 'runtime';

export type PromptParts = Readonly<{
  includeAISafety: boolean;
  includeToolInstructions: boolean;
  includeParallelToolCalling: boolean;
  includeEnvironmentContext: boolean;
  cwdListing: string;
  includeDynamicContextBoard: boolean;
  includeSessionSearchContext: boolean;
  includeCloudSessionSearchContext: boolean;
  includeConsolidationPrompt: boolean;
  includeOutputChannelInstructions: boolean;
  includeCustomInstructions: boolean;
  includeCustomAgentInstructions: boolean;
}>;

export type ToolSelection = Readonly<{ kind: 'all' }> | Readonly<{ kind: 'named'; names: readonly string[] }>;

export type AgentDefinition = Readonly<{
  name: string;
  displayName: string;
  description: string;
  model?: string | readonly string[];
  models?: readonly string[];
  modelPolicy?: ModelPolicy;
  reasoningEffort?: EffortLevel;
  tools: ToolSelection;
  promptParts: PromptParts;
  prompt: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  mcpServers?: readonly McpServerSpec[];
  skills?: readonly string[];
  source: AgentSourceKind;
  path?: string;
  plugin?: string;
  promptOverridable: boolean;
  dynamicModel?: 'complementary';
  gate?: 'rubberDuck' | 'subconscious';
  disableable: boolean;
}>;

export const builtInPromptParts: PromptParts = {
  includeAISafety: true,
  includeToolInstructions: true,
  includeParallelToolCalling: true,
  includeEnvironmentContext: true,
  cwdListing: 'default',
  includeDynamicContextBoard: false,
  includeSessionSearchContext: false,
  includeCloudSessionSearchContext: false,
  includeConsolidationPrompt: false,
  includeOutputChannelInstructions: false,
  includeCustomInstructions: false,
  includeCustomAgentInstructions: false,
};

export const customPromptParts: PromptParts = { ...builtInPromptParts, includeCustomAgentInstructions: true };

export const allTools: ToolSelection = { kind: 'all' };

export function namedTools(names: readonly string[]): ToolSelection {
  return { kind: 'named', names };
}

export function declaredTools(definition: Pick<AgentDefinition, 'tools'>): readonly string[] {
  return definition.tools.kind === 'all' ? ['*'] : definition.tools.names;
}

export function candidateModels(definition: Pick<AgentDefinition, 'model' | 'models'>): readonly string[] {
  const declared = typeof definition.model === 'string' ? [definition.model] : (definition.model ?? []);
  return [...declared, ...(definition.models ?? [])];
}
