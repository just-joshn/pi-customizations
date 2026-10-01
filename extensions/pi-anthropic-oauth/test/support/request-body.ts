import type { MessagesServer, RecordedRequest } from './messages-server.ts';

export const BILLING_TEXT = 'x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;';
export const PROVIDER_PREAMBLE = "You are Provider CLI, Anthropic's official CLI for Claude.";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function soleRequest(server: MessagesServer): RecordedRequest {
  const [first] = server.requests;
  if (server.requests.length !== 1 || !first) throw new Error(`expected one recorded request, received ${server.requests.length}`);
  return first;
}

export function systemBlocks(body: unknown): readonly unknown[] {
  return isRecord(body) && Array.isArray(body.system) ? body.system : [];
}

export function systemTexts(body: unknown): readonly string[] {
  return systemBlocks(body).flatMap((block) => (isRecord(block) && typeof block.text === 'string' ? [block.text] : []));
}

export function toolNames(body: unknown): readonly string[] {
  if (!isRecord(body) || !Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) => (isRecord(tool) && typeof tool.name === 'string' ? [tool.name] : []));
}

export function messagesOf(body: unknown): readonly unknown[] {
  return isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
}

export function eventType(data: unknown): string | undefined {
  return isRecord(data) && typeof data.type === 'string' ? data.type : undefined;
}
