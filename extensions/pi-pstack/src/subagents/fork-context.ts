import { type AgentSession, buildSessionContext, type ExtensionContext, type SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './definitions.ts';

export const forkEntryType = 'pstack-fork';
export const forkBoilerplateTag = 'fork-boilerplate';

type Message = AgentSession['messages'][number];
type Entry = ReturnType<SessionManager['getEntries']>[number];

export type ForkState = Readonly<{ prompt: string; tools: readonly string[]; parentSessionId: string }>;

export function forkDirective(prompt: string): string {
  return `<${forkBoilerplateTag}>
You are a worker fork. The transcript above is the parent's history — inherited reference, not your situation. You are NOT a continuation of that agent. Execute ONE directive, then stop.
Hard rules:
- Do NOT spawn subagents with the Agent tool. The "default to forking" guidance is for the parent; you ARE the fork, execute directly.
- One shot: report once and stop. No follow-up questions, no proposed next steps, no waiting for the user.
Guidelines (your directive may override any of these):
- Stay in scope. Other forks may be handling adjacent work; if you spot something outside your directive, note it in a sentence and move on.
- Open with one line restating your task, so the parent can spot scope drift at a glance.
- Be concise — as short as the answer allows, no shorter. Plain text, no preamble, no meta-commentary.
- If you committed changes, list the paths and commit hashes in your report.
</${forkBoilerplateTag}>
Your directive: ${prompt}`;
}

export function forkWorktreeNotice(parentCwd: string, worktreePath: string): string {
  return `You've inherited the conversation context above from a parent agent working in ${parentCwd}. You are operating in an isolated git worktree at ${worktreePath} — same repository, same relative file structure, separate working copy. Paths in the inherited context refer to the parent's working directory; translate them to your worktree root. Re-read files before editing if the parent may have modified them since they appear in the context. Your changes stay in this worktree and will not affect the parent's files.`;
}

function callIds(message: Message): readonly string[] {
  return message.role === 'assistant' ? message.content.flatMap((block) => (block.type === 'toolCall' ? [block.id] : [])) : [];
}

export function repairForkMessages(messages: readonly Message[]): Message[] {
  const answered = new Set(messages.flatMap((message) => (message.role === 'toolResult' ? [message.toolCallId] : [])));
  const complete = messages.filter((message) => callIds(message).every((id) => answered.has(id)));
  const kept = new Set(complete.flatMap(callIds));
  return complete.filter((message) => message.role !== 'toolResult' || kept.has(message.toolCallId));
}

export function insideFork(messages: readonly Message[]): boolean {
  return messages.some((message) => message.role === 'user' && (typeof message.content === 'string' ? message.content : message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')).startsWith(`<${forkBoilerplateTag}>`));
}

export function seedForkTranscript(manager: SessionManager, messages: readonly Message[], state: ForkState): void {
  for (const message of messages) manager.appendMessage(message as Parameters<SessionManager['appendMessage']>[0]);
  manager.appendCustomEntry(forkEntryType, state);
}

function validState(data: unknown): data is ForkState {
  const state = data as Partial<ForkState> | null;
  return typeof state?.prompt === 'string' && state.prompt.length > 0 && Array.isArray(state.tools) && typeof state.parentSessionId === 'string';
}

export function readForkState(entries: readonly Entry[]): ForkState | undefined {
  const entry = entries.findLast((candidate) => candidate.type === 'custom' && candidate.customType === forkEntryType);
  return entry?.type === 'custom' && validState(entry.data) ? entry.data : undefined;
}

export type ForkSeed = Readonly<{ state: ForkState; messages: readonly Message[] }>;

export const forkDefinition: AgentDefinition = Object.freeze({
  agentType: 'fork',
  whenToUse: 'Inherits the parent conversation, system prompt, tools and model, and runs one directive in the background.',
  systemPrompt: '',
  source: 'built-in',
  baseDir: 'built-in',
  tools: ['*'],
  model: 'inherit',
  background: true,
});

export function buildForkSeed(ctx: ExtensionContext, activeTools: readonly string[]): ForkSeed {
  const prompt = ctx.getSystemPrompt();
  if (!prompt) throw new Error('Fork cannot start: the parent system prompt is unavailable and cannot be reconstructed.');
  const messages = repairForkMessages(buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages);
  return { state: { prompt, tools: [...activeTools], parentSessionId: ctx.sessionManager.getSessionId() }, messages };
}

export function isForkDefinition(definition: AgentDefinition | undefined): boolean {
  return definition?.agentType === 'fork' && definition.source === 'built-in';
}
