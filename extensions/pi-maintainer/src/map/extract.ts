import type { CaptureNode, Captures, QueryRuntime } from './query-runtime.ts';
import { lexicalReferenceTags, type Tag, tag } from './tag.ts';

export interface ExtractTagsInput {
  readonly relFname: string;
  readonly fname: string;
  readonly code: string | null | undefined;
  readonly runtime: QueryRuntime;
  readonly resolveQuery: (lang: string) => string | null;
  /** Pygments `Token.Name` tokens for lexical reference backfill. */
  readonly nameTokens?: (code: string, fname: string) => readonly string[];
}

/**
 * Expand captures once per returned node.
 * Fixes Aider's language-pack branch that appended the final node again
 * (`aider/repomap.py:306-315`, `map.tags.no-duplicate-final-capture`).
 */
export function expandCapturePairs(captures: Captures): ReadonlyArray<{ readonly node: CaptureNode; readonly tag: string }> {
  const pairs: Array<{ node: CaptureNode; tag: string }> = [];
  for (const [captureTag, nodes] of Object.entries(captures)) {
    for (const node of nodes) {
      pairs.push({ node, tag: captureTag });
    }
  }
  return pairs;
}

function kindForCaptureTag(captureTag: string): 'def' | 'ref' | null {
  if (captureTag.startsWith('name.definition.')) return 'def';
  if (captureTag.startsWith('name.reference.')) return 'ref';
  return null;
}

/**
 * Aider `get_tags_raw` orchestration without a private tree-sitter bridge
 * (`aider/repomap.py:279-364`). Semantic tags require a QueryRuntime that can capture
 * and a resolved query asset; otherwise the result is empty.
 */
export function extractTags(input: ExtractTagsInput): Tag[] {
  const lang = input.runtime.languageFor(input.fname);
  if (!lang) return [];

  const queryScm = input.resolveQuery(lang);
  if (!queryScm) return [];

  const code = input.code;
  if (!code) return [];

  const outcome = input.runtime.capture({ lang, code, queryScm });
  if (outcome.kind !== 'ok') return [];

  const tags: Tag[] = [];
  const saw = new Set<'def' | 'ref'>();
  for (const { node, tag: captureTag } of expandCapturePairs(outcome.captures)) {
    const kind = kindForCaptureTag(captureTag);
    if (!kind) continue;
    saw.add(kind);
    tags.push(
      tag({
        relFname: input.relFname,
        fname: input.fname,
        name: node.text,
        kind,
        line: node.startLine,
      }),
    );
  }

  if (saw.has('ref') || !saw.has('def')) return tags;

  const names = input.nameTokens?.(code, input.fname) ?? [];
  if (names.length === 0) return tags;
  return [
    ...tags,
    ...lexicalReferenceTags({
      relFname: input.relFname,
      fname: input.fname,
      code,
      names,
    }),
  ];
}
