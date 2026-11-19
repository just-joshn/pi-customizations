import { Codex } from '@openai/codex-sdk';
import { CODEX_DEFAULT_MODEL_ID } from './models.ts';

/** The part of the Codex SDK this provider uses, as documented at https://learn.chatgpt.com/docs/codex-sdk. */
export interface CodexThread {
  readonly id: string | null;
  run(input: string): Promise<{ finalResponse: string }>;
}

export interface CodexClient {
  startThread(options: { threadSource: string }): CodexThread;
  resumeThread(id: string): CodexThread;
}

export type CreateCodex = (modelId: string) => CodexClient;

/** Labels the Codex threads this provider creates. */
export const THREAD_SOURCE = 'pi';

/** The configured default model needs no config. Any other model is set through structured Codex config. */
export const createCodex: CreateCodex = (modelId) => (modelId === CODEX_DEFAULT_MODEL_ID ? new Codex() : new Codex({ config: { model: modelId } }));
