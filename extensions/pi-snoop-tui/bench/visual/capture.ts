import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** usage: capture.ts <label> <cols> <rows> [pi args...] */
const ARGV_USER_START = 2;
const POLL_MS = 250;
const MAX_POLLS = 80;
const STABLE_POLLS = 4;
const KEYS_SETTLE_MS = 1500;
const TRAILING_NEWLINES = /\n+$/;
const WHITESPACE = /\s+/;
const SOCKET_NAME = 'snoop-cap.sock';

const Args = z.tuple([z.string(), z.string(), z.string()]).rest(z.string());
const Env = z.object({ FIXTURE: z.string().optional(), KEYS: z.string().optional(), TMPDIR: z.string().optional(), PWD: z.string().optional() });

interface Capture {
  readonly sock: string;
  readonly sess: string;
}

/** Runs a command to completion, failing the script when it fails, like `set -e`. */
function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 1).join(' ')} exited with ${result.status}`);
  return result.stdout;
}

const tmux = (capture: Capture, ...args: string[]): string => run('tmux', ['-S', capture.sock, ...args]);

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms);
};

const pane = (capture: Capture, ...flags: string[]): string => tmux(capture, 'capture-pane', ...flags, '-t', capture.sess);

/** Polls the pane until it stops changing, or until the polls run out, and returns the last frame. */
function waitForStableFrame(capture: Capture): string {
  let previous = '';
  let current = '';
  let stable = 0;
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    sleep(POLL_MS);
    current = pane(capture, '-p', '-e').replace(TRAILING_NEWLINES, '');
    if (current === previous && current !== '') {
      stable += 1;
      if (stable >= STABLE_POLLS) break;
    } else {
      stable = 0;
    }
    previous = current;
  }
  return current;
}

const toPng = (here: string, ansi: string, png: string): void => {
  run('uv', ['run', '-q', '--with', 'pillow', 'python', join(here, 'ansi2png.py'), ansi, png]);
};

function writeFixture(here: string, work: string, fixture: string | undefined, cwd: string): string {
  const session = join(work, 's.jsonl');
  if (fixture) copyFileSync(fixture, session);
  else run(process.execPath, [join(here, 'mockup-fixture.ts'), session, cwd]);
  return session;
}

function main(): void {
  const [label, cols, rows, ...piArgs] = Args.parse(process.argv.slice(ARGV_USER_START));
  const env = Env.parse(process.env);
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, 'out');
  mkdirSync(out, { recursive: true });
  const tmp = env.TMPDIR || tmpdir();
  const capture: Capture = { sock: join(tmp, SOCKET_NAME), sess: `snoop-${label}-${process.pid}` };
  const work = mkdtempSync(join(tmp, 'snoop-capture.'));
  const session = writeFixture(here, work, env.FIXTURE, env.PWD ?? process.cwd());
  // biome-ignore lint/security/noSecrets: terminal environment variable
  tmux(capture, 'new-session', '-d', '-s', capture.sess, '-x', cols, '-y', rows, '--', 'env', 'COLORTERM=truecolor', 'pi', ...piArgs, '--session', session);
  const frame = waitForStableFrame(capture);
  writeFileSync(join(out, `${label}.ansi`), `${frame}\n`);
  writeFileSync(join(out, `${label}.txt`), pane(capture, '-p'));
  if (env.KEYS) {
    tmux(capture, 'send-keys', '-t', capture.sess, ...env.KEYS.split(WHITESPACE).filter((key) => key !== ''));
    sleep(KEYS_SETTLE_MS);
    writeFileSync(join(out, `${label}-keys.ansi`), pane(capture, '-p', '-e'));
    toPng(here, join(out, `${label}-keys.ansi`), join(out, `${label}-keys.png`));
  }
  tmux(capture, 'kill-session', '-t', capture.sess);
  rmSync(work, { recursive: true, force: true });
  toPng(here, join(out, `${label}.ansi`), join(out, `${label}.png`));
  process.stdout.write(`${join(out, `${label}.png`)}\n`);
}

main();
