import type { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import type { ForkState } from './fork-context.ts';
import { workerNotesBlock } from './worker-notes.ts';

type LoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
export type PromptOptions = Pick<LoaderOptions, 'systemPromptOverride' | 'appendSystemPrompt' | 'appendSystemPromptOverride' | 'noContextFiles' | 'noSkills'>;

type Parts = Readonly<{ body: string; host: readonly string[]; omitContext: boolean; fork: ForkState | undefined; ordinary: boolean }>;

export function childPromptOptions({ body, host, omitContext, fork, ordinary }: Parts): PromptOptions {
  if (fork) return { systemPromptOverride: () => fork.prompt, appendSystemPrompt: [], appendSystemPromptOverride: () => [], noContextFiles: true, noSkills: true };
  if (ordinary) return { systemPromptOverride: () => body, appendSystemPrompt: [workerNotesBlock(), ...host], noContextFiles: omitContext };
  return { appendSystemPrompt: [body, ...host], noContextFiles: omitContext };
}
