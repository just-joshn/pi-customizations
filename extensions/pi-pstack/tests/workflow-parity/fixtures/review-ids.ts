type ReviewComment = { id: string; databaseId?: number };
type ReviewState = { prs: Record<string, { threads: { comments: ReviewComment[] }[] }> };

export function assignReviewIds(state: ReviewState): void {
  const comments = Object.values(state.prs).flatMap((pr) => pr.threads.flatMap((thread) => thread.comments));
  for (const entry of comments) {
    if (/^\d+$/.test(entry.id)) entry.databaseId = Number(entry.id);
  }
  let next = Math.max(0, ...comments.map((entry) => entry.databaseId ?? 0)) + 1;
  for (const entry of comments) entry.databaseId ??= next++;
}
