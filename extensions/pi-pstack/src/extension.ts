// The pi-pstack extension (spec 8): the worker and evidence tools, the persistent style, /pstack, and slash parity.
// Everything a workflow decides lives in the generated skills.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MODELS_PATH, registerPstackCommand } from './commands.ts';
import { registerEvidenceTool } from './evidence.ts';
import { parseFamilyDefault } from './model-spec.ts';
import { loadModelsConfig, type ModelsConfig, type ResolvedModel, type RoleResolution, resolveFamilyDefault, resolveRole } from './models.ts';
import { registerSkillRouting } from './skill-routing.ts';
import { registerStyle } from './style.ts';
import { type ModelResolver, registerWorkerSideTools, registerWorkerTools } from './workers.ts';

// resolveRole resolves role lines; an assignment's model spec stands in as the line of a single-model role, so it gets
// the same availability fallback and thinking-level clamping a configured role does.
const SPEC_ROLE = 'feature, refactoring';

/**
 * An assignment's model against Pi's registry, with models.json's budget. `inherit-parent` is the session's model and
 * level. A null thinkingLevel on a named model keeps that model's default level: the model is matched at level `off`,
 * or at the budget's level when it cannot turn thinking off.
 */
export const roleModelResolver =
  (config: () => ModelsConfig = () => loadModelsConfig(MODELS_PATH)): ModelResolver =>
  ({ model: assigned, thinkingLevel: assignedLevel }, ctx) => {
    const parent: ResolvedModel | undefined = ctx.model === undefined ? undefined : { provider: ctx.model.provider, id: ctx.model.id, thinkingLevel: (ctx.thinkingLevel ?? 'off') as ResolvedModel['thinkingLevel'] };
    if (assigned === 'inherit-parent' && parent === undefined) throw new Error('model inherit-parent: the parent session has no model selected');
    const loaded = config();
    // A family default names a model and a level; the registry says which provider lists it.
    const family = assigned.includes('/') || assigned === 'inherit-parent' ? undefined : parseFamilyDefault(assigned);
    const named = family === undefined ? undefined : resolveFamilyDefault(assigned, family, ctx.modelRegistry, parent);
    const model = named?.spec ?? assigned;
    const thinkingLevel = assignedLevel ?? named?.level ?? null;
    const attempt = (spec: string) => resolveRole(SPEC_ROLE, ctx.modelRegistry, parent ?? { provider: '', id: '', thinkingLevel: 'off' }, { ...loaded, roles: { [SPEC_ROLE]: spec } });
    let result: RoleResolution;
    if (model === 'inherit-parent') result = attempt(thinkingLevel === null ? 'inherit-parent' : `${parent?.provider}/${parent?.id}:${thinkingLevel}`);
    else if (thinkingLevel !== null) result = attempt(`${model}:${thinkingLevel}`);
    else {
      result = attempt(`${model}:off`);
      if (result.models.length === 0) result = attempt(model);
    }
    const [resolved] = result.models;
    if (resolved === undefined) throw new Error(`Model ${assigned} is not available: ${result.limitations.join('; ')}. Available: ${ctx.modelRegistry.getAvailable().map((entry) => `${entry.provider}/${entry.id}`).join(', ') || '(none)'}`);
    const level = model !== 'inherit-parent' && thinkingLevel === null ? null : resolved.thinkingLevel;
    const substituted = model !== 'inherit-parent' && `${resolved.provider}/${resolved.id}` !== model;
    const releveled = thinkingLevel !== null && resolved.thinkingLevel !== thinkingLevel;
    const parts = [...(named?.note === undefined ? [] : [named.note]), ...(substituted || releveled ? [`requested ${model}${thinkingLevel === null ? '' : `:${thinkingLevel}`}, running ${resolved.provider}/${resolved.id}:${resolved.thinkingLevel}`, ...result.limitations] : [])];
    return { provider: resolved.provider, id: resolved.id, thinkingLevel: level, ...(parts.length === 0 ? {} : { note: parts.join('; ') }) };
  };

export default function pstack(pi: ExtensionAPI): void {
  if (process.env['PSTACK_WORKER'] === '1') {
    registerWorkerSideTools(pi, process.env);
    return;
  }
  registerWorkerTools(pi, { resolveModel: roleModelResolver() });
  registerEvidenceTool(pi);
  registerStyle(pi);
  const routing = registerSkillRouting(pi);
  registerPstackCommand(pi, { conflicts: routing.conflicts });
}
