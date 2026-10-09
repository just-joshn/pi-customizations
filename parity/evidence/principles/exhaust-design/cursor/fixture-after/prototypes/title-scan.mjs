/*
APPROACH: title-scan
*/

// Lexicographic scan of titles; pick the earliest title string.
// Stable, deterministic, ignores wait time and menu position.

export function pick(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return undefined;
  const sorted = [...jobs].sort((x, y) =>
    String(x.title).localeCompare(String(y.title)),
  );
  return sorted[0].id;
}

const sample = [
  { id: 'a', title: 'alpha', ageMs: 10 },
  { id: 'b', title: 'beta', ageMs: 20 },
];
console.log('title-scan ->', pick(sample));
