import { expect, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Below vitest's 5s test timeout so a stuck settle reports itself before the runner aborts the test.
const settlementDeadlineMs = 4000;
export const model: Model<"openai-completions"> = {
  id: "scripted", name: "Scripted integration provider", provider: "pstack-integration",
  api: "openai-completions", baseUrl: "https://integration.invalid", reasoning: false,
  input: ["text"], contextWindow: 128000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export function providerFixture(capture: (request: Context) => void, next: () => ToolCall | ToolCall[] | undefined): ExtensionFactory {
  return (pi) => {
    pi.registerProvider(model.provider, {
      api: model.api, baseUrl: model.baseUrl, apiKey: "integration-only-not-a-credential",
      models: [model],
      streamSimple: (_model, context) => {
        capture(structuredClone(context));
        const call = next();
        const message: AssistantMessage = {
          role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content: call ? (Array.isArray(call) ? call : [call]) : [{ type: "text", text: "Scripted reply." }],
          stopReason: call ? "toolUse" : "stop", timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: call ? "toolUse" : "stop", message });
        stream.end(message);
        return stream;
      },
    });
  };
}

export async function closeSessions(sessions: AgentSession[], root: string) {
  try {
    const results = await Promise.allSettled(sessions.map(async session => {
      try { await session.abort(); } finally { session.dispose(); }
    }));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Fixture cleanup failed');
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
}

type FixtureOptions = { extensionOnly?: boolean; createDirectory?: (path: string) => Promise<unknown> };

export async function fixture({ extensionOnly = false, createDirectory = mkdir }: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "pstack-integration-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  try { await createDirectory(cwd); await createDirectory(agentDir); }
  catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  const requests: Context[] = [];
  const calls: (ToolCall | ToolCall[])[] = [];
  const sessions: AgentSession[] = [];
  const errors: string[] = [];
  const provider = providerFixture(request => requests.push(request), () => calls.shift());
  const settingsManager = SettingsManager.inMemory({
    packages: extensionOnly ? [] : [packageRoot], compaction: { enabled: false }, retry: { enabled: false },
  });
  async function load() {
    const loader = new DefaultResourceLoader({
      cwd, agentDir, settingsManager, extensionFactories: [provider],
      additionalExtensionPaths: [extensionOnly ? join(packageRoot, "src/index.ts") : packageRoot], noExtensions: true, noSkills: true,
      noContextFiles: true, noPromptTemplates: true, noThemes: true,
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    return loader;
  }
  async function open(manager = SessionManager.create(cwd, join(root, "sessions"))) {
    const loader = await load();
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"), modelsPath: null,
      allowModelNetwork: false, refreshOnCreate: false,
    });
    const { session } = await createAgentSession({
      cwd, agentDir, settingsManager, sessionManager: manager, resourceLoader: loader,
      modelRuntime, model, thinkingLevel: "off",
    });
    sessions.push(session);
    await session.bindExtensions({ onError: (error) => errors.push(error.error) });
    return { session, manager, loader };
  }
  return {
    root, cwd, get requests() { return structuredClone(requests); }, get errors() { return errors.slice(); }, load, open,
    calls: { push(...items: (ToolCall | ToolCall[])[]) { calls.push(...structuredClone(items)); } },
    close: () => closeSessions(sessions, root),
  };
}

export async function prompt(session: AgentSession, text: string, { startsRun = true }: { startsRun?: boolean } = {}) {
  if (!startsRun) {
    await session.prompt(text);
    return;
  }
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Pi resolves prompt() before a command's queued follow-up run starts, so the run is awaited through its event.
  const settled = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Pi did not settle the scripted request")), settlementDeadlineMs);
    unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_settled") resolve();
    });
  });
  try {
    await session.prompt(text);
    await settled;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

export function section(requests: Context[], name: string) {
  let value: string | null = null;
  for (const message of lastRequest(requests).messages) {
    if (message.role === "system" && message.sections && name in message.sections) {
      value = message.sections[name] ?? null;
    }
  }
  return value;
}

export function lastRequest(requests: Context[]) {
  const request = requests.at(-1);
  if (!request) throw new Error("the scripted provider must receive a real Pi request");
  return request;
}

export type ToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
  isError: boolean;
  usage?: { totalTokens?: number };
};

export function toolResults(session: AgentSession, name: string): ToolResultMessage[] {
  return session.messages.filter((message) => message.role === "toolResult" && message.toolName === name) as unknown as ToolResultMessage[];
}
