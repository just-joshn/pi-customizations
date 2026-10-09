import { JOB_STATUS } from './types.js';

/** @type {Map<string, import('./types.js').Job>} */
const jobs = new Map();
const claimed = new Set();
let nextId = 1;

export function enqueue(payload) {
  const id = `job-${nextId++}`;
  jobs.set(id, { id, status: JOB_STATUS.PENDING, payload });
  return id;
}

export function claim() {
  for (const job of jobs.values()) {
    if (job.status === JOB_STATUS.PENDING && !claimed.has(job.id)) {
      claimed.add(job.id);
      return { ...job };
    }
  }
  return null;
}

export function complete(id) {
  const job = jobs.get(id);
  if (!job) throw new Error(`unknown job: ${id}`);
  if (!claimed.has(id)) throw new Error(`job not claimed: ${id}`);
  if (job.status === JOB_STATUS.DONE) return;
  jobs.set(id, { ...job, status: JOB_STATUS.DONE });
  claimed.delete(id);
}

export function snapshot() {
  return [...jobs.values()].map((j) => ({ ...j }));
}
