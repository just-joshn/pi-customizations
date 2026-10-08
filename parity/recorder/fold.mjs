export function outcomeOf(events) {
  const failed = events.find((e) => e.kind === 'spawn_failed');
  if (failed) return { kind: 'launch_failed', errno: failed.errno };
  const exit = events.find((e) => e.kind === 'exited');
  const cancel = events.find((e) => e.kind === 'cancel_requested');
  if (!events.some((e) => e.kind === 'sealed') || !exit) return { kind: 'interrupted', lastSeq: events.at(-1)?.seq ?? -1 };
  if (cancel && exit && cancel.seq < exit.seq) {
    return { kind: 'cancelled', exit: { exitCode: exit.exitCode, signal: exit.signal } };
  }
  return exit.signal ? { kind: 'signaled', signal: exit.signal } : { kind: 'exited', exitCode: exit.exitCode };
}

const bytesOf = (events, kind, keep = () => true) => Buffer.concat(events.filter((e) => e.kind === kind && keep(e)).map((e) => Buffer.from(e.dataB64, 'base64')));

export const outputBytes = (events) => bytesOf(events, 'output');

export const inputBytes = (events, origin) => bytesOf(events, 'input_dispatched', (e) => !origin || e.origin === origin);

export function transcript(events) {
  return events
    .filter((e) => e.kind === 'output' || e.kind === 'input_dispatched')
    .map((e) => ({
      seq: e.seq,
      monoNs: e.monoNs,
      direction: e.kind === 'output' ? 'out' : 'in',
      bytes: Buffer.from(e.dataB64, 'base64'),
    }));
}
