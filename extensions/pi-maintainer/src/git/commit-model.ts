import type { ModelRegistry } from '@earendil-works/pi-coding-agent';
import { textFromAssistantContent } from '../edit/reasoning.ts';
import type { CommitMessageRequest } from './commit-message.ts';

/** One physical model a commit message may come from. */
export interface CommitModelRef {
  readonly provider: string;
  readonly id: string;
}

export interface CommitMessageModelOptions {
  /** `ctx.modelRegistry`: Pi resolves provider auth, transport, and retry policy for each call. */
  readonly registry: Pick<ModelRegistry, 'find' | 'complete'>;
  /** Aider's `coder.main_model`, read at call time so a `/model` switch reaches the next commit. */
  readonly main: () => CommitModelRef | null;
  /** Aider's `--weak-model`, or null when unset so the main model fills both slots. */
  readonly weak: () => CommitModelRef | null;
  /** Aider prints each auxiliary model failure before trying the next model. */
  readonly error?: (text: string) => void;
}

/**
 * Aider `get_commit_message`: try each commit-message model in order and keep the first
 * non-empty reply (`aider/repo.py:326-367`). `aider/models.py:622-623` lists the weak model
 * first and the main model second, the main model twice when no weak model is set.
 * Unlike `simple_send_with_retries`, one failed call advances the ladder; Pi owns provider
 * retry policy. Returns null when every model fails; the caller prints Aider's failure message.
 */
export function createCommitMessageGenerator(options: CommitMessageModelOptions): (request: CommitMessageRequest, signal?: AbortSignal) => Promise<string | null> {
  return async (request, signal) => {
    const main = options.main();
    if (!main) return null;
    const timestamp = Date.now();
    const messages = [
      { role: 'system' as const, content: request.system, timestamp },
      { role: 'user' as const, content: request.user, timestamp },
    ];
    for (const reference of [options.weak() ?? main, main]) {
      const model = options.registry.find(reference.provider, reference.id);
      if (!model || model.api === 'pi-virtual') continue;
      signal?.throwIfAborted();
      try {
        const response = await options.registry.complete(model, { messages }, signal ? { signal } : {});
        const text = textFromAssistantContent(response.content);
        if (text.trim()) return text;
      } catch (error) {
        if (signal?.aborted) throw error;
        options.error?.(`${reference.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return null;
  };
}
