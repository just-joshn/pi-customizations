import type { Usage } from '@earendil-works/pi-ai';
import { estimateTokens, type ModelRegistry } from '@earendil-works/pi-coding-agent';

/** Aider `prompts.summarize` (`aider/prompts.py:50-66`). */
export const SUMMARIZE_PROMPT = `*Briefly* summarize this partial conversation about programming.
Include less detail about older parts and more detail about the most recent messages.
Start a new paragraph every time the topic changes!

This is only part of a longer conversation so *DO NOT* conclude the summary with language like "Finally, ...". Because the conversation continues after the summary.
The summary *MUST* include the function names, libraries, packages that are being discussed.
The summary *MUST* include the filenames that are being referenced by the assistant inside the \`\`\`...\`\`\` fenced code blocks!
The summaries *MUST NOT* include \`\`\`...\`\`\` fenced code blocks!

Phrase the summary with the USER in first person, telling the ASSISTANT about the conversation.
Write *as* the user.
The user should refer to the assistant as *you*.
Start the summary with "I asked you...".
`;

/** Aider `prompts.summary_prefix` (`aider/prompts.py:68`). */
export const SUMMARY_PREFIX = 'I spoke to you previously about a number of things.\n';

/** Aider `Model.max_chat_history_tokens`: one sixteenth of the input limit, clamped to 1024-8192 (`aider/models.py:355-358`). */
export function maxChatHistoryTokens(configured: number | null, contextWindow: number): number {
  if (configured !== null) return configured;
  return Math.min(Math.max(contextWindow / 16, 1024), 8192);
}

/** `ChatSummary.too_big`: summarization starts only once the history exceeds the soft limit (`aider/history.py:15-18`). */
export function historyOverBudget(historyTokens: number, budget: number): boolean {
  return historyTokens > budget;
}

export type ProjectedMessage = Parameters<typeof estimateTokens>[0];

/** Total tokens of the projected history, counted one message at a time like `ChatSummary.tokenize`. */
export function historyTokens(messages: readonly ProjectedMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message), 0);
}

type SummaryContent = { readonly type: string; readonly text?: string };
type SummaryMessage = { readonly role: string; readonly content: string | readonly SummaryContent[] };

function messageText(message: SummaryMessage): string {
  return typeof message.content === 'string' ? message.content : message.content.map((block) => block.text ?? '').join('');
}

/** `ChatSummary.summarize_all` input text: user and assistant turns only, each under a `# ROLE` heading (`aider/history.py:98-107`). */
export function summaryConversationText(messages: readonly SummaryMessage[]): string {
  let content = '';
  for (const message of messages) {
    const role = message.role.toUpperCase();
    if (role !== 'USER' && role !== 'ASSISTANT') continue;
    content += `# ${role}\n${messageText(message)}`;
    if (!content.endsWith('\n')) content += '\n';
  }
  return content;
}

export interface HistoryModelRef {
  readonly provider: string;
  readonly id: string;
}

export interface HistorySummaryOptions {
  readonly registry: Pick<ModelRegistry, 'find' | 'complete'>;
  /** Aider's `coder.main_model`, read at call time. */
  readonly main: () => HistoryModelRef | null;
  /** Aider's `--weak-model`, or null when unset so the main model fills both slots. */
  readonly weak: () => HistoryModelRef | null;
  /** Aider prints one line per failing model (`aider/history.py:120-121`). */
  readonly error?: (text: string) => void;
}

export interface HistorySummaryResult {
  readonly text: string;
  readonly usage?: Usage;
}

/**
 * `ChatSummary.summarize_all`: weak model first, then main (`aider/history.py:109-123`), and the
 * returned message is `summary_prefix + summary`. Returns null when every model fails.
 */
export async function summarizeHistory(options: HistorySummaryOptions, conversation: string, signal?: AbortSignal): Promise<HistorySummaryResult | null> {
  const main = options.main();
  if (!main) return null;
  const timestamp = Date.now();
  const messages = [
    { role: 'system' as const, content: SUMMARIZE_PROMPT, timestamp },
    { role: 'user' as const, content: conversation, timestamp },
  ];
  for (const reference of [options.weak() ?? main, main]) {
    const model = options.registry.find(reference.provider, reference.id);
    if (!model || model.api === 'pi-virtual') continue;
    signal?.throwIfAborted();
    try {
      const response = await options.registry.complete(model, { messages }, signal ? { signal } : {});
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text.trim()) return { text: `${SUMMARY_PREFIX}${text}`, usage: response.usage };
    } catch (error) {
      if (signal?.aborted) throw error;
      options.error?.(`Summarization failed for model ${reference.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
}
