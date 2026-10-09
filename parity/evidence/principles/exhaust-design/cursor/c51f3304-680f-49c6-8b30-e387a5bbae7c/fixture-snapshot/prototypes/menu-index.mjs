/*
APPROACH: menu-index
*/

// Numbered operator menu: present jobs in input order, pick by index.
// Default resume target is slot 0 (first listed). Interaction is position, not age.

export function pick(jobs, index = 0) {
  if (!Array.isArray(jobs) || jobs.length === 0) return undefined;
  const i = Math.max(0, Math.min(index, jobs.length - 1));
  return jobs[i].id;
}

const sample = [
  { id: 'a', title: 'alpha', ageMs: 10 },
  { id: 'b', title: 'beta', ageMs: 20 },
];
console.log('menu-index ->', pick(sample, 0));
