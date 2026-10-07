import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Shared fixture for the caveman user-perspective drives. It installs a scripted
// provider into the throwaway agent dir so every turn is deterministic and no
// model inference or network call happens. The provider answers from the
// transcript and from the system-prompt sections Pi actually handed it.

export const CAVEMAN_PACKAGE = 'extensions/pi-caveman';
export const CAVEMAN_SCRIPTED_MODELS = ['smoke', 'alt-investigator', 'alt-builder', 'alt-reviewer'];

export const CAVEMAN_COMPRESS_SOURCE = [
  '# Notes',
  '',
  'Make sure to always run the test suite before pushing. This is important because it catches bugs early.',
  '',
  'The gateway config lives at config/gateway.yaml.',
  '',
  'ZEBRA_CAVEMAN_SOURCE',
  '',
].join('\n');

export const CAVEMAN_COMPRESS_SOURCE_NO_FINAL_NEWLINE = CAVEMAN_COMPRESS_SOURCE.replace(/\n$/, '');

const PROVIDER_SOURCE = String.raw`import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const CREW_MARKERS = {
  investigator: 'Lead with answer',
  builder: 'No drive-by refactors',
  reviewer: 'Findings only',
};

const COMPRESSED_NOTES = '# Notes\n\nRun tests before push. Gateway config: config/gateway.yaml.\n';

function usage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function textOf(message) {
  if (typeof message.content === 'string') return message.content;
  const parts = Array.isArray(message.content) ? message.content : [];
  let text = '';
  for (const part of parts) if (part && part.type === 'text' && typeof part.text === 'string') text += part.text + '\n';
  return text;
}

function systemText(messages, systemPrompt) {
  let text = systemPrompt || '';
  for (const message of messages) {
    if (message.role !== 'system' || !message.sections) continue;
    for (const value of Object.values(message.sections)) if (typeof value === 'string') text += '\n' + value;
  }
  return text;
}

function emit(stream, model, content, stopReason) {
  const message = { role: 'assistant', content: content, api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: stopReason, timestamp: Date.now() };
  stream.push({ type: 'start', partial: message });
  for (let index = 0; index < content.length; index++) {
    const part = content[index];
    if (part.type === 'text') {
      stream.push({ type: 'text_start', contentIndex: index, partial: message });
      stream.push({ type: 'text_delta', contentIndex: index, delta: part.text, partial: message });
      stream.push({ type: 'text_end', contentIndex: index, content: part.text, partial: message });
    } else {
      stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
      stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: part, partial: message });
    }
  }
  stream.push({ type: 'done', reason: stopReason, message: message });
  stream.end();
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider('caveman-scripted', {
    name: 'Caveman Scripted',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'scripted-fixture-not-a-real-key',
    api: 'caveman-scripted',
    streamSimple(model, context) {
      const messages = context.messages || [];
      const transcript = messages.map(textOf).join('\n');
      const system = systemText(messages, context.systemPrompt);
      const results = messages.filter((message) => message.role === 'toolResult');
      const called = (name) => results.some((message) => message.toolName === name);
      const stream = createAssistantMessageEventStream();
      let content = [];
      let stopReason = 'stop';
      const role = Object.keys(CREW_MARKERS).find((name) => system.includes(CREW_MARKERS[name]));
      const crewMatches = [...transcript.matchAll(/CAVEMAN_CALL_CAVECREW_(\d+) ROLE=(\w+)/g)];
      const crewLast = crewMatches.at(-1);
      const crewSquad = results.filter((message) => message.toolName === 'cavecrew').length;
      const crewPending = crewLast !== undefined && crewSquad < Number(crewLast[1]);
      const compressMatches = [...transcript.matchAll(/CAVEMAN_CALL_COMPRESS_(\d+) (\S+)/g)];
      const compressLast = compressMatches.at(-1);
      const compressSquad = results.filter((message) => message.toolName === 'caveman_compress').length;
      const compressPending = compressLast !== undefined && compressSquad < Number(compressLast[1]);
      if (role) {
        content = [{ type: 'text', text: 'CREW_ROLE_SEEN=' + role + ' TASK_SEEN=' + transcript.includes('ZEBRA_CAVECREW_TASK') + ' MODEL_SEEN=' + model.id }];
      } else if (crewPending) {
        content = [{ type: 'toolCall', id: 'fixture-crew-' + crewLast[1], name: 'cavecrew', arguments: { agent: crewLast[2], task: 'Locate ZEBRA_CAVECREW_TASK.' } }];
        stopReason = 'toolUse';
      } else if (compressPending) {
        content = [{ type: 'toolCall', id: 'fixture-compress-' + compressLast[1], name: 'caveman_compress', arguments: { path: compressLast[2] } }];
        stopReason = 'toolUse';
      } else if (transcript.includes('CAVEMAN_CALL_RETRIEVE') && !called('caveman_retrieve')) {
        content = [{ type: 'toolCall', id: 'fixture-retrieve', name: 'caveman_retrieve', arguments: { recovery_handle: 'ccr_fixture_handle' } }];
        stopReason = 'toolUse';
      } else if (transcript.includes('ZEBRA_CAVEMAN_SOURCE')) {
        content = [{ type: 'text', text: COMPRESSED_NOTES }];
      } else {
        const match = system.match(/CAVEMAN MODE ACTIVE — mode: ([a-z]+)/);
        content = [{ type: 'text', text: 'SCRIPTED_ACK ruleset=' + (match ? match[1] : 'none') + ' reinforcement=' + transcript.includes('CAVEMAN MODE ACTIVE (') }];
      }
      emit(stream, model, content, stopReason);
      return stream;
    },
    models: [
      { id: 'smoke', name: 'Caveman Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
      { id: 'alt-investigator', name: 'Caveman Scripted Alt Investigator', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
      { id: 'alt-builder', name: 'Caveman Scripted Alt Builder', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
      { id: 'alt-reviewer', name: 'Caveman Scripted Alt Reviewer', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
    ],
  });
}
`;

import { createRpcSession } from '../lib/rpc.mjs';

export function prepareFixture(scratchDir) {
  mkdirSync(join(scratchDir, 'extensions'), { recursive: true });
  writeFileSync(join(scratchDir, 'extensions', 'caveman-scripted.ts'), PROVIDER_SOURCE);
  writeFileSync(join(scratchDir, 'settings.json'), `${JSON.stringify({ defaultModel: 'caveman-scripted/smoke', quietStartup: true }, null, 2)}\n`);
  return scratchDir;
}

export function baseCavemanEnv(scratchDir) {
  return {
    HOME: join(scratchDir, 'home'),
    XDG_CONFIG_HOME: join(scratchDir, 'xdg'),
    XDG_DATA_HOME: join(scratchDir, 'data'),
    CAVEMAN_HOME: join(scratchDir, 'caveman-home'),
    CAVEMAN_DEFAULT_MODE: undefined,
    CAVEMAN_PI_HOOK_CMD: undefined,
    CAVEMAN_PI_DEBUG: undefined,
    PI_TELEMETRY: undefined,
    PI_OFFLINE: '1',
  };
}

// The RPC driver copies the environment at spawn time, so mutation here reaches
// the child without leaking into the next session. rpc.mjs disables global
// extension discovery, so the scripted provider is loaded explicitly.
export function startCavemanSession(context, environment = {}, options = {}) {
  prepareFixture(context.scratchDir);
  const providerPath = join(context.scratchDir, 'extensions', 'caveman-scripted.ts');
  context.cavemanSessionCount = (context.cavemanSessionCount ?? 0) + 1;
  const capturePath = options.capturePath ?? context.rawPath(options.captureName ?? `rpc-${context.cavemanSessionCount}.jsonl`);
  const saved = new Map();
  for (const [name, value] of Object.entries(environment)) {
    saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  let session;
  try {
    session = createRpcSession({
      packagePath: options.packagePath,
      agentDir: context.scratchDir,
      cwd: options.cwd ?? context.scratchDir,
      capturePath,
      persistSession: options.persistSession ?? false,
      sessionId: options.sessionId,
      extraExtensions: [providerPath],
      piBin: context.piBin,
    });
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  context.cavemanSessions = [...(context.cavemanSessions ?? []), session];
  return session;
}

export async function closeCavemanSessions(context) {
  const sessions = context.cavemanSessions ?? [];
  context.cavemanSessions = [];
  await Promise.all(sessions.map((session) => session.close().catch(() => {})));
}

export async function waitUntil(check, { timeoutMs = 20000, description = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined && value !== false && value !== null) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function stripAnsi(text) {
  return typeof text === 'string' ? text.replace(ANSI_PATTERN, '') : '';
}

export function statusRecord(session) {
  return session.uiRequests.filter((request) => request.method === 'setStatus' && request.statusKey === 'caveman').at(-1);
}

export function badgeText(session) {
  const record = statusRecord(session);
  if (!record || record.statusText === undefined) return null;
  return stripAnsi(record.statusText);
}

export function badgeAnsi(session) {
  const record = statusRecord(session);
  return typeof record?.statusText === 'string' ? record.statusText : '';
}

export async function waitForBadge(session, expected, description = `caveman badge ${expected}`) {
  await waitUntil(() => badgeText(session) === expected, { description });
  return expected;
}

export function notices(session) {
  return session.notifications.map((record) => ({ message: record.message, level: record.notifyType ?? 'info' }));
}

export function noticeMessages(session) {
  return notices(session).map((entry) => entry.message);
}

export function customMessages(session, customType) {
  return session.customMessages.filter((message) => message.customType === customType);
}

export function customMessageText(session, customType) {
  const message = customMessages(session, customType).at(-1);
  return typeof message?.content === 'string' ? message.content : '';
}

export function systemSections(session, section) {
  return session
    .ofType('message_end')
    .filter((record) => record.message?.role === 'system' && typeof record.message.sections?.[section] === 'string')
    .map((record) => record.message.sections[section]);
}

export function toolEnds(session, toolName) {
  return session.ofType('tool_execution_end').filter((record) => record.toolName === toolName);
}

export function assistantTexts(session) {
  return session
    .ofType('message_end')
    .filter((record) => record.message?.role === 'assistant')
    .flatMap((record) => (Array.isArray(record.message.content) ? record.message.content : []))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text);
}

export function userTexts(session) {
  return session
    .ofType('message_end')
    .filter((record) => record.message?.role === 'user')
    .flatMap((record) => (Array.isArray(record.message.content) ? record.message.content : []))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text);
}

export function writeRaw(context, name, value) {
  const path = context.rawPath(name);
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
