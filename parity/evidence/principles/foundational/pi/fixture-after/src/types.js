/**
 * @typedef {'pending' | 'done'} JobStatus
 * @typedef {{ id: string, status: JobStatus, payload: unknown }} Job
 */

export const JOB_STATUS = Object.freeze({ PENDING: 'pending', DONE: 'done' });
