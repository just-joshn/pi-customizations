/**
 * Fork subagents: a child that continues a copy of the parent session, so it starts on the parent's exact prompt prefix
 * and reads the parent's prompt cache instead of paying for a cold start.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';
import type { AgentConfig } from './agents.ts';

export const FORK_AGENT_NAME = 'fork';
export const FORK_MAX_TURNS = 200;
export const SUBAGENT_IS_FORK_ENV = 'PI_SUBAGENT_IS_FORK';
export const SUBAGENT_FORK_DISABLED_ENV = 'PI_SUBAGENT_FORK_DISABLED';
export const FORK_BOILERPLATE_TAG = '<fork-boilerplate>';
export const FORK_STARTED_TEXT = 'Forked subagent started to handle this call.';
export const FORK_PARENT_CALL_TEXT = 'Handled by parent session.';

const FORK_BOILERPLATE_CLOSE = '</fork-boilerplate>';
const FORK_NOTICE = 'You are a forked subagent of the parent session. Do not spawn another fork.';
const SESSION_VERSION = 3;
const ENTRY_ID_LENGTH = 8;
const SESSION_FILE_NAME = 'session.jsonl';

/** The built-in fork agent. It is never discovered from disk, and it adds nothing to the parent's system prompt. */
export const FORK_AGENT_CONFIG: AgentConfig = {
  name: FORK_AGENT_NAME,
  description: 'Fork the current session with prompt-cache prefix sharing',
  maxTurns: FORK_MAX_TURNS,
  systemPrompt: '',
  source: 'package',
  filePath: '',
};

/** What a fork needs to know about the session that called it. */
export interface ParentSession {
  file: string | undefined;
  cwd: string;
  /** The id of the `subagent` call that started the fork, which the copied transcript must close. */
  toolCallId: string | undefined;
}

/** The slice of Pi's extension context a fork reads. Test hosts and old Pi versions may leave any of it out. */
export interface ForkContext {
  cwd: string;
  sessionManager?: { getSessionFile?: () => string | undefined; getBranch?: () => unknown[] } | undefined;
}

export const isForkAgent = (agent: AgentConfig): boolean => agent === FORK_AGENT_CONFIG;

export const parentSessionOf = (ctx: ForkContext, toolCallId: string | undefined): ParentSession => ({ file: ctx.sessionManager?.getSessionFile?.(), cwd: ctx.cwd, toolCallId });

/** The task a fork is sent: the notice that stops it forking again, then the task. */
export const formatForkTask = (task: string): string => `${FORK_BOILERPLATE_TAG}\n${FORK_NOTICE}\n${FORK_BOILERPLATE_CLOSE}\n\nTask: ${task}`;

const TextBlock = z.looseObject({ type: z.string(), text: z.string().optional() });
const BranchUserMessage = z.looseObject({
  type: z.literal('message'),
  message: z.looseObject({ role: z.literal('user'), content: z.union([z.string(), z.array(TextBlock)]) }),
});

const startsWithBoilerplate = (text: string | undefined): boolean => text?.startsWith(FORK_BOILERPLATE_TAG) === true;

/** True for a user message whose text opens with the fork boilerplate, which is how a fork's task starts. Quotes elsewhere do not count. */
function isForkTask(entry: unknown): boolean {
  const content = BranchUserMessage.safeParse(entry).data?.message.content;
  if (content === undefined) return false;
  return typeof content === 'string' ? startsWithBoilerplate(content) : content.some((block) => block.type === 'text' && startsWithBoilerplate(block.text));
}

/** Why a fork must not start, or undefined when it may. */
export function forkRefusal(env: NodeJS.ProcessEnv, ctx: ForkContext): string | undefined {
  const disabled = env[SUBAGENT_FORK_DISABLED_ENV];
  if (disabled === '1' || disabled === 'true') return `Fork subagents are disabled (${SUBAGENT_FORK_DISABLED_ENV}). Use a named agent instead.`;
  const branch = ctx.sessionManager?.getBranch?.() ?? [];
  if (env[SUBAGENT_IS_FORK_ENV] === '1' || branch.some(isForkTask)) return 'A forked subagent cannot fork again. Do the work here.';
  return undefined;
}

const ToolCallBlock = z.looseObject({ type: z.literal('toolCall'), id: z.string(), name: z.string() });
const SessionEntry = z.looseObject({
  type: z.string().optional(),
  id: z.string().optional(),
  message: z.looseObject({ role: z.string().optional(), content: z.unknown().optional(), toolCallId: z.string().optional() }).optional(),
});
type ParsedEntry = z.infer<typeof SessionEntry>;

/** A line that is not JSON reads as no entry, so one corrupt line never stops a fork. */
function parseEntry(line: string): ParsedEntry | undefined {
  try {
    return SessionEntry.safeParse(JSON.parse(line)).data;
  } catch {
    return undefined;
  }
}

const toolCallsOf = (entry: ParsedEntry): z.infer<typeof ToolCallBlock>[] =>
  (z.array(z.unknown()).safeParse(entry.message?.content).data ?? []).flatMap((block) => {
    const call = ToolCallBlock.safeParse(block).data;
    return call ? [call] : [];
  });

function toolResultLine(call: z.infer<typeof ToolCallBlock>, parentId: string | null, id: string, text: string): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text }], isError: false, timestamp: Date.now() },
  });
}

/** The tool calls of the assistant message that ends the transcript, less those the tool results after it already answer. */
function openToolCalls(entries: readonly (ParsedEntry | undefined)[]): z.infer<typeof ToolCallBlock>[] {
  const tail = entries.filter((entry): entry is ParsedEntry => entry?.type === 'message').toReversed();
  const assistantIndex = tail.findIndex((entry) => entry.message?.role !== 'toolResult');
  const assistant = tail[assistantIndex];
  if (assistant?.message?.role !== 'assistant') return [];
  const answered = new Set(tail.slice(0, assistantIndex).map((entry) => entry.message?.toolCallId));
  return toolCallsOf(assistant).filter((call) => !answered.has(call.id));
}

/** The transcript lines, with a synthetic result for every tool call the last assistant message left open. */
export function closeOpenToolCalls(lines: readonly string[], toolCallId: string | undefined): string[] {
  const entries = lines.map(parseEntry);
  const calls = openToolCalls(entries);
  const leafId = entries.findLast((entry) => entry?.id !== undefined)?.id ?? null;
  const results = calls.reduce<{ parentId: string | null; lines: string[] }>(
    (acc, call) => {
      const id = randomUUID().slice(0, ENTRY_ID_LENGTH);
      const text = call.id === toolCallId ? FORK_STARTED_TEXT : FORK_PARENT_CALL_TEXT;
      return { parentId: id, lines: [...acc.lines, toolResultLine(call, acc.parentId, id, text)] };
    },
    { parentId: leafId, lines: [] },
  );
  return [...lines, ...results.lines];
}

function readTranscript(parent: ParentSession): string[] {
  if (parent.file && fs.existsSync(parent.file))
    return fs
      .readFileSync(parent.file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && parseEntry(line) !== undefined);
  return [JSON.stringify({ type: 'session', version: SESSION_VERSION, id: randomUUID(), timestamp: new Date().toISOString(), cwd: parent.cwd })];
}

/** Copies the parent's session into the worker's run directory, for the fork to continue from, and returns the file. */
export function writeForkSession(parent: ParentSession, runDir: string): string {
  const sessionFile = path.join(runDir, SESSION_FILE_NAME);
  fs.writeFileSync(sessionFile, `${closeOpenToolCalls(readTranscript(parent), parent.toolCallId).join('\n')}\n`);
  return sessionFile;
}
