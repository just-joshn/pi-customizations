import { randomUUID } from 'node:crypto';
import { constants as osConstants } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { spawn } from '@lydell/node-pty';
import { allocateDir, createExclusive, resolveExecutable, sha256 } from './files.mjs';

const SETTLE_MS = 100;
const DRAIN_LIMIT_MS = 2000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const signalName = (number) => Object.entries(osConstants.signals).find(([, value]) => value === number)?.[0] ?? String(number);

const bindings = (paths) => Promise.all(paths.map(async (path) => ({ path, digest: await sha256(path) })));

function publicLaunch(spec) {
  const publicEnv = new Set(spec.publicEnv ?? ['TERM']);
  const secretArgs = new Set(spec.secretArgIndexes ?? []);
  const env = spec.launch.env;
  return {
    argv: spec.launch.argv.map((arg, index) => (secretArgs.has(index) ? '<redacted>' : arg)),
    cwd: spec.launch.cwd,
    envNames: Object.keys(env).sort(),
    publicEnv: Object.fromEntries(Object.entries(env).filter(([name]) => publicEnv.has(name))),
  };
}

async function buildIdentity(spec, attemptId, executablePath) {
  return {
    schema: 1,
    attemptId,
    side: spec.side,
    scenarioRef: spec.scenarioRef,
    fixtureRef: spec.fixtureRef,
    executable: executablePath ? (await bindings([executablePath]))[0] : null,
    artifacts: await bindings(spec.artifactPaths),
    launch: publicLaunch(spec),
    geometry: spec.geometry,
    observedEnv: { platform: process.platform, node: process.version, TERM: spec.launch.env.TERM ?? '' },
  };
}

const sealedError = () => new Error('Attempt is sealed');

export async function startAttempt(spec) {
  const attemptId = randomUUID();
  const executablePath = await resolveExecutable(spec.launch.argv[0], spec.launch.cwd, spec.launch.env);
  const identity = await buildIdentity(spec, attemptId, executablePath);
  const dir = await allocateDir(spec.root, attemptId);
  const identityHandle = await createExclusive(join(dir, 'identity.json'));
  await identityHandle.writeFile(`${JSON.stringify(identity, null, 2)}\n`);
  await identityHandle.close();
  const handle = await createExclusive(join(dir, 'events.jsonl'));
  const events = [];
  let writeError;
  let queue = Promise.resolve();
  let sealed = false;
  const append = (kind, fields = {}) => {
    const event = {
      seq: events.length,
      monoNs: process.hrtime.bigint().toString(),
      utc: new Date().toISOString(),
      kind,
      ...fields,
    };
    events.push(event);
    queue = queue
      .then(() => handle.write(`${JSON.stringify(event)}\n`))
      .catch((error) => {
        writeError ??= error;
      });
    return event;
  };

  append('launch_intent');
  let pty;
  if (!executablePath) {
    append('spawn_failed', { errno: 'ENOENT', message: `Executable not found: ${spec.launch.argv[0]}` });
  } else {
    try {
      const [, ...args] = spec.launch.argv;
      pty = spawn(executablePath, args, {
        name: spec.launch.env.TERM ?? 'xterm-256color',
        rows: spec.geometry.rows,
        cols: spec.geometry.cols,
        cwd: spec.launch.cwd,
        env: spec.launch.env,
        encoding: null,
      });
    } catch (error) {
      append('spawn_failed', { errno: error.code ?? 'UNKNOWN', message: String(error.message) });
    }
  }

  let lastData = performance.now();
  let exitedAlready = false;
  let cancelPromise;
  const exited = new Promise((resolve) => {
    if (!pty) return resolve();
    append('process_started', { pid: pty.pid });
    pty.onData((data) => {
      lastData = performance.now();
      append('output', { dataB64: Buffer.from(data).toString('base64') });
    });
    pty.onExit(({ exitCode, signal }) => {
      exitedAlready = true;
      append('exited', { exitCode: signal ? null : exitCode, signal: signal ? signalName(signal) : null });
      resolve();
    });
  });

  const groupAlive = () => {
    try {
      process.kill(-pty.pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const signalGroup = (signal) => {
    try {
      process.kill(-pty.pid, signal);
    } catch {}
  };

  const done = (async () => {
    await exited;
    if (pty) {
      const started = performance.now();
      while (performance.now() - lastData < SETTLE_MS && performance.now() - started < DRAIN_LIMIT_MS) await sleep(SETTLE_MS);
      if (groupAlive()) {
        append('error', { where: 'descendants_alive', message: 'Process group still alive at seal; killed' });
        signalGroup('SIGKILL');
      }
      append('drained');
    }
    append('sealed', { eventCount: events.length + 1 });
    sealed = true;
    await queue;
    await handle.close();
    if (writeError) throw writeError;
    return { dir, identity, events: [...events] };
  })();
  done.catch(() => {});

  return {
    dir,
    id: attemptId,
    events: () => [...events],
    input(data, origin) {
      if (typeof data === 'string') throw new TypeError('input requires bytes, not a string');
      if (sealed) throw sealedError();
      if (!pty) throw new Error('Attempt has no running process');
      const dispatched = append('input_dispatched', { dataB64: Buffer.from(data).toString('base64'), origin });
      pty.write(Buffer.from(data));
      append('input_written', { inputSeq: dispatched.seq, bytesSubmitted: data.length });
    },
    resize({ rows, cols }) {
      if (sealed) throw sealedError();
      if (!pty) throw new Error('Attempt has no running process');
      pty.resize(cols, rows);
      append('resize', { rows, cols });
    },
    cancel() {
      cancelPromise ??= (async () => {
        if (!pty || exitedAlready || sealed) return;
        append('cancel_requested', { escalation: 'term' });
        signalGroup('SIGTERM');
        const grace = sleep(spec.timeouts?.graceMs ?? 2000).then(() => 'timeout');
        if ((await Promise.race([exited.then(() => 'exit'), grace])) === 'timeout') {
          append('cancel_requested', { escalation: 'kill' });
          signalGroup('SIGKILL');
        }
        await exited;
      })();
      return cancelPromise;
    },
    done: () => done,
  };
}
