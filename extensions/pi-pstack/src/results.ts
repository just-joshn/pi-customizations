import type { JsonValue } from '@earendil-works/pi-ai';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionContext, truncateTail } from '@earendil-works/pi-coding-agent';

const dataTruncationNotice = '\n\n[Output truncated. Complete data is retained for programmatic callers. Use inspection or listing tools through codemode to filter their structured results.]';

export function dataResult(details: unknown) {
  const text = JSON.stringify(details);
  const structuredContent: JsonValue = JSON.parse(text);
  const preview = truncateTail(text, { maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(dataTruncationNotice), maxLines: DEFAULT_MAX_LINES - 2 });
  return { content: [{ type: 'text' as const, text: preview.truncated ? `${preview.content}${dataTruncationNotice}` : text }], details, structuredContent };
}

export function boundedResult(text: string, details: unknown, ctx: ExtensionContext, structuredContent?: JsonValue, isError = false) {
  const transcript = ctx.sessionManager.getSessionFile();
  const notice = transcript ? `\n[Truncated. Read the complete current transcript at ${transcript}.]` : '\n[Truncated. Complete structured data is retained for programmatic callers.]';
  const preview = truncateTail(text, { maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice), maxLines: DEFAULT_MAX_LINES - 1 });
  const output = preview.truncated ? `${preview.content}${notice}` : text;
  return { content: [{ type: 'text' as const, text: output }], details, structuredContent: (structuredContent ?? details) as JsonValue, isError };
}
