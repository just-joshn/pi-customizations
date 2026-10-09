/**
 * @typedef {{ ok: boolean, queue: number, next: string }} StatusState
 * @typedef {{ json?: boolean }} FormatOptions
 */

export function sampleState() {
  return { ok: true, queue: 3, next: 'deploy review' };
}

/**
 * @param {StatusState} state
 * @param {FormatOptions} [options]
 */
export function formatStatus(state, { json = false } = {}) {
  if (json) {
    return JSON.stringify(state);
  }
  const status = state.ok ? 'ok' : 'blocked';
  const ready = state.ok ? 'yes' : 'no';
  return [
    `Status: ${status}`,
    `Ready: ${ready}`,
    `Next: ${state.next}`,
    `Queue: ${state.queue}`,
  ].join('\n');
}
