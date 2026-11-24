import { getCurrentSystemPrompt, getCurrentTools, type AssistantMessage, type Message, type ToolResultMessage, type TranscriptContext, type UserMessage } from '@earendil-works/pi-ai';
import type { ContentBlock } from './acp/protocol.ts';
import { agyToolFor, BRIDGED_TOOLS } from './tools.ts';

const ASSISTANT_MARKER = '[assistant]';
const ERROR_MARKER = '[error]';
const DO_NOT_EXECUTE = 'Do not run commands or edit files yourself.';

/** The Pi system prompt for this turn, replayed from the transcript's system messages. */
export function systemPrompt(context: TranscriptContext): string {
  return getCurrentSystemPrompt(context.messages);
}

/** Pi's available tool names. */
export function declaredToolNames(context: TranscriptContext): ReadonlySet<string> {
  return new Set(getCurrentTools(context.messages).map((tool) => tool.name));
}

/**
 * Everything the model is told rather than shown: Pi's system prompt and the tool
 * contract. The CLI brings sixty tools of its own, so the contract has to travel
 * with the instructions.
 */
export function instructions(context: TranscriptContext): string {
  const prompt = systemPrompt(context).trim();
  const contract = toolContract(declaredToolNames(context));
  return prompt === '' ? contract : `${prompt}\n\n${contract}`;
}

/** One ACP prompt that carries Pi's whole conversation. */
export function renderPrompt(context: TranscriptContext): readonly ContentBlock[] {
  return context.messages.flatMap((message) => renderMessage(message));
}

function renderMessage(message: Message): readonly ContentBlock[] {
  if (message.role === 'system') return [];
  if (message.role === 'user') return renderUser(message);
  if (message.role === 'assistant') return renderAssistant(message);
  return renderToolResult(message);
}

function renderUser(message: UserMessage): readonly ContentBlock[] {
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }];
  return message.content.map((block) => (block.type === 'text' ? { type: 'text' as const, text: block.text } : { type: 'image' as const, data: block.data, mimeType: block.mimeType }));
}

function renderAssistant(message: AssistantMessage): readonly ContentBlock[] {
  const text = joinedText(message.content);
  const calls = message.content.flatMap((block) => (block.type === 'toolCall' ? [`${block.name} ${JSON.stringify(block.arguments)}`] : []));
  // Thinking stays out: the CLI cannot replay another model's reasoning, and it only inflates the prompt.
  if (text === '' && calls.length === 0) return [];
  const lines = [ASSISTANT_MARKER, ...(text === '' ? [] : [text]), ...calls];
  return [{ type: 'text', text: lines.join('\n') }];
}

function renderToolResult(message: ToolResultMessage): readonly ContentBlock[] {
  const header = `[tool result: ${message.toolName}]`;
  const marked = message.isError ? `${header}\n${ERROR_MARKER}` : header;
  const text = joinedText(message.content);
  const body = text === '' ? marked : `${marked}\n${text}`;
  const images = message.content.flatMap((block) => (block.type === 'image' ? [{ type: 'image' as const, data: block.data, mimeType: block.mimeType }] : []));
  return [{ type: 'text', text: body }, ...images];
}

function joinedText(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  return blocks.flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : [])).join('\n');
}

/** Pi tool, then the CLI name the model must call. Built from the bridge table, not a second list. */
function toolContract(declared: ReadonlySet<string>): string {
  const lines = BRIDGED_TOOLS.flatMap((piTool) => {
    if (!declared.has(piTool)) return [];
    const agyTool = agyToolFor(piTool);
    return agyTool === undefined ? [] : [`${piTool}: ${agyTool}`];
  });
  return [DO_NOT_EXECUTE, ...lines].join('\n');
}
