import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, type SDKAgent } from '@cursor/sdk';
import { type Api, type AssistantMessageEventStream, collapseSystemMessages, getCurrentSystemPrompt, getCurrentTools, type Model, type SimpleStreamOptions, type ToolResultMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { findCursorModel } from './catalog.ts';
import { CURSOR_CONFIG } from './config.ts';
import { describeCursorError } from './errors.ts';
import { selectModel } from './models.ts';
import { CursorRun, findParkedRun } from './run.ts';
import { conversationKey, conversationOf, followUpMessage, openingMessage } from './transcript.ts';
import { PiTurn } from './turn.ts';

/** Agents between runs, keyed by the conversation Cursor holds for them. Map order is recency. */
const idleAgents = new Map<string, SDKAgent>();

function keepIdle(key: string, agent: SDKAgent): void {
  idleAgents.set(key, agent);
  for (const [oldKey, old] of idleAgents) {
    if (idleAgents.size <= CURSOR_CONFIG.maxIdleAgents) break;
    idleAgents.delete(oldKey);
    old.close();
  }
}

function takeIdle(key: string): SDKAgent | undefined {
  const agent = idleAgents.get(key);
  idleAgents.delete(key);
  return agent;
}

/**
 * Pi supplies the system prompt, history, and tools, so Cursor gets only the MCP capability group (which
 * carries Pi's tools) and an empty working directory, with no project or user settings loaded.
 */
function workspace(): string {
  const dir = join(tmpdir(), 'pi-spacex-cursor');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function trailingToolResults(messages: TranscriptContext['messages']): ToolResultMessage[] {
  const results: ToolResultMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i]?.role === 'toolResult'; i--) results.unshift(messages[i] as ToolResultMessage);
  return results;
}

async function startRun(model: Model<Api>, transcript: TranscriptContext, options: SimpleStreamOptions | undefined, turn: PiTurn): Promise<void> {
  const systemPrompt = getCurrentSystemPrompt(transcript.messages) ?? '';
  const tools = getCurrentTools(transcript.messages);
  const conversation = conversationOf(transcript.messages);
  const last = conversation.at(-1);
  const latest = last?.role === 'user' ? last : undefined;
  const history = latest ? conversation.slice(0, -1) : conversation;

  const apiKey = options?.apiKey || undefined;
  const selection = selectModel(await findCursorModel(apiKey, model.id), model.id, options?.reasoning);
  const idle = latest ? takeIdle(conversationKey(systemPrompt, tools, history)) : undefined;
  const agent = idle ?? (await Agent.create({ ...(apiKey ? { apiKey } : {}), model: selection, tools: ['mcp'], local: { cwd: workspace() } }));
  const message = idle && latest ? followUpMessage(latest) : openingMessage(systemPrompt, history, latest);

  const bridge = new CursorRun(turn, transcript.messages, {
    finished: (final, messages) => keepIdle(conversationKey(systemPrompt, tools, [...conversationOf(messages), final.message]), agent),
    failed: () => agent.close(),
  });

  try {
    const run = await agent.send(message, { model: selection, local: { customTools: bridge.customTools(tools) } });
    bridge.start(run, options?.signal);
  } catch (error) {
    agent.close();
    throw error;
  }
}

export function streamCursor(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const turn = new PiTurn(model);
  const transcript = collapseSystemMessages(context);
  const results = trailingToolResults(transcript.messages);
  const parked = results.length > 0 ? findParkedRun(results.map((r) => r.toolCallId)) : undefined;

  if (parked) {
    parked.resume(turn, transcript.messages, results, options?.signal);
    return turn.stream;
  }

  startRun(model, transcript, options, turn).catch((error: unknown) => {
    console.error('Cursor request failed:', error);
    turn.fail(describeCursorError(error), options?.signal?.aborted ?? false);
  });
  return turn.stream;
}
