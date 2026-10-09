export function sampleState() {
  return { ok: true, queue: 3, next: 'deploy review' };
}

/** @param {{ ok: boolean, queue: number, next: string }} state */
export function formatStatus(state, { json = false } = {}) {
  void json;
  return JSON.stringify(state);
}
