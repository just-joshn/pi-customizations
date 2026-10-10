import { parse } from 'node:path';

import type { GitPolicy, MapRequest, RepositoryContext } from '../feature.ts';
import { absRootPath, allRelativeFiles, type ChatFiles, getRelFname, inchatRelativeFiles } from './chat-files.ts';
import { getFileMentions } from './mentions.ts';

export interface MapCallPolicy {
  readonly disabled?: boolean;
  readonly forceRefresh?: boolean;
  readonly refresh?: 'auto' | 'files' | 'always';
  readonly expandNoFilesBudget?: boolean;
}

export interface RepoMapEnv {
  readonly root: string;
  readonly files: ChatFiles;
  readonly git: GitPolicy;
  readonly map: RepositoryContext;
  readonly curMessageText: string;
  readonly policy: MapCallPolicy;
  readonly signal?: AbortSignal | undefined;
}

/** `Coder.get_ident_mentions`. */
export function getIdentMentions(text: string): ReadonlySet<string> {
  return new Set(text.split(/\W+/).filter((word) => word.length > 0));
}

/** `Coder.get_ident_filename_matches`. */
export function getIdentFilenameMatches(idents: ReadonlySet<string>, relativeFiles: readonly string[]): ReadonlySet<string> {
  const byStem = new Map<string, Set<string>>();
  for (const fname of relativeFiles) {
    if (!fname || fname === '.') continue;
    const base = parse(fname).name.toLowerCase();
    if (base.length < 5) continue;
    const group = byStem.get(base) ?? new Set<string>();
    group.add(fname);
    byStem.set(base, group);
  }
  const matches = new Set<string>();
  for (const ident of idents) {
    if (ident.length < 5) continue;
    for (const fname of byStem.get(ident.toLowerCase()) ?? []) matches.add(fname);
  }
  return matches;
}

/** `Coder.get_repo_map`: seed, hint, and fallback attempts against the repository-context port. */
export async function requestRepoMap(env: RepoMapEnv): Promise<string | null> {
  if (env.policy.disabled) return null;
  env.signal?.throwIfAborted();
  const inventoryRel = await allRelativeFiles(env.root, env.files, env.git);
  const inventoryAbs = inventoryRel.map((path) => absRootPath(env.root, path));
  const inventoryAbsSet = new Set(inventoryAbs);
  const readOnlyInRepo = [...env.files.readOnly].filter((path) => inventoryAbsSet.has(path));
  const chatFiles = new Set([...env.files.editable, ...readOnlyInRepo]);
  const otherFiles = new Set(inventoryAbs.filter((path) => !chatFiles.has(path)));
  const inchat = inchatRelativeFiles(env.root, env.files);
  const readOnlyRel = [...env.files.readOnly].map((path) => getRelFname(env.root, path));
  const mentionedFnames = new Set([
    ...getFileMentions({ content: env.curMessageText, inchat, readOnly: readOnlyRel, addable: inventoryRel, ignoreCurrent: false }),
    ...getIdentFilenameMatches(getIdentMentions(env.curMessageText), inventoryRel),
  ]);
  const mentionedIdents = getIdentMentions(env.curMessageText);
  const flags = {
    forceRefresh: env.policy.forceRefresh,
    refresh: env.policy.refresh,
    expandNoFilesBudget: env.policy.expandNoFilesBudget,
  };
  const attempts: MapRequest[] = [
    { chatFiles, otherFiles, mentionedFnames, mentionedIdents, ...flags },
    { chatFiles: new Set(), otherFiles: new Set(inventoryAbs), mentionedFnames, mentionedIdents, ...flags },
    { chatFiles: new Set(), otherFiles: new Set(inventoryAbs), mentionedFnames: new Set(), mentionedIdents: new Set(), ...flags },
  ];
  for (const request of attempts) {
    env.signal?.throwIfAborted();
    const content = await env.map.repoMap(request, env.signal);
    if (content) return content;
  }
  return null;
}
