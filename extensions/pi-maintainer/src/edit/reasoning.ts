/** Aider `REASONING_TAG` when a model has no `reasoning_tag`. */
export const REASONING_TAG = `thinking-content-${'7bbeb8e1441453ad999a0bbba8a46d4b'}`;

/** Aider `remove_reasoning_content`. */
export function removeReasoningContent(res: string, reasoningTag: string | null | undefined): string {
  if (!reasoningTag) return res;
  const paired = new RegExp(`<${reasoningTag}>[\\s\\S]*?</${reasoningTag}>`, 'g');
  let text = res.replace(paired, '').trim();
  const closingTag = `</${reasoningTag}>`;
  if (text.includes(closingTag)) {
    const parts = text.split(closingTag);
    text = parts.length > 1 ? (parts[1] ?? text).trim() : text;
  }
  return text;
}

/** Join assistant text blocks only. Pi `thinking` parts stay out of edit parsing. */
export function textFromAssistantContent(content: ReadonlyArray<{ readonly type: string; readonly text?: string; readonly thinking?: string }>): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

/** Aider coder path. Missing tag falls back to `REASONING_TAG`. */
export function replyTextForEdits(text: string, reasoningTag?: string | null): string {
  return removeReasoningContent(text, reasoningTag || REASONING_TAG);
}

/** Aider `simple_send_with_retries`. Null tag leaves the text unchanged. */
export function replyTextForAuxiliary(text: string, reasoningTag?: string | null): string {
  return removeReasoningContent(text, reasoningTag);
}
