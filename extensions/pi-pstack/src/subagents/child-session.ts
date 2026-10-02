import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clampThinkingLevel } from '@earendil-works/pi-ai';
import { type AgentSession, createAgentSession, type createEventBus, DefaultResourceLoader, type ExtensionContext, getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent';
import { resolveModel } from '../models.ts';
import { workerDirs, workerExtensions } from '../worker-support.ts';
import { agentEnvironment, childStorageDir, createChildTranscript, environmentEntryType } from './agent-storage.ts';
import type { ChildPlan } from './context-builder.ts';
import { type ChildIdentity, identityExtension } from './identity-extension.ts';
import { ModelHistory } from './model-history.ts';
import { preloadSkills } from './skill-loading.ts';
import { planTools, type ToolPlan, zeroToolsMessage } from './tool-mapping.ts';
import { trackedBashTool } from './tracked-bash.ts';

export const childContextEntryType = 'reference-assistant-child-context';
export type ChildContextEntry = Readonly<{ agentId: string; registryId: string; parentRegistryId?: string; rootSessionId: string; depth: number; headers: Readonly<Record<string, string>> }>;

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
  log: (message: string) => void;
}>;
export type OpenedChild = Readonly<{ session: AgentSession; sessionFile: string; modelReference: string; modelsUsed: ModelHistory; tools: ToolPlan }>;

async function storageDirectory(ctx: ExtensionContext): Promise<string> {
  const manager = ctx.sessionManager;
  if (!manager.getSessionFile()) return workerDirs.create(manager);
  return childStorageDir(manager.getSessionDir(), manager.getSessionId());
}

function promptOptions(plan: ChildPlan) {
  const common = { noContextFiles: !plan.contextFiles };
  return plan.prompt.mode === 'override' ? { ...common, systemPromptOverride: () => plan.prompt.text, appendSystemPrompt: [] } : { ...common, appendSystemPrompt: [plan.prompt.text] };
}

async function loaderFor(input: OpenInput, cwd: string, modelsUsed: ModelHistory, identity: ChildIdentity): Promise<DefaultResourceLoader> {
  const { pi: manifest } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { pi: Record<'extensions' | 'skills' | 'prompts', string[]> };
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    eventBus: input.events,
    ...promptOptions(input.plan),
    extensionFactories: [modelsUsed.extensionFactory(), identityExtension(identity)],
    additionalExtensionPaths: manifest.extensions.map((path) => join(root, path)),
    additionalSkillPaths: manifest.skills.map((path) => join(root, path)),
    additionalPromptTemplatePaths: manifest.prompts.map((path) => join(root, path)),
    extensionsOverride: (result) => workerExtensions(result, join(root, 'src/index.ts')),
  });
  await loader.reload();
  const errors = loader.getExtensions().errors;
  if (errors.length) throw new Error(`Subagent extension loading failed: ${errors.map((error) => error.error).join('; ')}`);
  return loader;
}

async function openTranscript(input: OpenInput, dir: string): Promise<{ manager: SessionManager; sessionFile: string }> {
  const { plan, ctx } = input;
  const path = await createChildTranscript(plan.cwd, dir, plan.agentId, ctx.sessionManager.getSessionFile());
  const manager = SessionManager.open(path, dir, plan.cwd);
  manager.appendCustomEntry(environmentEntryType, await agentEnvironment(plan.agentId, plan.rootSessionId, plan.cwd));
  const entry: ChildContextEntry = {
    agentId: plan.agentId,
    registryId: plan.registryId,
    ...(plan.parentRegistryId !== undefined ? { parentRegistryId: plan.parentRegistryId } : {}),
    rootSessionId: plan.rootSessionId,
    depth: input.depth,
    headers: plan.identity,
  };
  manager.appendCustomEntry(childContextEntryType, entry);
  const sessionFile = manager.getSessionFile();
  if (!sessionFile) throw new Error('Subagent session did not provide a durable transcript path.');
  return { manager, sessionFile };
}

export async function openChildSession(input: OpenInput): Promise<OpenedChild> {
  const { plan, ctx } = input;
  const picked = resolveModel(plan.selection.model.reference, ctx);
  const selected = plan.selection.effort ? { ...picked, thinkingLevel: clampThinkingLevel(picked.model, plan.selection.effort) } : picked;
  const modelsUsed = new ModelHistory([`${selected.model.provider}/${selected.model.id}`]);
  const identity: ChildIdentity = { headers: plan.identity, agentId: plan.agentId, parentAgentId: input.parentAgentId };
  const loader = await loaderFor(input, plan.cwd, modelsUsed, identity);
  const { manager, sessionFile } = await openTranscript(input, await storageDirectory(ctx));
  const { session } = await createAgentSession({ cwd: plan.cwd, resourceLoader: loader, sessionManager: manager, ...selected, customTools: [trackedBashTool(plan.cwd, input.onProcessGroup)] });
  const tools = planTools({ definition: plan.definition, parentTools: input.parentTools, available: session.getAllTools().map((tool) => tool.name), contextManagement: input.contextManagement });
  const refusal = zeroToolsMessage(plan.definition.name, tools);
  if (refusal) {
    session.dispose();
    throw new Error(refusal);
  }
  session.setActiveToolsByName([...tools.effective]);
  await session.bindExtensions({ mode: 'print' });
  await preloadSkills(session, loader.getSkills().skills, plan.skills, plan.definition.name, input.log);
  return { session, sessionFile, modelReference: `${selected.model.provider}/${selected.model.id}`, modelsUsed, tools };
}
