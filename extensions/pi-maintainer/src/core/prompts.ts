import type { Fence } from '../edit/fences.ts';
import type { EditFormatName } from '../feature.ts';

export interface Dialogue {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface PromptSet {
  readonly mainSystem: string;
  readonly systemReminder: string;
  readonly exampleMessages: readonly Dialogue[];
  readonly filesContentPrefix: string;
  readonly filesContentAssistantReply: string;
  readonly filesNoFullFiles: string;
  readonly filesNoFullFilesWithRepoMap: string;
  readonly filesNoFullFilesWithRepoMapReply: string;
  readonly readOnlyFilesPrefix: string;
  readonly filesContentGptEditsNoRepo: string;
}

export interface PromptVariables {
  readonly fence: Fence;
  readonly root: string;
  readonly model: { readonly provider: string; readonly id: string };
  readonly suggestShellCommands: boolean;
  readonly signal?: AbortSignal | undefined;
}

export interface PromptSource {
  get(format: EditFormatName, variables: PromptVariables): PromptSet | Promise<PromptSet>;
}

export interface PromptPolicy {
  readonly useSystemPrompt: boolean;
  readonly examplesAsSystemMessage: boolean;
  readonly systemPromptPrefix: string;
  readonly reminder: 'sys' | 'user' | null;
}

export const defaultPromptPolicy: PromptPolicy = { useSystemPrompt: true, examplesAsSystemMessage: false, systemPromptPrefix: '', reminder: 'sys' };
