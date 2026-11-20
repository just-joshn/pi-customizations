/**
 * The Pi process a subagent starts in tmux, as a test double. It reports how it was started to the test over the unix
 * socket named by FAKE_PI_SOCKET, then prints and exits as the test directs. It stops when the test stops listening or
 * when tmux hangs up the wrapper that started it, as a real Pi would when its tmux server is killed.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import { createInterface } from 'node:readline';

import { z } from 'zod';

const STDOUT_FD = 1;
const STDERR_FD = 2;
const PARENT_POLL_MS = 20;
const KILLED_EXIT_CODE = 1;
const LAUNCHER_ARGS_START = 2;

const Environment = z.object({ FAKE_PI_SOCKET: z.string(), FAKE_PI_VIA: z.string().default('script') }).catchall(z.string().optional());
const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stdout'), text: z.string() }),
  z.object({ type: z.literal('stderr'), text: z.string() }),
  z.object({ type: z.literal('exit'), code: z.number() }),
  z.object({ type: z.literal('vanish') }),
]);

const env = Environment.parse(process.env);
const args = z.array(z.string()).parse(process.argv.slice(LAUNCHER_ARGS_START));
const wrapper = process.ppid;
const socket = net.connect(env.FAKE_PI_SOCKET);

const send = (message) => socket.write(`${JSON.stringify(message)}\n`);

/** The wrapper script that started this process is its parent until tmux hangs the wrapper up. */
const wrapperIsAlive = () => process.ppid === wrapper;

const handlers = {
  stdout: ({ text }) => fs.writeSync(STDOUT_FD, text),
  stderr: ({ text }) => fs.writeSync(STDERR_FD, text),
  exit: ({ code }) => process.exit(code),
  vanish: () => {
    process.kill(wrapper, 'SIGKILL');
    process.exit(KILLED_EXIT_CODE);
  },
};

socket.on('connect', () => send({ type: 'hello', via: env.FAKE_PI_VIA, args, cwd: process.cwd(), env }));
socket.on('close', () => process.exit(KILLED_EXIT_CODE));
socket.on('error', () => process.exit(KILLED_EXIT_CODE));
createInterface({ input: socket }).on('line', (line) => {
  const command = Command.parse(JSON.parse(line));
  handlers[command.type](command);
});

setInterval(() => {
  if (!wrapperIsAlive()) socket.end(`${JSON.stringify({ type: 'orphaned' })}\n`);
}, PARENT_POLL_MS);
