import type { AgentDefinition } from './agent-definition.ts';
import type { McpServerSpec } from './mcp-specs.ts';
import type { ModelSelection } from './model-selection.ts';
import { type AssembledPrompt, assembleSystemPrompt, type EnvironmentFacts, type SystemMessageOption, transformFrom } from './prompt-assembly.ts';
import type { Reference AssistantSettings } from './settings.ts';
import type { ExecutionMode } from './task-status.ts';
import type { ToolPlan } from './tool-mapping.ts';

export type CreationEffect = 'invalidateAgentToolConfig' | 'seedIfc' | 'inheritMcpTools' | 'inheritContentExclusion' | 'emitStarted' | 'bridgeEvents' | 'notifyCompletion' | 'bridgeCallbacks';
export const creationEffects: readonly CreationEffect[] = ['invalidateAgentToolConfig', 'seedIfc', 'inheritMcpTools', 'inheritContentExclusion', 'emitStarted', 'bridgeEvents', 'notifyCompletion', 'bridgeCallbacks'];

export type ChildLimits = Readonly<{ maxAgentTurns?: number; lastTurnWarning?: string; maxOutputTokens?: number }>;
export type BuildRequest = Readonly<{
  definition: AgentDefinition;
  selection: ModelSelection;
  settings: Reference AssistantSettings;
  agentId: string;
  registryId: string;
  parentRegistryId?: string;
  parentAgentId: string;
  rootSessionId: string;
  cwd: string;
  prompt: string;
  mode: ExecutionMode;
  tools: ToolPlan;
  toolNames: Readonly<{ grep: string; glob: string; shell: string; view: string }>;
  environment: EnvironmentFacts;
  now: Date;
  headless: boolean;
  limits?: ChildLimits;
  hookContext?: string;
  customInstructions?: string;
  systemMessage?: SystemMessageOption;
  writeGate?: () => boolean;
}>;

export type ChildPlan = Readonly<{
  agentId: string;
  registryId: string;
  parentRegistryId?: string;
  rootSessionId: string;
  definition: AgentDefinition;
  selection: ModelSelection;
  mode: ExecutionMode;
  prompt: AssembledPrompt;
  userMessage: string;
  tools: ToolPlan;
  contextFiles: boolean;
  skills: readonly string[];
  mcpServers: readonly McpServerSpec[];
  identity: Readonly<Record<string, string>>;
  limits: ChildLimits;
  cwd: string;
  effects: readonly CreationEffect[];
  writeGate: () => boolean;
}>;

const required = ['agentId', 'registryId', 'rootSessionId', 'cwd'] as const;

export function missingField(plan: Pick<ChildPlan, (typeof required)[number]> & { prompt: AssembledPrompt }): string | undefined {
  const empty = required.find((field) => plan[field] === '');
  if (empty) return empty;
  return plan.prompt.text === '' ? 'prompt' : undefined;
}

export function datetimeTag(now: Date): string {
  return `<current_datetime>${now.toISOString()}</current_datetime>`;
}

export function identityHeaders(input: Pick<BuildRequest, 'agentId' | 'parentAgentId' | 'rootSessionId'>): Readonly<Record<string, string>> {
  return { 'X-Interaction-Type': 'conversation-subagent', 'X-Agent-Task-Id': input.agentId, 'X-Parent-Agent-Id': input.parentAgentId, 'X-Client-Session-Id': input.rootSessionId };
}

function mergedContext(request: BuildRequest): string {
  return request.hookContext ? `${request.hookContext}\n\n${request.prompt}` : request.prompt;
}

export function buildChildPlan(request: BuildRequest): ChildPlan {
  const { definition } = request;
  const transform = transformFrom(request.systemMessage);
  const prompt = assembleSystemPrompt({
    definition,
    toolNames: request.toolNames,
    environment: request.environment,
    headless: request.headless,
    ...(transform ? { transform } : {}),
    ...(request.customInstructions !== undefined ? { customInstructions: request.customInstructions } : {}),
  });
  const plan: ChildPlan = {
    agentId: request.agentId,
    registryId: request.registryId,
    ...(request.parentRegistryId !== undefined ? { parentRegistryId: request.parentRegistryId } : {}),
    rootSessionId: request.rootSessionId,
    definition,
    selection: request.selection,
    mode: request.mode,
    prompt,
    userMessage: `${datetimeTag(request.now)}\n\n${mergedContext(request)}`,
    tools: request.tools,
    contextFiles: definition.promptParts.includeCustomInstructions,
    skills: definition.skills ?? [],
    mcpServers: definition.mcpServers ?? [],
    identity: identityHeaders(request),
    limits: request.limits ?? {},
    cwd: request.cwd,
    effects: creationEffects,
    writeGate: request.writeGate ?? (() => true),
  };
  const missing = missingField(plan);
  if (missing) throw new Error(`subagent creation plan is missing required field: ${missing}`);
  return plan;
}
