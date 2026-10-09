import { ACTORS } from './actors.js';
import { pickLeader } from './assign.js';

export function runRounds(n = 20) {
  const counts = Object.fromEntries(ACTORS.map((name) => [name, 0]));
  for (let i = 0; i < n; i += 1) {
    const leader = pickLeader(i, ACTORS);
    counts[leader] = (counts[leader] || 0) + 1;
  }
  return counts;
}
