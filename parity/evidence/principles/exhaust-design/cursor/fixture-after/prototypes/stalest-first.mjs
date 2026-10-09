/*
APPROACH: stalest-first
*/

// Auto-select the incomplete job waiting longest (max ageMs).
// Operator never ranks; urgency is age alone.

export function pick(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return undefined;
  let best = jobs[0];
  for (const job of jobs) {
    if (job.ageMs > best.ageMs) best = job;
  }
  return best.id;
}

const sample = [
  { id: 'a', title: 'alpha', ageMs: 10 },
  { id: 'b', title: 'beta', ageMs: 20 },
];
console.log('stalest-first ->', pick(sample));
