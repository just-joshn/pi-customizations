import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { outcomeOf, outputBytes, readAttempt, startAttempt } from '../recorder/index.mjs';

const fixture = fileURLToPath(new URL('./recorder-fixture.mjs', import.meta.url));
const linkedBin = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bin-'));
  mkdirSync(dir, { recursive: true });
  symlinkSync('/bin/sh', join(dir, 'sh-link'));
  return dir;
};
const ready = async (attempt) => {
  while (!Buffer.from(outputBytes(attempt.events())).includes('ready')) await new Promise((r) => setTimeout(r, 20));
};
const spec = async (extra = []) => ({
  root: await mkdtemp(join(tmpdir(), 'rec-')),
  side: 'pi',
  scenarioRef: 'fixture:isatty-resize',
  fixtureRef: null,
  artifactPaths: [],
  launch: { argv: [process.execPath, fixture, ...extra], cwd: tmpdir(), env: { TERM: 'xterm-256color' } },
  geometry: { rows: 24, cols: 80 },
});

test('records tty status and initial geometry from a real PTY', async () => {
  const attempt = await startAttempt(await spec(['7']));
  await ready(attempt);
  attempt.input(Buffer.from('hello\r'), 'literal_user');
  const log = await attempt.done();
  const text = Buffer.from(outputBytes(log.events)).toString('latin1');
  expect(text).toContain('tty:0=1 1=1 2=1');
  expect(text).toContain('size:24x80');
});

test('keeps invalid utf-8 and split multibyte output byte for byte', async () => {
  const attempt = await startAttempt(await spec());
  await ready(attempt);
  attempt.input(Buffer.from('\r'), 'literal_user');
  const bytes = Buffer.from(outputBytes((await attempt.done()).events));
  expect(bytes.includes(Buffer.from([0xff, 0xfe, 0x41]))).toBe(true);
  expect(bytes.includes(Buffer.from([0xe2, 0x82, 0xac]))).toBe(true);
});

test('orders dispatch, write ack, echo, exit, drain and seal with a dense seq', async () => {
  const attempt = await startAttempt(await spec(['7']));
  await ready(attempt);
  attempt.input(Buffer.from('hello\r'), 'literal_user');
  const { events, dir } = await attempt.done();
  const kinds = events.map((e) => e.kind);
  expect(kinds.slice(0, 2)).toEqual(['launch_intent', 'process_started']);
  expect(kinds.slice(-3)).toEqual(['exited', 'drained', 'sealed']);
  const dispatched = events.find((e) => e.kind === 'input_dispatched');
  expect(Buffer.from(dispatched.dataB64, 'base64').toString()).toBe('hello\r');
  expect(events.find((e) => e.kind === 'input_written').bytesSubmitted).toBe(6);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  expect(outcomeOf(events)).toEqual({ kind: 'exited', exitCode: 7 });
  expect((await readAttempt(dir)).events).toEqual(events);
});

test('records a missing executable as launch_failed without process_started', async () => {
  const s = await spec();
  const attempt = await startAttempt({ ...s, launch: { ...s.launch, argv: ['/nonexistent/bin'] } });
  const { events } = await attempt.done();
  expect(events.map((e) => e.kind)).toEqual(['launch_intent', 'spawn_failed', 'sealed']);
  expect(outcomeOf(events).kind).toBe('launch_failed');
});

test('records a resize and the child sees the new geometry', async () => {
  const attempt = await startAttempt(await spec());
  await ready(attempt);
  attempt.resize({ rows: 40, cols: 100 });
  await new Promise((r) => setTimeout(r, 200));
  attempt.input(Buffer.from('\r'), 'literal_user');
  const { events } = await attempt.done();
  expect(events.find((e) => e.kind === 'resize')).toMatchObject({ rows: 40, cols: 100 });
  expect(Buffer.from(outputBytes(events)).toString('latin1')).toContain('size:40x100');
});

test('cancel is idempotent and ends the attempt as cancelled', async () => {
  const attempt = await startAttempt(await spec());
  await ready(attempt);
  await Promise.all([attempt.cancel(), attempt.cancel()]);
  const { events } = await attempt.done();
  expect(events.filter((e) => e.kind === 'cancel_requested')).toHaveLength(1);
  expect(outcomeOf(events).kind).toBe('cancelled');
});

test('two attempts from one root use separate directories', async () => {
  const s = await spec(['0']);
  const first = await startAttempt(s);
  const second = await startAttempt(s);
  await Promise.all([first.cancel(), second.cancel()]);
  expect(first.dir).not.toBe(second.dir);
});

test('an attempt log without a seal reads as interrupted', async () => {
  const attempt = await startAttempt(await spec());
  await ready(attempt);
  const partial = attempt.events();
  await attempt.cancel();
  await attempt.done();
  expect(outcomeOf(partial)).toEqual({ kind: 'interrupted', lastSeq: partial.at(-1).seq });
});

test('rejects a symlink as the recorder root', async () => {
  const s = await spec();
  const link = join(await mkdtemp(join(tmpdir(), 'lnk-')), 'root');
  await symlink(s.root, link);
  await expect(startAttempt({ ...s, root: link })).rejects.toThrow(/real directory/);
});

test('keeps parent environment values out of the recorded identity and events', async () => {
  process.env.RECORDER_CANARY = 'canary-value-9137';
  const attempt = await startAttempt(await spec(['0']));
  await ready(attempt);
  attempt.input(Buffer.from('\r'), 'literal_user');
  const { dir } = await attempt.done();
  delete process.env.RECORDER_CANARY;
  const files = ['identity.json', 'events.jsonl'].map((f) => readFileSync(join(dir, f), 'utf8'));
  expect(files.join('')).not.toContain('canary-value-9137');
});

test('retains every byte of heavy output in order', async () => {
  const s = await spec();
  const script = "process.stdout.write('x'.repeat(2000000)); process.stdout.write('END');";
  const attempt = await startAttempt({ ...s, launch: { ...s.launch, argv: [process.execPath, '-e', script] } });
  const bytes = Buffer.from(outputBytes((await attempt.done()).events)).toString('latin1');
  expect(bytes.length).toBe(2000003);
  expect(bytes.endsWith('xEND')).toBe(true);
});

test('cancel, input and resize after the seal do not crash and do not extend the log', async () => {
  const attempt = await startAttempt(await spec(['0']));
  await ready(attempt);
  attempt.input(Buffer.from('\r'), 'literal_user');
  const sealed = await attempt.done();
  await attempt.cancel();
  expect(() => attempt.input(Buffer.from('x'), 'literal_user')).toThrow(/sealed/);
  expect(() => attempt.resize({ rows: 10, cols: 10 })).toThrow(/sealed/);
  await new Promise((r) => setTimeout(r, 50));
  expect((await readAttempt(sealed.dir)).events).toEqual(sealed.events);
});

test('identity omits secret env values and redacted argv entries and is private', async () => {
  const s = await spec(['0']);
  const secret = 'tok-secret-5521';
  const attempt = await startAttempt({
    ...s,
    publicEnv: ['TERM'],
    secretArgIndexes: [2],
    launch: { ...s.launch, argv: [process.execPath, fixture, secret], env: { ...s.launch.env, API_TOKEN: secret } },
  });
  await ready(attempt);
  attempt.input(Buffer.from('\r'), 'literal_user');
  const { dir } = await attempt.done();
  const text = readFileSync(join(dir, 'identity.json'), 'utf8');
  expect(text).not.toContain(secret);
  expect(text).toContain('API_TOKEN');
  expect(statSync(join(dir, 'identity.json')).mode & 0o077).toBe(0);
});

test('a log whose last line is cut off reads as interrupted with the truncated tail flagged', async () => {
  const attempt = await startAttempt(await spec(['0']));
  await ready(attempt);
  attempt.input(Buffer.from('\r'), 'literal_user');
  const { dir } = await attempt.done();
  const path = join(dir, 'events.jsonl');
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  writeFileSync(path, `${lines.slice(0, -2).join('\n')}\n${lines.at(-2).slice(0, 10)}`);
  const log = await readAttempt(dir);
  expect(log.truncatedTail).toBe(true);
  expect(outcomeOf(log.events).kind).toBe('interrupted');
});

test('a descendant still alive at the seal is reported as an error event and killed', async () => {
  const s = await spec();
  const script = `require('child_process').spawn('sh',['-c','trap "" HUP; sleep 30'],{stdio:'inherit'}).unref(); setTimeout(() => console.log('leader-done'), 300)`;
  const attempt = await startAttempt({ ...s, launch: { ...s.launch, argv: [process.execPath, '-e', script] } });
  const { events } = await attempt.done();
  const err = events.find((e) => e.kind === 'error' && e.where === 'descendants_alive');
  expect(err).toBeDefined();
  const pid = events.find((e) => e.kind === 'process_started').pid;
  await new Promise((r) => setTimeout(r, 200));
  expect(() => process.kill(-pid, 0)).toThrow();
});

test('a relative executable resolves against the launch cwd and a bare name against PATH', async () => {
  const s = await spec();
  const rel = await startAttempt({ ...s, launch: { ...s.launch, argv: ['./sh-link', '-c', 'exit 0'], cwd: await linkedBin(), env: { TERM: 'x' } } });
  expect(outcomeOf((await rel.done()).events).kind).toBe('exited');
  const bare = await startAttempt({ ...s, launch: { ...s.launch, argv: ['no-such-cmd-xyz'], env: { PATH: '/usr/bin:/bin' } } });
  const log = await bare.done();
  expect(outcomeOf(log.events).kind).toBe('launch_failed');
  const ok = await startAttempt({ ...s, launch: { ...s.launch, argv: ['sh', '-c', 'exit 0'], env: { PATH: '/usr/bin:/bin' } } });
  const okLog = await ok.done();
  expect(okLog.identity.executable.path).toMatch(/\/sh$/);
});

test('input on a launch-failed attempt throws before logging a dispatch', async () => {
  const s = await spec();
  const attempt = await startAttempt({ ...s, launch: { ...s.launch, argv: ['/nonexistent/bin'] } });
  expect(() => attempt.input(Buffer.from('x'), 'literal_user')).toThrow();
  expect(attempt.events().some((e) => e.kind === 'input_dispatched')).toBe(false);
});

test('signals are recorded by name', async () => {
  const attempt = await startAttempt(await spec());
  await ready(attempt);
  await attempt.cancel();
  const exit = (await attempt.done()).events.find((e) => e.kind === 'exited');
  expect(exit.signal).toMatch(/^SIG[A-Z]+$/);
});
