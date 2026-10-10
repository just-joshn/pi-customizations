import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AssistantMessage, createAssistantMessageEventStream, type JsonObject, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { type AgentSession, createAgentSession, DefaultResourceLoader, type ExtensionFactory, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { onTestFinished } from 'vitest';

export const scriptedModel: Model<string> = {
  provider: 'maintainer-test',
  id: 'scripted',
  name: 'Scripted',
  api: 'maintainer-scripted',
  baseUrl: 'https://test.invalid',
  reasoning: false,
  input: ['text', 'image'],
  contextWindow: 128000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export const zeroUsage = (): AssistantMessage['usage'] => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

export interface ScriptedReply {
  readonly text: string;
  readonly stopReason?: 'stop' | 'length' | 'error' | 'aborted' | 'toolUse';
  readonly tool?: { readonly name: string; readonly id: string; readonly arguments: JsonObject };
  readonly wait?: (signal: AbortSignal | undefined) => Promise<void>;
}

function scriptedStream(model: Model<string>, context: TranscriptContext, options: SimpleStreamOptions | undefined, reply: ScriptedReply, capture: (context: TranscriptContext) => void) {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    const initial: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [], usage: zeroUsage(), timestamp: Date.now(), stopReason: 'pending' };
    try {
      await options?.onPayload?.(context, model);
      capture(structuredClone(context));
      await options?.onResponse?.({ status: 200, headers: {} }, model);
      stream.push({ type: 'start', partial: initial });
      await reply.wait?.(options?.signal);
      const content: AssistantMessage['content'] = [{ type: 'text', text: reply.text }, ...(reply.tool ? [{ type: 'toolCall', ...reply.tool } satisfies AssistantMessage['content'][number]] : [])];
      const stopReason = options?.signal?.aborted ? 'aborted' : (reply.stopReason ?? 'stop');
      const message: AssistantMessage = { ...initial, content, stopReason };
      stream.push({ type: 'text_start', contentIndex: 0, partial: message });
      stream.push({ type: 'text_delta', contentIndex: 0, delta: reply.text, partial: message });
      stream.push({ type: 'text_end', contentIndex: 0, content: reply.text, partial: message });
      if (stopReason === 'error' || stopReason === 'aborted') stream.push({ type: 'error', reason: stopReason, error: { ...message, errorMessage: 'Scripted interruption' } });
      else stream.push({ type: 'done', reason: stopReason, message });
      stream.end();
    } catch (error) {
      stream.push({ type: 'error', reason: 'error', error: { ...initial, stopReason: 'error', errorMessage: error instanceof Error ? error.message : String(error) } });
      stream.end();
    }
  })();
  return stream;
}

export async function piSessionFixture(options: { readonly extension: ExtensionFactory; readonly before?: readonly ExtensionFactory[]; readonly after?: readonly ExtensionFactory[]; readonly config?: string }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'maintainer-sdk-')));
  const cwd = join(root, 'workspace');
  const agentDir = join(root, 'agent');
  await mkdir(cwd);
  await mkdir(agentDir);
  if (options.config) await writeFile(join(cwd, '.pi-maintainer.conf.yml'), options.config);
  const requests: TranscriptContext[] = [];
  const replies: ScriptedReply[] = [];
  const sessions: AgentSession[] = [];
  const errors: string[] = [];
  const provider: ExtensionFactory = (pi) =>
    pi.registerProvider(scriptedModel.provider, {
      apiKey: 'integration-only-not-a-secret',
      api: scriptedModel.api,
      baseUrl: scriptedModel.baseUrl,
      models: [scriptedModel],
      streamSimple: (model, context, streamOptions) => scriptedStream(model, context, streamOptions, replies.shift() ?? { text: '' }, (request) => requests.push(request)),
    });
  onTestFinished(async () => {
    for (const session of sessions) {
      await session.abort();
      session.dispose();
    }
    await rm(root, { recursive: true, force: true });
  });
  const open = async (manager = SessionManager.create(cwd, join(root, 'sessions'))) => {
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [provider, ...(options.before ?? []), options.extension, ...(options.after ?? [])],
    });
    await loader.reload();
    for (const problem of loader.getExtensions().errors) errors.push(problem.error);
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, modelsStorePath: join(agentDir, 'models-cache.json'), refreshOnCreate: false });
    const { session } = await createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager, modelRuntime, model: scriptedModel, thinkingLevel: 'off', sessionManager: manager });
    sessions.push(session);
    await session.bindExtensions({ mode: 'print', onError: (error) => errors.push(error.error) });
    return session;
  };
  return { root, cwd, agentDir, requests, replies, errors, open };
}

export async function promptAndSettle(session: AgentSession, text: string): Promise<void> {
  let settled = false;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'agent_settled') settled = true;
  });
  try {
    await session.prompt(text);
    if (!settled) throw new Error('prompt resolved before agent_settled');
  } finally {
    unsubscribe();
  }
}
