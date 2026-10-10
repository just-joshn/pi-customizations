/** Aider `Tag` (`aider/repomap.py:29`). Absolute and relative paths, kind, name, zero-based line. */
export interface Tag {
  readonly relFname: string;
  readonly fname: string;
  readonly name: string;
  readonly kind: 'def' | 'ref';
  readonly line: number;
}

export const tag = (fields: Tag): Tag => fields;

/**
 * Aider's pygments backfill when semantic defs exist without refs (`aider/repomap.py:338-364`).
 * Emits reference tags at line `-1`. Callers supply name tokens (Pygments `Token.Name` list).
 */
export function lexicalReferenceTags(input: {
  readonly relFname: string;
  readonly fname: string;
  readonly code: string;
  readonly names: readonly string[];
}): Tag[] {
  if (!input.code) return [];
  return input.names.map((name) =>
    tag({
      relFname: input.relFname,
      fname: input.fname,
      name,
      kind: 'ref',
      line: -1,
    }),
  );
}
