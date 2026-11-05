// A cloud agent on a container machine keeps its Pi process (and the model credentials) on the host and runs its tools
// on the machine, the split Pi's containerization guide and Cursor's cloud workers both use. Every path the agent
// names is a path on the machine: the clone is bind-mounted at the same absolute path, and any other path exists only
// inside the container, so host files outside the clone are never read or written.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as osConstants } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type ExtensionAPI,
  type LsOperations,
  type ReadOperations,
  type WriteOperations,
} from '@earendil-works/pi-coding-agent';
import type { JobSpawner } from '../background-shell.ts';
import { docker, dockerPrefix } from './docker.ts';
import type { ContainerMachine } from './machine.ts';

const KILL_GRACE_SECONDS = 2;

export const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** argv for `docker exec` that runs `command` with bash in its own session, recording the session leader's pid. */
export function execArgv(machine: Pick<ContainerMachine, 'container'>, cwd: string, command: string, execId: string, interactive = false): string[] {
  const leader = `mkdir -p /tmp/pstack-exec && echo $$ > /tmp/pstack-exec/${execId} && exec bash -c "$1"`;
  return [...dockerPrefix(), 'exec', ...(interactive ? ['-i'] : []), '-w', cwd, machine.container, 'setsid', '-w', 'bash', '-c', leader, 'pstack', command];
}

/** Ends the process group a routed command started inside the machine: TERM, then KILL after a grace period. */
export function killInMachine(machine: Pick<ContainerMachine, 'container'>, execId: string): Promise<void> {
  const file = `/tmp/pstack-exec/${execId}`;
  const script = `pid=$(cat ${file} 2>/dev/null) || exit 0; kill -TERM -- -$pid 2>/dev/null; for i in $(seq 1 ${KILL_GRACE_SECONDS * 10}); do kill -0 -- -$pid 2>/dev/null || exit 0; sleep 0.1; done; kill -KILL -- -$pid 2>/dev/null; exit 0`;
  return docker(['exec', machine.container, 'sh', '-c', script], { timeoutMs: 15_000 }).then(
    () => undefined,
    () => undefined,
  );
}

/** Pi's bash operations, executed in the machine with the same abort, timeout, and exit-code contract as Pi's own. */
export function machineBashOperations(machine: Pick<ContainerMachine, 'container'>): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      if (signal?.aborted) throw new Error('aborted');
      const execId = randomUUID();
      const child = spawn('docker', execArgv(machine, cwd, command, execId), { stdio: ['ignore', 'pipe', 'pipe'] });
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        void killInMachine(machine, execId).finally(() => child.kill('SIGKILL'));
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      if (timeout !== undefined) {
        timer = setTimeout(() => {
          timedOut = true;
          stop();
        }, timeout * 1_000);
      }
      signal?.addEventListener('abort', stop, { once: true });
      try {
        const { code, signalCode } = await new Promise<{ code: number | null; signalCode: NodeJS.Signals | null }>((done, fail) => {
          child.once('error', fail);
          child.once('close', (exitCode, exitSignal) => done({ code: exitCode, signalCode: exitSignal }));
        });
        if (signal?.aborted) throw new Error('aborted');
        if (timedOut) throw new Error(`timeout:${timeout}`);
        return { exitCode: code ?? (signalCode === null ? 1 : 128 + (osConstants.signals[signalCode] ?? 0)) };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
      }
    },
  };
}

/** bash_background on the machine: the local `docker exec` carries the job's output, and ending the job kills it on the machine. */
export function machineJobSpawner(machine: Pick<ContainerMachine, 'container'>): JobSpawner {
  return {
    spawn: (command, cwd) => {
      const execId = randomUUID();
      const child = spawn('docker', execArgv(machine, cwd, command, execId), { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      return { child, end: () => void killInMachine(machine, execId) };
    },
  };
}

const quoteFree = (path: string) => ['--', path];

/** Reads a file from the machine; missing files reject with ENOENT like the host filesystem does. */
async function readInMachine(machine: Pick<ContainerMachine, 'container'>, path: string): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = spawn('docker', [...dockerPrefix(), 'exec', machine.container, 'cat', ...quoteFree(path)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', fail);
    child.once('close', (code) => {
      if (code === 0) done(Buffer.concat(chunks));
      else fail(Object.assign(new Error(`ENOENT: ${stderr.trim() || `cannot read ${path} on the cloud machine`}`), { code: 'ENOENT' }));
    });
  });
}

async function testInMachine(machine: Pick<ContainerMachine, 'container'>, flag: string, path: string): Promise<boolean> {
  try {
    await docker(['exec', machine.container, 'test', flag, path], { timeoutMs: 30_000 });
    return true;
  } catch {
    return false;
  }
}

function writeInMachine(machine: Pick<ContainerMachine, 'container'>, path: string, content: string): Promise<void> {
  return docker(['exec', '-i', machine.container, 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'pstack', path], { input: content, timeoutMs: 60_000 }).then(() => undefined);
}

export function machineReadOperations(machine: ContainerMachine): ReadOperations {
  return {
    readFile: (path) => readInMachine(machine, path),
    access: async (path) => {
      if (!(await testInMachine(machine, '-r', path))) throw Object.assign(new Error(`ENOENT: no such file on the cloud machine: ${path}`), { code: 'ENOENT' });
    },
  };
}

export function machineWriteOperations(machine: ContainerMachine): WriteOperations {
  return {
    writeFile: (path, content) => writeInMachine(machine, path, content),
    mkdir: (dir) => docker(['exec', machine.container, 'mkdir', '-p', '--', dir], { timeoutMs: 30_000 }).then(() => undefined),
  };
}

export function machineEditOperations(machine: ContainerMachine): EditOperations {
  return {
    readFile: (path) => readInMachine(machine, path),
    writeFile: (path, content) => writeInMachine(machine, path, content),
    access: async (path) => {
      if (!(await testInMachine(machine, '-w', path))) throw Object.assign(new Error(`ENOENT: no writable file on the cloud machine: ${path}`), { code: 'ENOENT' });
    },
  };
}

export function machineLsOperations(machine: ContainerMachine): LsOperations {
  return {
    exists: (path) => testInMachine(machine, '-e', path),
    stat: async (path) => {
      if (!(await testInMachine(machine, '-e', path))) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      const directory = await testInMachine(machine, '-d', path);
      return { isDirectory: () => directory };
    },
    readdir: async (path) => (await docker(['exec', machine.container, 'ls', '-1A', '--', path], { timeoutMs: 30_000 })).split('\n').filter(Boolean),
  };
}

/** Runs `script` in the machine and returns its output as a tool result, for searches outside the clone. */
async function machineSearch(machine: ContainerMachine, cwd: string, script: string, args: readonly string[]) {
  const output = await docker(['exec', '-w', cwd, machine.container, 'sh', '-c', script, 'pstack', ...args], { timeoutMs: 120_000 }).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message : String(error));
  });
  return { content: [{ type: 'text' as const, text: output.trim() === '' ? 'No matches found' : output.trimEnd() }], details: undefined };
}

/**
 * Replaces Pi's built-in tools with versions that act on the machine. find and grep inside the clone keep Pi's own
 * implementation (fd and ripgrep over the bind mount see exactly the machine's files); outside it they search the machine.
 */
export function registerMachineTools(pi: ExtensionAPI, machine: ContainerMachine): void {
  const cwd = machine.cwd;
  pi.registerTool(createBashTool(cwd, { operations: machineBashOperations(machine) }));
  pi.registerTool(createReadTool(cwd, { operations: machineReadOperations(machine) }));
  pi.registerTool(createWriteTool(cwd, { operations: machineWriteOperations(machine) }));
  pi.registerTool(createEditTool(cwd, { operations: machineEditOperations(machine) }));
  pi.registerTool(createLsTool(cwd, { operations: machineLsOperations(machine) }));
  const find = createFindTool(cwd);
  pi.registerTool({
    ...find,
    async execute(toolCallId, params, signal, onUpdate) {
      const target = resolve(cwd, params.path ?? '.');
      if (isInside(machine.path, target)) return find.execute(toolCallId, params, signal, onUpdate);
      return machineSearch(machine, cwd, 'find "$1" -name "$2" 2>/dev/null | head -n "$3"', [target, params.pattern, String(params.limit ?? 1000)]);
    },
  });
  const grep = createGrepTool(cwd);
  pi.registerTool({
    ...grep,
    async execute(toolCallId, params, signal, onUpdate) {
      const target = resolve(cwd, params.path ?? '.');
      if (isInside(machine.path, target)) return grep.execute(toolCallId, params, signal, onUpdate);
      const flags = `-rn${params.ignoreCase === true ? 'i' : ''}${params.literal === true ? 'F' : 'E'}`;
      return machineSearch(machine, cwd, `grep ${flags} -- "$1" "$2" 2>/dev/null | head -n "$3"`, [params.pattern, target, String(params.limit ?? 100)]);
    },
  });
}
