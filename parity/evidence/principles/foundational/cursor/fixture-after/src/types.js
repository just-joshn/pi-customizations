/**
 * @typedef {'pending' | 'done'} JobStatus
 * @typedef {{ id: string, status: JobStatus, payload: unknown }} Job
 */

let nextId = 0;

/** @param {unknown} payload @returns {Job} */
export function createJob(payload) {
  nextId += 1;
  return {
    id: String(nextId),
    status: 'pending',
    payload,
  };
}
