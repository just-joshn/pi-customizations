// Domain: incomplete relay jobs. Next action = stalest wait (max ageMs).

export function pickNext(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error('pickNext requires a non-empty jobs array');
  }
  let chosen = jobs[0];
  for (const job of jobs) {
    if (job.ageMs > chosen.ageMs) chosen = job;
  }
  return chosen.id;
}
