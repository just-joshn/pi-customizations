import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import {
  type AgentSession,
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  getAgentDir,
  type ProviderConfig,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { normalizeToolNames } from './discovery.ts';
import { SubagentRunError } from './failures.ts';
import { createReadonlySubagentExtension, READONLY_BLOCKED_TOOLS } from './readonly-guard.ts';
import { type NestedScope, SUBAGENT_TOOL_NAMES, SUBAGENTS_DIR_NAME, type SubagentDefinition, type SubagentThinkingLevel, ZERO } from './types.ts';

export interface NestedExtensionFactory {
  (scope: NestedScope): ExtensionFactory;
}

export interface ChildSessionRequest {
  readonly ctx: ExtensionContext;
  readonly definition: SubagentDefinition;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly childDepth: number;
  readonly ownedAgentIds: readonly string[];
  readonly model: Model<Api> | undefined;
  readonly thinking: SubagentThinkingLevel | undefined;
  readonly readonly: boolean;
  readonly existingTranscriptPath: string | undefined;
  readonly isResume: boolean;
  readonly cwd: string;
  readonly projectTrusted: boolean;
  readonly nestedScope: NestedScope | undefined;
  readonly createNestedExtension: NestedExtensionFactory;
}

export interface ChildSession {
  readonly session: AgentSession;
  readonly sessionManager: SessionManager;
  readonly transcriptPath: string | undefined;
}

function isExtensionProviderConfig(config: unknown): config is ProviderConfig {
  return typeof config === 'object' && config !== null;
}

/** Re-registers the parent's extension providers so delegated runs resolve custom OAuth models. */
function createInheritedProvidersExtension(modelRegistry: ExtensionContext['modelRegistry']): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    for (const providerId of modelRegistry.getRegisteredProviderIds?.() ?? []) {
      const nativeProvider = modelRegistry.getRegisteredNativeProvider?.(providerId);
      if (nativeProvider !== undefined) {
        pi.registerProvider(nativeProvider);
        continue;
      }
      const config = modelRegistry.getRegisteredProviderConfig?.(providerId);
      if (isExtensionProviderConfig(config)) {
        pi.registerProvider(providerId, config);
      }
    }
  };
}

export function resolveSubagentSessionDir(ctx: ExtensionContext): string | undefined {
  const sessionDir = ctx.sessionManager.getSessionDir();
  if (!sessionDir || sessionDir.trim().length === ZERO) {
    return undefined;
  }
  const targetDir = join(sessionDir, SUBAGENTS_DIR_NAME);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

export function createChildSessionManager(cwd: string, transcriptPath: string | undefined, isResume: boolean, sessionDir: string | undefined): SessionManager {
  if (isResume && transcriptPath && existsSync(transcriptPath)) {
    try {
      return SessionManager.open(transcriptPath, sessionDir, cwd);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new SubagentRunError('resume-unavailable', detail);
    }
  }
  return sessionDir ? SessionManager.create(cwd, sessionDir) : SessionManager.inMemory(cwd);
}

/** Writes the session header once a run finishes if the agent never flushed the file. */
export function materializeTranscriptFile(sessionManager: SessionManager): void {
  const transcriptPath = sessionManager.getSessionFile();
  if (transcriptPath === undefined || existsSync(transcriptPath)) {
    return;
  }
  const header = sessionManager.getHeader();
  if (header === null) {
    return;
  }
  const lines = [header, ...sessionManager.getEntries()].map((entry) => JSON.stringify(entry)).join('\n');
  writeFileSync(transcriptPath, `${lines}\n`);
}

function buildExtensionFactories(request: ChildSessionRequest): readonly ExtensionFactory[] {
  const providerBridge = createInheritedProvidersExtension(request.ctx.modelRegistry);
  if (request.readonly) {
    return [createReadonlySubagentExtension(), providerBridge];
  }
  const mcp = request.definition.mcp ? [createMcpExtension()] : [];
  const nested = request.nestedScope === undefined ? [] : [request.createNestedExtension(request.nestedScope)];
  return [providerBridge, ...mcp, ...nested];
}

function buildToolAllowlist(definition: SubagentDefinition, nestedScope: NestedScope | undefined): readonly string[] | undefined {
  if (definition.tools.length === ZERO) {
    return undefined;
  }
  const tools = normalizeToolNames(definition.tools);
  return nestedScope === undefined ? [...tools] : [...new Set([...tools, SUBAGENT_TOOL_NAMES.task, SUBAGENT_TOOL_NAMES.awaitSubagent])];
}

const NESTED_TOOL_SET = new Set<string>([SUBAGENT_TOOL_NAMES.task, SUBAGENT_TOOL_NAMES.awaitSubagent]);

function applyInheritedTools(session: AgentSession, parentActiveTools: readonly string[], nestedScope: NestedScope | undefined, readonly: boolean): void {
  const callable = new Set(session.getCallableToolNames());
  const nested = nestedScope === undefined ? [] : [...NESTED_TOOL_SET];
  const inherited = parentActiveTools.filter((name) => (callable.has(name) || nested.includes(name)) && !NESTED_TOOL_SET.has(name) && (!readonly || !READONLY_BLOCKED_TOOLS.has(name)));
  session.setActiveToolsByName([...inherited, ...nested]);
}

export async function createChildSession(request: ChildSessionRequest, parentActiveTools: readonly string[]): Promise<ChildSession> {
  const projectTrusted = request.projectTrusted ?? false;
  const settingsManager = SettingsManager.create(request.cwd, getAgentDir(), { projectTrusted });
  const sessionDir = resolveSubagentSessionDir(request.ctx);
  const sessionManager = createChildSessionManager(request.cwd, request.existingTranscriptPath, request.isResume, sessionDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd: request.cwd,
    agentDir: getAgentDir(),
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [...buildExtensionFactories(request)],
    appendSystemPrompt: [request.definition.prompt],
  });
  await resourceLoader.reload();
  const tools = buildToolAllowlist(request.definition, request.nestedScope);
  const { session } = await createAgentSession({
    cwd: request.cwd,
    agentDir: getAgentDir(),
    settingsManager,
    ...(request.model ? { model: request.model } : {}),
    ...(request.thinking ? { thinkingLevel: request.thinking } : {}),
    ...(tools ? { tools: [...tools] } : {}),
    sessionManager,
    resourceLoader,
  });
  if (tools === undefined) {
    applyInheritedTools(session, parentActiveTools, request.nestedScope, request.readonly);
  }
  const transcriptPath = sessionManager.getSessionFile() ?? request.existingTranscriptPath;
  if (transcriptPath) {
    const parentDir = dirname(transcriptPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
  }
  return { session, sessionManager, transcriptPath };
}
