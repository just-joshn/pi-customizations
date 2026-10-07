import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRpcSession } from '../lib/rpc.mjs';

export const S50_PACKAGE = 'extensions/pi-s50';
export const S50_SCRIPTED_MODEL = 's50-scripted/s50-scripted';

// The scripted provider is written into the throwaway agent directory, so the
// repository never imports the host-supplied pi-ai package directly.
const PROVIDER_SOURCE = `import { readFileSync } from 'node:fs';

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const SCRIPT_PATH = __SCRIPT_PATH__;

function usage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function script(): { kind: 'tool'; name: string; arguments: Record<string, unknown> }[] | { kind: 'text'; text: string }[] {
  return JSON.parse(readFileSync(SCRIPT_PATH, 'utf8'));
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider('s50-scripted', {
    name: 'S50 Scripted',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'scripted-fixture-not-a-real-key',
    api: 's50-scripted',
    streamSimple(model, context) {
      const messages = context.messages || [];
      let lastUser = -1;
      messages.forEach((message: { role: string }, index: number) => {
        if (message.role === 'user') lastUser = index;
      });
      const results = messages.slice(lastUser + 1).filter((message: { role: string }) => message.role === 'toolResult');
      const steps = script();
      const step = steps[Math.min(results.length, steps.length - 1)];
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [] as unknown[], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: 'pending', timestamp: Date.now() };
      stream.push({ type: 'start', partial: message });
      let stopReason = 'stop';
      if (step.kind === 'tool') {
        const toolCall = { type: 'toolCall', id: 's50-scripted-' + results.length, name: step.name, arguments: step.arguments };
        message.content.push(toolCall);
        stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
        stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
        stopReason = 'toolUse';
      } else {
        message.content.push({ type: 'text', text: step.text });
        stream.push({ type: 'text_start', contentIndex: 0, partial: message });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: step.text, partial: message });
        stream.push({ type: 'text_end', contentIndex: 0, content: step.text, partial: message });
      }
      message.stopReason = stopReason;
      stream.push({ type: 'done', reason: stopReason, message });
      stream.end();
      return stream;
    },
    models: [{ id: 's50-scripted', name: 'S50 Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
  });
}
`;

export function s50ScriptPath(scratchDir) {
  return join(scratchDir, 's50-fixture', 'script.json');
}

export function writeS50Script(scratchDir, steps) {
  mkdirSync(join(scratchDir, 's50-fixture'), { recursive: true });
  writeFileSync(s50ScriptPath(scratchDir), `${JSON.stringify(steps, null, 2)}\n`);
  return s50ScriptPath(scratchDir);
}

export function prepareS50Fixture(scratchDir) {
  mkdirSync(join(scratchDir, 's50-fixture'), { recursive: true });
  const providerPath = join(scratchDir, 's50-fixture', 's50-scripted-provider.ts');
  writeFileSync(providerPath, PROVIDER_SOURCE.replace('__SCRIPT_PATH__', JSON.stringify(s50ScriptPath(scratchDir))));
  writeFileSync(join(scratchDir, 'settings.json'), `${JSON.stringify({ defaultModel: S50_SCRIPTED_MODEL, quietStartup: true, defaultProjectTrust: 'always' }, null, 2)}\n`);
  return providerPath;
}

export function startS50Session(context, options = {}) {
  const providerPath = prepareS50Fixture(context.scratchDir);
  context.s50Sessions ??= [];
  const index = context.s50Sessions.length + 1;
  const session = createRpcSession({
    packagePath: options.packagePath ?? join(context.repoRoot, S50_PACKAGE),
    agentDir: context.scratchDir,
    cwd: options.cwd ?? context.scratchDir,
    capturePath: options.capturePath ?? context.rawPath(options.captureName ?? `rpc-${index}.jsonl`),
    persistSession: options.persistSession ?? false,
    sessionId: options.sessionId,
    answers: options.answers,
    allowGlobalExtensions: options.allowGlobalExtensions ?? false,
    extraExtensions: options.extraExtensions ?? [providerPath],
    env: options.env,
    requestTimeoutMs: options.requestTimeoutMs,
    idleTimeoutMs: options.idleTimeoutMs,
    piBin: context.piBin,
  });
  context.s50Sessions.push(session);
  return session;
}

export async function closeS50Sessions(context) {
  const sessions = context.s50Sessions ?? [];
  context.s50Sessions = [];
  await Promise.all(sessions.map((session) => session.close().catch(() => {})));
}

export function gitInit(dir) {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=s50-drive@example.test', '-c', 'user.name=s50-drive', 'commit', '-qm', 'init'], { cwd: dir });
}

export function toolEnds(session, toolName) {
  return session.ofType('tool_execution_end').filter((record) => record.toolName === toolName);
}

export function toolStarts(session, toolName) {
  return session.ofType('tool_execution_start').filter((record) => record.toolName === toolName);
}

export function userTexts(session) {
  return session
    .ofType('message_end')
    .filter((record) => record.message?.role === 'user')
    .flatMap((record) => (Array.isArray(record.message.content) ? record.message.content : []))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text);
}

export function assistantTexts(session) {
  return session
    .ofType('message_end')
    .filter((record) => record.message?.role === 'assistant')
    .flatMap((record) => (Array.isArray(record.message.content) ? record.message.content : []))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text);
}
