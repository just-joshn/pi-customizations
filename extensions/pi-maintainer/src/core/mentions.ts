import { basename } from 'node:path';

import { rstrip, splitWhitespace, strip } from '../support/pystr.ts';

export interface MentionRequest {
  readonly content: string;
  readonly addable: readonly string[];
  readonly inchat: readonly string[];
  readonly readOnly: readonly string[];
  readonly ignoreCurrent: boolean;
}

export function getFileMentions(request: MentionRequest): ReadonlySet<string> {
  const words = new Set(splitWhitespace(request.content).map((word) => strip(rstrip(word, ',.!;:?'), '"\'`*_')));
  const normalizedWords = new Set([...words].map((word) => word.replaceAll('\\', '/')));
  const existing = new Set(request.ignoreCurrent ? [] : [...request.inchat, ...request.readOnly].map((path) => basename(path)));
  const byBasename = new Map<string, string[]>();
  const mentioned = new Set<string>();
  for (const path of new Set(request.addable)) {
    if (normalizedWords.has(path.replaceAll('\\', '/'))) mentioned.add(path);
    const name = basename(path);
    if (/[/\\._-]/u.test(name)) byBasename.set(name, [...(byBasename.get(name) ?? []), path]);
  }
  for (const [name, paths] of byBasename) {
    const [path] = paths;
    if (path !== undefined && paths.length === 1 && !existing.has(name) && words.has(name)) mentioned.add(path);
  }
  return mentioned;
}
