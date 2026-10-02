import { type AgentDefinition, candidateModels } from './agent-definition.ts';
import type { ContextTier, EffortLevel, ModelPolicy, SubagentSettingsEntry } from './settings.ts';

export type ModelSelectionSource = 'explicit_override' | 'configured_required' | 'configured_preference' | 'complementary_default' | 'session_inheritance' | 'agent_definition_default' | 'runtime_policy';
export type TaskModelSource = 'task_argument' | 'subagent_configuration' | 'custom_agent_definition' | 'unset';
export type OverrideReason = 'required_policy_replaced_request' | 'request_not_available' | 'request_exceeds_cost_guard';

export type ModelOption = Readonly<{ reference: string; provider: string; id: string; cost: number; contextWindow: number }>;
export type SelectionRequest = Readonly<{
  agent: Pick<AgentDefinition, 'name' | 'source' | 'model' | 'models' | 'reasoningEffort' | 'dynamicModel'>;
  taskModel?: string;
  taskModelPolicy?: ModelPolicy;
  taskEffortLevel?: EffortLevel;
  taskContextTier?: ContextTier;
  setting?: SubagentSettingsEntry;
  session: ModelOption;
  available: readonly ModelOption[];
  costGuard?: number;
}>;
export type ModelSelection = Readonly<{
  model: ModelOption;
  source: ModelSelectionSource;
  taskSource: TaskModelSource;
  contextTier: ContextTier;
  effort?: EffortLevel;
  requested?: string;
  configured?: string;
  overrideReason?: OverrideReason;
  firstDispatched: string;
}>;
export type SelectionResult = Readonly<{ ok: true; selection: ModelSelection }> | Readonly<{ ok: false; message: string }>;

const normalized = (id: string): string => id.trim().toLowerCase().replaceAll('.', '-');
export function sameModel(candidate: string, reference: string): boolean {
  const wanted = normalized(candidate);
  const actual = normalized(reference);
  return wanted === actual || actual.endsWith(`/${wanted}`);
}

const longContextSuffix = /(?:\[1m\]|-1m)$/;

function allowedCost(session: ModelOption, guard: number): number {
  return session.cost > 0 ? session.cost * guard : Number.POSITIVE_INFINITY;
}

export function matchModel(candidate: string, session: ModelOption, available: readonly ModelOption[]): ModelOption | undefined {
  const wanted = normalized(candidate);
  const exact = available.find((option) => normalized(option.reference) === wanted);
  if (exact) return exact;
  const byId = available.filter((option) => normalized(option.id) === wanted);
  return byId.find((option) => option.provider === session.provider) ?? byId.toSorted((left, right) => left.reference.localeCompare(right.reference))[0];
}

function withTier(model: ModelOption, tier: ContextTier, available: readonly ModelOption[]): ModelOption {
  if (tier !== 'long_context') return model;
  const base = normalized(model.id).replace(longContextSuffix, '');
  const family = available.filter((option) => option.provider === model.provider && normalized(option.id).replace(longContextSuffix, '') === base);
  return family.toSorted((left, right) => right.contextWindow - left.contextWindow)[0] ?? model;
}

function complementary(session: ModelOption, available: readonly ModelOption[], guard: number): ModelOption | undefined {
  const ceiling = allowedCost(session, guard);
  const others = available.filter((option) => option.provider !== session.provider && option.cost <= ceiling);
  return others.toSorted((left, right) => right.cost - left.cost || left.reference.localeCompare(right.reference))[0];
}

type Walk = Readonly<{ model: ModelOption; skipped: readonly string[]; costBlocked: readonly string[] }>;

function walk(candidates: readonly string[], request: SelectionRequest, guard: number): Walk | undefined {
  const ceiling = allowedCost(request.session, guard);
  const skipped: string[] = [];
  const costBlocked: string[] = [];
  for (const candidate of candidates) {
    const found = matchModel(candidate, request.session, request.available);
    if (!found) skipped.push(candidate);
    else if (found.cost > ceiling) costBlocked.push(candidate);
    else return { model: found, skipped, costBlocked };
  }
  return undefined;
}

function contextTierOf(request: SelectionRequest): ContextTier {
  return request.taskContextTier ?? request.setting?.contextTier ?? 'inherit';
}

function effortOf(request: SelectionRequest): EffortLevel | undefined {
  return request.taskEffortLevel ?? request.setting?.effortLevel ?? request.agent.reasoningEffort;
}

function finish(request: SelectionRequest, picked: Omit<ModelSelection, 'contextTier' | 'effort' | 'firstDispatched'>): SelectionResult {
  const contextTier = contextTierOf(request);
  const effort = effortOf(request);
  const model = withTier(picked.model, contextTier, request.available);
  return { ok: true, selection: { ...picked, model, contextTier, ...(effort !== undefined ? { effort } : {}), firstDispatched: model.reference } };
}

function required(request: SelectionRequest, guard: number, model: string): SelectionResult {
  const found = walk([model], request, guard);
  const mismatch = request.taskModel !== undefined && request.taskModel !== model ? { requested: request.taskModel, overrideReason: 'required_policy_replaced_request' as const } : {};
  if (found) return finish(request, { model: found.model, source: 'configured_required', taskSource: 'subagent_configuration', configured: model, ...mismatch });
  const present = matchModel(model, request.session, request.available);
  if (present) return { ok: false, message: `Model '${model}' is required for agent type '${request.agent.name}' but exceeds the allowed cost relative to the current session model` };
  return { ok: false, message: `Model '${model}' is required for agent type '${request.agent.name}' but is not available in this session.` };
}

function explicit(request: SelectionRequest, guard: number, model: string): SelectionResult | Pick<ModelSelection, 'requested' | 'overrideReason'> {
  const found = walk([model], request, guard);
  if (found) return finish(request, { model: found.model, source: 'explicit_override', taskSource: 'task_argument', requested: model, ...(request.setting?.model ? { configured: request.setting.model } : {}) });
  return { requested: model, overrideReason: matchModel(model, request.session, request.available) ? 'request_exceeds_cost_guard' : 'request_not_available' };
}

function layered(request: SelectionRequest, guard: number, carried: Pick<ModelSelection, 'requested' | 'overrideReason'>): SelectionResult {
  const preferred = request.setting?.model;
  const custom = request.agent.source !== 'built-in';
  const layers: ReadonlyArray<{ candidates: readonly string[]; source: ModelSelectionSource; taskSource: TaskModelSource }> = [
    { candidates: preferred ? [preferred] : [], source: 'configured_preference', taskSource: 'subagent_configuration' },
    { candidates: candidateModels(request.agent), source: 'agent_definition_default', taskSource: custom ? 'custom_agent_definition' : 'unset' },
  ];
  const configured = preferred ? { configured: preferred } : {};
  for (const layer of layers) {
    const found = layer.candidates.length > 0 ? walk(layer.candidates, request, guard) : undefined;
    if (found) return finish(request, { model: found.model, source: layer.source, taskSource: layer.taskSource, ...configured, ...carried });
  }
  const attempted = layers.some((layer) => layer.candidates.length > 0);
  return finish(request, { model: request.session, source: attempted ? 'runtime_policy' : 'session_inheritance', taskSource: 'unset', ...configured, ...carried });
}

/** A required policy comes from the settings entry or from the call itself, which is how a workflow agent pins its model. */
function requiredModel(request: SelectionRequest): string | undefined {
  if (request.setting?.modelPolicy === 'required') return request.setting.model;
  if (request.taskModelPolicy === 'required') return request.taskModel ?? request.setting?.model;
  return undefined;
}

export function selectModel(request: SelectionRequest): SelectionResult {
  const guard = request.costGuard ?? 1;
  const policyModel = requiredModel(request);
  if (policyModel !== undefined) return required(request, guard, policyModel);
  const carried = request.taskModel === undefined ? {} : explicit(request, guard, request.taskModel);
  if ('ok' in carried) return carried;
  if (request.agent.dynamicModel === 'complementary' && request.setting?.model === undefined) {
    const found = complementary(request.session, request.available, guard);
    if (found) return finish(request, { model: found, source: 'complementary_default', taskSource: 'unset', ...carried });
  }
  return layered(request, guard, carried);
}
