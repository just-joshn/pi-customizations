/**
 * Prefixed repository-map chat insertion (`aider/coders/base_coder.py:750-761`)
 * and optional cache marking (`aider/coders/chat_chunks.py:28-55`).
 */

export interface RepoTextMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export type CacheMarkedPart = {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: { readonly type: 'ephemeral' };
};

export type CacheMarkedMessage = {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | readonly CacheMarkedPart[];
};

export interface PromptChunks {
  readonly system: readonly CacheMarkedMessage[];
  readonly examples: readonly CacheMarkedMessage[];
  readonly readonlyFiles: readonly CacheMarkedMessage[];
  readonly repo: readonly CacheMarkedMessage[];
  readonly done: readonly CacheMarkedMessage[];
  readonly chatFiles: readonly CacheMarkedMessage[];
  readonly cur: readonly CacheMarkedMessage[];
  readonly reminder: readonly CacheMarkedMessage[];
}

export function getRepoMessages(repoMap: string | null): readonly RepoTextMessage[] {
  if (!repoMap) return [];
  return [
    { role: 'user', content: repoMap },
    { role: 'assistant', content: "Ok, I won't try and edit those files without asking first." },
  ];
}

function addCacheControl(messages: readonly CacheMarkedMessage[]): readonly CacheMarkedMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1]!;
  const text = typeof last.content === 'string' ? last.content : last.content.map((part) => ('text' in part ? part.text : '')).join('');
  return [
    ...messages.slice(0, -1),
    {
      role: last.role,
      content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
    },
  ];
}

/** Mark the repo chunk (or readonly_files when empty) the way ChatChunks.add_cache_control_headers does. */
export function addCacheControlHeaders(chunks: PromptChunks): PromptChunks {
  const systemOrExamples = chunks.examples.length > 0 ? { examples: addCacheControl(chunks.examples), system: chunks.system } : { system: addCacheControl(chunks.system), examples: chunks.examples };
  const repoOrReadonly =
    chunks.repo.length > 0
      ? { repo: addCacheControl(chunks.repo), readonlyFiles: chunks.readonlyFiles }
      : { repo: chunks.repo, readonlyFiles: addCacheControl(chunks.readonlyFiles) };
  return {
    ...chunks,
    ...systemOrExamples,
    ...repoOrReadonly,
    chatFiles: addCacheControl(chunks.chatFiles),
  };
}
