/** Transcript text for a maintainer state entry, or null to hide it. */
export function stateEntryRenderText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record['schema'] !== 1 || record['kind'] !== 'notice' || typeof record['text'] !== 'string') return null;
  return record['text'];
}
