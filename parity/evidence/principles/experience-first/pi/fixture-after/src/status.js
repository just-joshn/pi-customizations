export function sampleState() {
  return { ok: true, queue: 3, next: 'deploy review' };
}

/** @param {{ ok: boolean, queue: number, next: string }} state */
export function formatStatus(state, { json = false } = {}) {
  if (json) return JSON.stringify(state);
  const items = state.queue === 1 ? 'item' : 'items';
  return [
    `Status: ${state.ok ? 'healthy' : 'needs attention'}`,
    `Ready: ${state.ok ? 'yes' : 'no'}`,
    `Next: ${state.next}`,
    `Queue: ${state.queue} ${items} waiting`,
  ].join('\n');
}
