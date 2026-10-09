import { createJob } from './types.js';

const jobs = new Map();
const pending = [];

export function enqueue(payload) {
  const job = createJob(payload);
  jobs.set(job.id, job);
  pending.push(job.id);
  return job.id;
}

export function claim() {
  const id = pending.shift();
  if (id === undefined) {
    return null;
  }
  const job = jobs.get(id);
  if (!job) {
    return null;
  }
  return { ...job };
}

export function complete(id) {
  const job = jobs.get(id);
  if (!job) {
    return;
  }
  jobs.set(id, { ...job, status: 'done' });
}

export function snapshot() {
  return [...jobs.values()];
}
