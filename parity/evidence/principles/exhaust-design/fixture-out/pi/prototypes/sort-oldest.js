/*
APPROACH: sort-oldest
*/
// Filter incomplete, sort by ageMs descending, take head. O(n log n).
export const pickNext = (jobs) =>
  [...jobs].filter((j) => !j.done).sort((a, b) => b.ageMs - a.ageMs)[0]?.id ?? null;
