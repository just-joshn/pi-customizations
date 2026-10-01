import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type AssistantMessage, type Context, createAssistantMessageEventStream, type Model, type ToolCall } from '@earendil-works/pi-ai';
import { type AgentSession, createAgentSession, DefaultResourceLoader, type ExtensionFactory, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { expect, vi } from 'vitest';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Below vitest's 5s test timeout so a stuck settle reports itself before the runner aborts the test.
const settlementDeadlineMs = 4000;
export const model: Model<'openai-completions'> = {
  id: 'scripted',
  name: 'Scripted integration provider',
  provider: 'pstack-integration',
  api: 'openai-completions',
  baseUrl: 'https://integration.invalid',
  reasoning: false,
  input: ['text'],
  contextWindow: 128000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export function providerFixture(capture: (request: Context) => void, next: () => ToolCall | ToolCall[] | undefined, usage?: AssistantMessage['usage']): ExtensionFactory {
  return (pi) => {
    pi.registerProvider(model.provider, {
      api: model.api,
      baseUrl: model.baseUrl,
      apiKey: 'integration-only-not-a-credential',
      models: [model],
      streamSimple: (_model, context) => {
        capture(structuredClone(context));
        const call = next();
        const message: AssistantMessage = {
          role: 'assistant',
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: call ? (Array.isArray(call) ? call : [call]) : [{ type: 'text', text: 'Scripted reply.' }],
          stopReason: call ? 'toolUse' : 'stop',
          timestamp: Date.now(),
          usage: usage ? structuredClone(usage) : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'done', reason: call ? 'toolUse' : 'stop', message });
        stream.end(message);
        return stream;
      },
    });
  };
}

export async function closeSessions(sessions: AgentSession[], root: string) {
  try {
    const results = await Promise.allSettled(
      sessions.map(async (session) => {
        try {
          await session.abort();
        } finally {
          session.dispose();
        }
      }),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Fixture cleanup failed',
      );
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}

type FixtureOptions = {
  usage?: AssistantMessage['usage'];
  extensionOnly?: boolean;
  extensionDisabled?: boolean;
  createDirectory?: (path: string) => Promise<unknown>;
  includeNativePromptTemplates?: boolean;
  extensionFactories?: ExtensionFactory[];
};

async function setupDirs(root: string, cwd: string, agentDir: string, createDirectory: (path: string) => Promise<unknown>) {
  try {
    await createDirectory(cwd);
    await createDirectory(agentDir);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function loadFixtureLoader(cwd: string, agentDir: string, settingsManager: SettingsManager, extensionFactories: ExtensionFactory[], extensionOnly: boolean, includeNativePromptTemplates: boolean, extensionDisabled: boolean) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories,
    additionalExtensionPaths: extensionDisabled ? [] : [extensionOnly || includeNativePromptTemplates ? join(packageRoot, 'src/index.ts') : packageRoot],
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: !includeNativePromptTemplates,
    noThemes: true,
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  return loader;
}

async function openFixtureSession(opts: { cwd: string; agentDir: string; settingsManager: SettingsManager; loader: DefaultResourceLoader; manager: SessionManager; sessions: AgentSession[]; errors: string[] }) {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(opts.agentDir, 'auth.json'),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager: opts.settingsManager,
    sessionManager: opts.manager,
    resourceLoader: opts.loader,
    modelRuntime,
    model,
    thinkingLevel: 'off',
  });
  opts.sessions.push(session);
  await session.bindExtensions({ onError: (error) => opts.errors.push(error.error) });
  return { session, manager: opts.manager, loader: opts.loader };
}

export async function fixture({ usage, extensionOnly = false, extensionDisabled = false, createDirectory = mkdir, includeNativePromptTemplates = false, extensionFactories = [] }: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pstack-integration-'));
  const cwd = join(root, 'workspace');
  const agentDir = join(root, 'agent');
  await setupDirs(root, cwd, agentDir, createDirectory);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  const requests: Context[] = [];
  const calls: (ToolCall | ToolCall[])[] = [];
  const sessions: AgentSession[] = [];
  const errors: string[] = [];
  const fixtureFactories = [
    providerFixture(
      (request) => requests.push(request),
      () => calls.shift(),
      usage,
    ),
    ...extensionFactories,
  ];
  const settingsManager = SettingsManager.inMemory({
    packages: extensionOnly ? [] : [packageRoot],
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  settingsManager.setProjectTrusted(includeNativePromptTemplates);
  const load = () => loadFixtureLoader(cwd, agentDir, settingsManager, fixtureFactories, extensionOnly, includeNativePromptTemplates, extensionDisabled);
  const open = async (manager = SessionManager.create(cwd, join(root, 'sessions'))) => {
    const loader = await load();
    return openFixtureSession({ cwd, agentDir, settingsManager, loader, manager, sessions, errors });
  };
  return {
    root,
    cwd,
    get requests() {
      return structuredClone(requests);
    },
    get errors() {
      return errors.slice();
    },
    load,
    open,
    calls: {
      push(...items: (ToolCall | ToolCall[])[]) {
        calls.push(...structuredClone(items));
      },
    },
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
    timer = setTimeout(() => reject(new Error('Pi did not settle the scripted request')), settlementDeadlineMs);
    unsubscribe = session.subscribe((event) => {
      if (event.type === 'agent_settled') resolve();
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
    if (message.role === 'system' && message.sections && name in message.sections) {
      value = message.sections[name] ?? null;
    }
  }
  return value;
}

export function lastRequest(requests: Context[]) {
  const request = requests.at(-1);
  if (!request) throw new Error('the scripted provider must receive a real Pi request');
  return request;
}

export type ToolResultMessage = {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
  isError: boolean;
  usage?: { totalTokens?: number };
};

export function toolResults(session: AgentSession, name: string): ToolResultMessage[] {
  return session.messages.filter((message) => message.role === 'toolResult' && message.toolName === name) as unknown as ToolResultMessage[];
}

export const KIT_SKILL_NAMES = [
  'check-compiler-errors',
  'control-cli',
  'control-ui',
  'deslop',
  'fix-ci',
  'fix-merge-conflicts',
  'get-pr-comments',
  'loop-on-ci',
  'make-pr-easy-to-review',
  'new-branch-and-pr',
  'pr-review-canvas',
  'review-and-ship',
  'run-smoke-tests',
  'thermo-nuclear-code-quality-review',
  'verify-this',
  'weekly-review',
  'what-did-i-get-done',
  'workflow-from-chats',
];

export const DIALOG_TEST_QUESTIONS = [
  { id: 'multi', prompt: 'Choose several', allow_multiple: true, options: [{ id: 'one', label: 'First' }] },
  { id: 'single', prompt: 'Choose one', options: [{ id: 'one', label: 'First' }] },
  { id: 'text', prompt: 'Describe your preference' },
  { id: 'cancel', prompt: 'Confirm the next action' },
];

export const INVALID_QUESTION_CASES = [
  null,
  undefined,
  'wrong type',
  [],
  Array.from({ length: 5 }, (_, index) => ({ id: `q-${index}`, prompt: 'Question' })),
  [
    { id: 'same', prompt: 'First' },
    { id: 'same', prompt: 'Second' },
  ],
  [{ id: '', prompt: 'Question' }],
  [{ id: 'blank', prompt: ' ' }],
  [
    {
      id: 'pick',
      prompt: 'Choose',
      options: [
        { id: 'same', label: 'A' },
        { id: 'same', label: 'B' },
      ],
    },
  ],
  [{ id: 'pick', prompt: 'Choose', options: [{ id: '', label: 'A' }] }],
  [
    {
      id: 'pick',
      prompt: 'Choose',
      options: [
        { id: 'b] [c', label: 'a' },
        { id: 'c', label: 'a [b]' },
      ],
    },
  ],
];
