import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clampThinkingLevel } from '@earendil-works/pi-ai';
import {
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionServicesOptions,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createCodemodeExtension,
  type createEventBus,
  createMcpExtension,
  createToolSearchExtension,
  type ExtensionContext,
  type ExtensionUIContext,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { resolveModel } from '../models.ts';
import { workerDirs, workerExtensions } from '../worker-support.ts';
import { agentEnvironment, childStorageDir, createChildTranscript, environmentEntryType } from './agent-storage.ts';
import { childSettings } from './child-settings.ts';
import { contentExclusionExtension } from './content-exclusion.ts';
import type { ChildPlan } from './context-builder.ts';
import type { Exec } from './environment-facts.ts';
import { type ChildIdentity, identityExtension } from './identity-extension.ts';
import { inheritedMcpExtension, type ParentServer } from './mcp-inheritance.ts';
import { ModelHistory } from './model-history.ts';
import { preloadSkills } from './skill-loading.ts';
import { planTools, type ToolPlan, zeroToolsMessage } from './tool-mapping.ts';
import { toolPolicyExtension } from './tool-policy.ts';
import { trackedBashTool } from './tracked-bash.ts';
import { writeGateExtension } from './write-gate.ts';

export const childContextEntryType = 'reference-assistant-child-context';
const ChildContextSchema = Type.Object({
  agentId: Type.String({ minLength: 1 }),
  registryId: Type.String({ minLength: 1 }),
  parentRegistryId: Type.Optional(Type.String()),
  rootSessionId: Type.String({ minLength: 1 }),
  depth: Type.Integer({ minimum: 1 }),
  headers: Type.Record(Type.String(), Type.String()),
  promptCacheLineageSessionId: Type.String(),
  tools: Type.Array(Type.String()),
  mcpServers: Type.Array(Type.String()),
});
export type ChildContextEntry = Static<typeof ChildContextSchema>;

export function readChildContext(entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>): ChildContextEntry | undefined {
  const entry = entries.findLast((candidate) => candidate.type === 'custom' && candidate.customType === childContextEntryType);
  return Check(ChildContextSchema, entry?.data) ? entry.data : undefined;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type OpenInput = Readonly<{
  plan: ChildPlan;
  ctx: ExtensionContext;
  events: ReturnType<typeof createEventBus>;
  depth: number;
  parentTools: readonly string[];
  contextManagement: boolean;
  parentAgentId: string;
  onProcessGroup: (pid: number) => void;
  exec: Exec;
  log: (message: string) => void;
  inheritedServers: readonly ParentServer[];
  exclusionPatterns: readonly string[];
  aggressiveTools: boolean;
}>;
export type OpenedChild = Readonly<{ runtime: AgentSessionRuntime; session: AgentSession; sessionFile: string; modelReference: string; modelsUsed: ModelHistory; tools: ToolPlan }>;

async function storageDirectory(ctx: ExtensionContext): Promise<string> {
  const manager = ctx.sessionManager;
  if (!manager.getSessionFile()) return workerDirs.create(manager);
  return childStorageDir(manager.getSessionDir(), manager.getSessionId());
}

function promptOptions(plan: ChildPlan) {
  const common = { noContextFiles: !plan.contextFiles };
  return plan.prompt.mode === 'override' ? { ...common, systemPromptOverride: () => plan.prompt.text, appendSystemPrompt: [] } : { ...common, appendSystemPrompt: [plan.prompt.text] };
}

type LoaderOptions = NonNullable<CreateAgentSessionServicesOptions['resourceLoaderOptions']>;

async function loaderOptions(input: OpenInput, modelsUsed: ModelHistory, identity: ChildIdentity): Promise<LoaderOptions> {
  const { pi: manifest } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { pi: Record<'extensions' | 'skills' | 'prompts', string[]> };
  return {
    eventBus: input.events,
    ...promptOptions(input.plan),
    extensionFactories: [
      createCodemodeExtension(),
      createToolSearchExtension(),
      createMcpExtension(),
      modelsUsed.extensionFactory(),
      identityExtension(identity),
      ...(input.inheritedServers.length > 0 ? [inheritedMcpExtension(input.inheritedServers, input.log, input.aggressiveTools)] : []),
      ...(input.exclusionPatterns.length > 0 ? [contentExclusionExtension(input.exclusionPatterns)] : []),
      toolPolicyExtension({ definition: input.plan.definition, parentTools: input.parentTools, contextManagement: input.contextManagement }),
      writeGateExtension(input.plan.writeGate),
    ],
    additionalExtensionPaths: manifest.extensions.map((path) => join(root, path)),
    additionalSkillPaths: manifest.skills.map((path) => join(root, path)),
    additionalPromptTemplatePaths: manifest.prompts.map((path) => join(root, path)),
    extensionsOverride: (result) => workerExtensions(result, join(root, 'src/index.ts')),
  };
}

async function openTranscript(input: OpenInput, dir: string): Promise<{ manager: SessionManager; sessionFile: string }> {
  const { plan, ctx } = input;
  const path = await createChildTranscript(plan.cwd, dir, plan.agentId, ctx.sessionManager.getSessionFile());
  const manager = SessionManager.open(path, dir, plan.cwd);
  manager.appendCustomEntry(environmentEntryType, await agentEnvironment(plan.agentId, plan.rootSessionId, plan.cwd, input.exec));
  const entry: ChildContextEntry = {
    agentId: plan.agentId,
    registryId: plan.registryId,
    ...(plan.parentRegistryId !== undefined ? { parentRegistryId: plan.parentRegistryId } : {}),
    rootSessionId: plan.rootSessionId,
    depth: input.depth,
    headers: plan.identity,
    promptCacheLineageSessionId: plan.rootSessionId,
    tools: [...plan.tools.effective],
    mcpServers: [...plan.mcpServers.map((spec) => spec.name), ...input.inheritedServers.map((server) => server.name)],
  };
  manager.appendCustomEntry(childContextEntryType, entry);
  const sessionFile = manager.getSessionFile();
  if (!sessionFile) throw new Error('Subagent session did not provide a durable transcript path.');
  return { manager, sessionFile };
}

/** Child permission and user-input requests route to the parent flow, attributed to the child, with no duplicate prompt. */
export function forwardedUi(parent: ExtensionUIContext, agentName: string): ExtensionUIContext {
  const titled = (title: string) => `subagent ${agentName}: ${title}`;
  return new Proxy(parent, {
    get(target, property) {
      if (property === 'select' || property === 'confirm' || property === 'input') {
        return (title: string, ...rest: unknown[]) => (target[property] as (t: string, ...rest: unknown[]) => unknown)(titled(title), ...rest);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function openChildSession(input: OpenInput): Promise<OpenedChild> {
  const { plan, ctx } = input;
  const picked = resolveModel(plan.selection.model.reference, ctx);
  const selected = plan.selection.effort ? { ...picked, thinkingLevel: clampThinkingLevel(picked.model, plan.selection.effort) } : picked;
  const modelsUsed = new ModelHistory([`${selected.model.provider}/${selected.model.id}`]);
  const identity: ChildIdentity = { headers: plan.identity, agentId: plan.agentId, parentAgentId: input.parentAgentId };
  const settingsManager = childSettings(plan.cwd, ctx);
  const resourceLoaderOptions = await loaderOptions(input, modelsUsed, identity);
  const { manager, sessionFile } = await openTranscript(input, await storageDirectory(ctx));
  const runtime = await createAgentSessionRuntime(
    async ({ cwd, agentDir, sessionManager }) => {
      const services = await createAgentSessionServices({ cwd, agentDir, settingsManager, resourceLoaderOptions });
      const errors = services.resourceLoader.getExtensions().errors;
      if (errors.length) throw new Error(`Subagent extension loading failed: ${errors.map((error) => error.error).join('; ')}`);
      const created = await createAgentSessionFromServices({ services, sessionManager, ...selected, customTools: [trackedBashTool(cwd, input.onProcessGroup)] });
      return { ...created, services, diagnostics: services.diagnostics };
    },
    { cwd: plan.cwd, agentDir: getAgentDir(), sessionManager: manager },
  );
  const { session } = runtime;
  input.log('tool_init_subagent_preferences');
  input.log('tool_init_requested_tools');
  input.log('tool_init_inherited_mcp_tools');
  input.log('subagent_tool_filter');
  const tools = planTools({ definition: plan.definition, parentTools: input.parentTools, available: session.getAllTools().map((tool) => tool.name), contextManagement: input.contextManagement });
  const refusal = zeroToolsMessage(plan.definition.name, tools);
  if (refusal) {
    await runtime.dispose();
    throw new Error(refusal);
  }
  input.log('subagent_tool_surface_prepare');
  session.setActiveToolsByName([...tools.effective]);
  await session.bindExtensions({ mode: 'print', uiContext: forwardedUi(input.ctx.ui, plan.definition.displayName) });
  await preloadSkills(session, runtime.services.resourceLoader.getSkills().skills, plan.skills, plan.definition.name, input.log);
  return { runtime, session, sessionFile, modelReference: `${selected.model.provider}/${selected.model.id}`, modelsUsed, tools };
}
