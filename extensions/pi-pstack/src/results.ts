import type { JsonValue } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

const maxResultCharacters = 48000;

export function boundedResult(text: string, details: unknown, ctx: ExtensionContext, structuredContent?: JsonValue, isError = false) {
  const output = text.length > maxResultCharacters ? `${text.slice(0, maxResultCharacters)}\n[Truncated. Full current transcript: ${ctx.sessionManager.getSessionFile() ?? 'available in tool details'}]` : text;
  return { content: [{ type: 'text' as const, text: output }], details, structuredContent: (structuredContent ?? details) as JsonValue, isError };
}
