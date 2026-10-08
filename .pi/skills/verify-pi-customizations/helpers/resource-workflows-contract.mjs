import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GREETING_CASES = Object.freeze([
  Object.freeze({ id: 'help', args: ['--help'], stdout: 'Usage: greet hello NAME\n', stderr: '', code: 0 }),
  Object.freeze({ id: 'version', args: ['--version'], stdout: 'greet 1.0.0\n', stderr: '', code: 0 }),
  Object.freeze({ id: 'greeting', args: ['hello', 'Ada'], stdout: 'Hello Ada\n', stderr: '', code: 0 }),
  Object.freeze({ id: 'empty-name', args: ['hello', ''], stdout: 'Hello \n', stderr: '', code: 0 }),
  Object.freeze({ id: 'unicode', args: ['hello', 'Zoë'], stdout: 'Hello Zoë\n', stderr: '', code: 0 }),
  Object.freeze({ id: 'invalid', args: ['unknown'], stdout: '', stderr: 'Usage: greet hello NAME\n', code: 2 }),
]);

export function processObservation(command, args, options) {
  const result = spawnSync(command, args, { ...options, timeout: 10000, maxBuffer: 1048576 });
  return { stdout: result.stdout ?? Buffer.alloc(0), stderr: result.stderr ?? Buffer.alloc(0), code: result.status, signal: result.signal, error: result.error?.message ?? null };
}

export function captureReference({ target, out, cwd, env }) {
  const sha = createHash('sha256').update(readFileSync(target)).digest('hex');
  const directory = join(out, sha);
  const observations = GREETING_CASES.map((item) => {
    const actual = processObservation(target, item.args, { cwd, env });
    if (actual.error || actual.signal || actual.code !== item.code || actual.stdout.toString() !== item.stdout || actual.stderr.toString() !== item.stderr) throw new Error(`Reference fixture violated ${item.id}.`);
    const path = join(directory, item.id);
    mkdirSync(path, { recursive: true });
    const meta = { id: item.id, args: item.args, code: actual.code, signal: actual.signal, error: actual.error, referenceSha256: sha, command: target, capturedAt: new Date().toISOString() };
    for (const [name, data] of [['stdout.raw', actual.stdout], ['stderr.raw', actual.stderr], ['meta.json', JSON.stringify(meta, null, 2)]]) {
      writeFileSync(join(path, name), data);
      chmodSync(join(path, name), 0o444);
    }
    return { ...meta, stdout: actual.stdout.toString('base64'), stderr: actual.stderr.toString('base64') };
  });
  return { sha, directory, observations };
}

export function comparePackaged({ artifact, reference, cwd, env, profile }) {
  const cases = reference.observations.map((item) => {
    const actual = processObservation('/usr/bin/sandbox-exec', ['-f', profile, 'python3', artifact, ...item.args], { cwd, env });
    return { id: item.id, code: actual.code, signal: actual.signal, error: actual.error, stdout: actual.stdout.toString('base64'), stderr: actual.stderr.toString('base64'),
      matched: !actual.error && !actual.signal && actual.code === item.code && actual.stdout.toString('base64') === item.stdout && actual.stderr.toString('base64') === item.stderr };
  });
  return { artifactSha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'), cases, allMatched: cases.every((item) => item.matched) };
}
