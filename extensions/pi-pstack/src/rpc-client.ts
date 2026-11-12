// The controller side of a worker host's control socket: one JSON record per connection, identity checked both ways.
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';

import { controlSocketPath, type HostState, type LoadedAssignment } from './run-files.ts';
import { type ControlRequest, type HostOperation, MAX_CONTROL_BYTES } from './worker-host.ts';

const CONTROL_DEADLINE_MS = 90_000;
const INSPECT_DEADLINE_MS = 5_000;

export interface HostTarget {
  socketPath: string;
  workerId: string;
  digest: string;
}

export const hostTarget = (loaded: LoadedAssignment): HostTarget => ({ socketPath: controlSocketPath(loaded.runRoot, loaded.assignment.workerId), workerId: loaded.assignment.workerId, digest: loaded.digest });

/** The host could not be reached or did not answer; the outcome of a mutation is unknown, so never retry it blindly. */
export class HostUnavailableError extends Error {}

interface HostResponse {
  ok: true;
  id: string;
  workerId: string;
  digest: string;
  instance: string;
  result: unknown;
}

function exchange(target: HostTarget, control: ControlRequest, deadlineMs: number): Promise<HostResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(target.socketPath);
    let bytes = Buffer.alloc(0);
    let done = false;
    const finish = (error: Error | undefined, value?: HostResponse) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error !== undefined) reject(error);
      else resolve(value as HostResponse);
    };
    const timer = setTimeout(() => finish(new HostUnavailableError('Control deadline expired; outcome unknown, do not retry mutations')), deadlineMs);
    socket.once('connect', () => socket.write(`${JSON.stringify(control)}\n`));
    socket.on('error', (error) => finish(new HostUnavailableError(`Host unreachable: ${error.message}`)));
    socket.on('end', () => finish(new HostUnavailableError('Host disconnected; outcome unknown, do not retry mutations')));
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > MAX_CONTROL_BYTES * 8) return finish(new Error('Oversized host response'));
      const newline = bytes.indexOf(10);
      if (newline === -1) return;
      try {
        const response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, newline))) as Record<string, unknown>;
        if (response['ok'] !== true) return finish(new Error(typeof response['error'] === 'string' ? response['error'] : 'Host rejected control'));
        if (response['id'] !== control.id || response['workerId'] !== target.workerId || response['digest'] !== target.digest || typeof response['instance'] !== 'string') throw new Error('Host response identity mismatch');
        if (control.instance !== undefined && response['instance'] !== control.instance) throw new Error('Host instance changed; outcome unknown');
        finish(undefined, response as unknown as HostResponse);
      } catch (error) {
        finish(error as Error);
      }
    });
  });
}

const envelope = (target: HostTarget, operation: HostOperation, fields: Partial<ControlRequest> = {}): ControlRequest => ({ id: randomUUID(), workerId: target.workerId, digest: target.digest, operation, ...fields });

export async function inspectHost(target: HostTarget): Promise<HostState> {
  return (await exchange(target, envelope(target, 'inspect'), INSPECT_DEADLINE_MS)).result as HostState;
}

/** Sends one mutation, bound to the host instance that answered a fresh inspect. */
export async function controlHost(target: HostTarget, operation: Exclude<HostOperation, 'inspect'>, text?: string): Promise<unknown> {
  const handshake = await exchange(target, envelope(target, 'inspect'), INSPECT_DEADLINE_MS);
  return (await exchange(target, envelope(target, operation, { instance: handshake.instance, ...(text === undefined ? {} : { text }) }), CONTROL_DEADLINE_MS)).result;
}
