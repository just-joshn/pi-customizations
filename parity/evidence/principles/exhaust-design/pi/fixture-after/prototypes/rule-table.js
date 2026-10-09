/*
APPROACH: rule-table
*/
// Ordered table of comparators (priority, then age, then id); data-driven and extensible.
const RULES = [(a, b) => (b.priority ?? 0) - (a.priority ?? 0), (a, b) => b.ageMs - a.ageMs, (a, b) => String(a.id).localeCompare(String(b.id))];
export const pickNext = (jobs) =>
  [...jobs].filter((j) => !j.done).sort((a, b) => RULES.reduce((r, f) => r || f(a, b), 0))[0]?.id ?? null;
