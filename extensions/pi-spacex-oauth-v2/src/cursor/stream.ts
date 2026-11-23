import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from '@cursor/sdk';
import { type Api, type AssistantMessageEventStream, collapseSystemMessages, getCurrentSystemPrompt, getCurrentTools, type Model, type SimpleStreamOptions, type ToolResultMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { keepIdle, takeIdle } from './agent-pool.ts';
import { lookupCursorModel } from './catalog.ts';
import { describeCursorError } from './errors.ts';
import { selectModel } from './models.ts';
import { createCursorRun, findParkedRun } from './run.ts';
import { conversationKey, conversationOf, followUpMessage, openingMessage } from './transcript.ts';
import { createPiTurn, type PiTurn } from './turn.ts';

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
  const trailing = messages.toReversed().findIndex((m) => m.role !== 'toolResult');
  const count = trailing === -1 ? messages.length : trailing;
  return messages.slice(messages.length - count).filter((m): m is ToolResultMessage => m.role === 'toolResult');
}

async function startRun(model: Model<Api>, transcript: TranscriptContext, options: SimpleStreamOptions | undefined, turn: PiTurn): Promise<void> {
  const systemPrompt = getCurrentSystemPrompt(transcript.messages) ?? '';
  const tools = getCurrentTools(transcript.messages);
  const conversation = conversationOf(transcript.messages);
  const last = conversation.at(-1);
  const latest = last?.role === 'user' ? last : undefined;
  const history = latest ? conversation.slice(0, -1) : conversation;

  const apiKey = options?.apiKey || undefined;
  const selection = await selectModel(model.id, options?.reasoning, (sdkId) => lookupCursorModel(apiKey, sdkId));
  const keyFor = (messages: typeof history) => conversationKey(apiKey, systemPrompt, tools, messages);
  const idle = latest ? takeIdle(keyFor(history)) : undefined;
  const agent = idle ?? (await Agent.create({ ...(apiKey ? { apiKey } : {}), model: selection, tools: ['mcp'], local: { cwd: workspace() } }));
  const message = idle && latest ? followUpMessage(latest) : openingMessage(systemPrompt, history, latest);

  const bridge = createCursorRun(turn, transcript.messages, {
    finished: (final, messages) => keepIdle(keyFor([...conversationOf(messages), final.message]), agent),
    failed: () => agent.close(),
  });

  const send = async () => agent.send(message, { model: selection, local: { customTools: bridge.customTools(tools) } });
  await send().then(
    (run) => bridge.start(run, options?.signal),
    (error: unknown) => {
      agent.close();
      throw error;
    },
  );
}

export function streamCursor(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const turn = createPiTurn(model);
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
