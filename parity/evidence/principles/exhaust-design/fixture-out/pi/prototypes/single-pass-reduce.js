/*
APPROACH: single-pass-reduce
*/
// One O(n) fold tracking the best candidate, no allocation.
export const pickNext = (jobs) => {
  let best = null;
  for (const j of jobs) if (!j.done && (!best || j.ageMs > best.ageMs)) best = j;
  return best ? best.id : null;
};
