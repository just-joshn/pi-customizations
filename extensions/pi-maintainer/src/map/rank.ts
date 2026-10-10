import { pythonSorted } from '../support/python-sort.ts';
import type { Tag } from './tag.ts';

/** Ranked map entry: full Tag or filename-only (`aider/repomap.py:569-572`). */
export type RankedEntry = Tag | { readonly relFname: string };

export function isTagEntry(entry: RankedEntry): entry is Tag {
  return 'kind' in entry;
}

/** Skeleton ranking without PageRank: other files as filename-only entries, sorted. */
export function filenameOnlyEntries(relOtherFnames: readonly string[]): RankedEntry[] {
  return pythonSorted(new Set(relOtherFnames)).map((relFname) => ({ relFname }));
}
