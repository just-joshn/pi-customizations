import type { FetchFunction } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { ANTIGRAVITY_USER_AGENT, CODE_ASSIST_BASE_URL } from './constants.ts';

export class CodeAssistError extends Error {}

/** What every Code Assist call needs: who is asking, when to stop, and how to reach Google. */
export interface CodeAssistCall {
  accessToken: string;
  signal: AbortSignal;
  fetchImpl: FetchFunction;
}

const GOOGLE_ERROR_BODY = z.object({ error: z.object({ message: z.string().min(1) }) });

export function codeAssistUrl(method: string): string {
  return `${CODE_ASSIST_BASE_URL}:${method}`;
}

export function googleErrorMessage(text: string): string | undefined {
  try {
    return GOOGLE_ERROR_BODY.safeParse(JSON.parse(text)).data?.error.message;
  } catch {
    return undefined;
  }
}

export async function callCodeAssist<S extends z.ZodType>(input: CodeAssistCall, schema: S, method: 'GET' | 'POST', url: string, body?: object): Promise<z.output<S>> {
  const response = await input.fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json', 'User-Agent': ANTIGRAVITY_USER_AGENT },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: input.signal,
  });
  if (!response.ok) throw new CodeAssistError(googleErrorMessage(await response.text()) ?? `Google Code Assist request failed (HTTP ${response.status})`);
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new CodeAssistError('Google Code Assist returned a response that is not JSON');
  return parsed.data;
}

export function fetchAvailableModels(input: CodeAssistCall & { project: string }): Promise<unknown> {
  return callCodeAssist(input, z.json(), 'POST', codeAssistUrl('fetchAvailableModels'), { project: input.project });
}
