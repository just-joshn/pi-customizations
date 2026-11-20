/**
 * Stands in for the Pi processes a subagent starts. The tool really runs tmux and its job wrapper, and a tmux shim on
 * PATH (shared with the core tests) runs them as plain processes. Only the Pi at the end is a double: `fake-pi-child.mjs`.
 * It tells this module over a unix socket how it was started, and does what a test scripts: print, fail, exit, or
 * disappear with its tmux session.
 *
 * `useWorkspace` starts and stops this for every test. A test scripts children with `fakePi.onChild`, or drives them
 * by hand once `startedChildren` has handed them over.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { vi } from 'vitest';
import { z } from 'zod';
import { type FakeTmux, hangUpFakeTmux, installFakeTmux } from './core-fake-tmux.ts';

const CHILD_SCRIPT = fileURLToPath(new URL('./fake-pi-child.mjs', import.meta.url));
const LAUNCHER_MODE = 0o755;
const SOCKET_NAME = 'fake-pi.sock';
const TMUX_REFUSE = 'FAKE_TMUX_REFUSE';

type Env = NodeJS.ProcessEnv;
type ChildState = 'running' | 'exited' | 'gone';

const ChildMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), via: z.string(), args: z.array(z.string()), cwd: z.string(), env: z.record(z.string(), z.string().optional()) }),
  z.object({ type: z.literal('orphaned') }),
]);
type Hello = Extract<z.infer<typeof ChildMessage>, { type: 'hello' }>;

/** One Pi process the tool started inside tmux. The test script decides what it prints and when it ends. */
export interface FakeChild {
  /** How Pi was launched: `script` for the current Pi script run by node, otherwise the name of the executable. */
  readonly via: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Env;
  readonly state: ChildState;
  /** The text after `Task: ` in the last argument, which is what the tool sends the child to do. */
  readonly task: string;
  /** The value that follows a flag such as `--model`, or undefined when the flag is absent. */
  flag(name: string): string | undefined;
  stdout(text: string): void;
  stderr(text: string): void;
  exit(code: number): void;
  /** The tmux session disappears without the child writing an exit code. */
  vanish(): void;
}

type Link = { child: FakeChild; markGone: () => void };

function createLink({ via, args, cwd, env }: Hello, socket: net.Socket): Link {
  let state: ChildState = 'running';
  const send = (message: object): void => {
    if (state === 'running') socket.write(`${JSON.stringify(message)}\n`);
  };
  const child: FakeChild = {
    via,
    args,
    cwd,
    env,
    get state() {
      return state;
    },
    get task() {
      return (args.at(-1) ?? '').replace(/^Task: /, '');
    },
    flag: (name) => {
      const index = args.indexOf(name);
      return index === -1 ? undefined : args[index + 1];
    },
    stdout: (text) => send({ type: 'stdout', text }),
    stderr: (text) => send({ type: 'stderr', text }),
    exit: (code) => {
      send({ type: 'exit', code });
      state = 'exited';
    },
    vanish: () => {
      send({ type: 'vanish' });
      state = 'gone';
    },
  };
  return {
    child,
    markGone: () => {
      if (state === 'running') state = 'gone';
    },
  };
}

export type ChildScript = (child: FakeChild) => void;

type Live = { server: net.Server; tmux: FakeTmux; compiledPi: string };

let script: ChildScript = () => undefined;
let started: readonly FakeChild[] = [];
let sockets: readonly net.Socket[] = [];
let live: Live | undefined;

function listen(socketPath: string): Promise<net.Server> {
  const server = net.createServer((socket) => {
    sockets = [...sockets, socket];
    let link: Link | undefined;
    createInterface({ input: socket }).on('line', (line) => {
      const message = ChildMessage.parse(JSON.parse(line));
      if (message.type === 'orphaned') return link?.markGone();
      link = createLink(message, socket);
      started = [...started, link.child];
      script(link.child);
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve(server)));
}

/** A launcher is the executable a user would have: it runs the fake Pi and tells it which name it was started by. */
function writeLauncher(file: string): void {
  fs.writeFileSync(file, `#!/bin/sh\nexport FAKE_PI_VIA="$(basename "$0")"\nexec '${process.execPath}' '${CHILD_SCRIPT}' "$@"\n`, { mode: LAUNCHER_MODE });
}

export const fakePi = {
  /** The script file that stands in for the Pi script a running Pi was started from. */
  script: CHILD_SCRIPT,
  /** An executable named `pi-compiled` that is not on PATH, like a compiled Pi binary. */
  compiledPi: (): string => live?.compiledPi ?? '',
  /**
   * Puts the fake tmux, a `pi` on PATH, and the socket the children report to in the environment, and makes the running
   * Pi look like one started from the fake Pi script. A private TMPDIR keeps every run directory of this test visible.
   */
  async start(root: string): Promise<void> {
    script = () => undefined;
    started = [];
    sockets = [];
    const tmux = installFakeTmux(root);
    const binDir = path.join(root, 'fake-pi-bin');
    const tmpDir = path.join(root, 'tmp');
    const socketPath = path.join(root, SOCKET_NAME);
    const compiledPi = path.join(root, 'pi-compiled');
    for (const dir of [binDir, tmpDir]) fs.mkdirSync(dir, { recursive: true });
    for (const file of [path.join(binDir, 'pi'), compiledPi]) writeLauncher(file);
    const env = { ...tmux.env, PATH: `${binDir}${path.delimiter}${tmux.env['PATH']}`, FAKE_PI_SOCKET: socketPath, TMPDIR: tmpDir };
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.stubGlobal('process', { ...process, argv: [process.execPath, CHILD_SCRIPT] });
    live = { server: await listen(socketPath), tmux, compiledPi };
  },
  /** Ends every child, hangs up the fake tmux sessions, and stops listening. */
  async stop(): Promise<void> {
    const current = live;
    live = undefined;
    if (!current) return;
    for (const socket of sockets) socket.destroy();
    hangUpFakeTmux(current.tmux);
    await new Promise<void>((resolve) => current.server.close(() => resolve()));
  },
  onChild(next: ChildScript): void {
    script = next;
  },
  /** Makes starting a tmux session fail, as it does when tmux cannot create the session. */
  failToStart(): void {
    vi.stubEnv(TMUX_REFUSE, '1');
  },
  children: (): readonly FakeChild[] => started,
};
