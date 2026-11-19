import type { ExecOptions, VM } from '@earendil-works/gondolin';
import type { BashOperations } from '@earendil-works/pi-coding-agent';
import { toGuestPath } from './paths.ts';

const MS_PER_SECOND = 1000;
// The bash tool reads these messages to report a cancelled or timed-out command.
const ABORTED_MESSAGE = 'aborted';

type ExecRequest = Parameters<BashOperations['exec']>[2];

/** The guest takes only string values, and Node's env type allows undefined ones. No env means the VM's default. */
const sanitizeEnv = (env: NodeJS.ProcessEnv | undefined): { env?: Record<string, string> } => (env ? { env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) } : {});

async function streamGuestCommand(vm: VM, argv: string[], options: ExecOptions, onData: (data: Buffer) => void): Promise<{ exitCode: number | null }> {
  const proc = vm.exec(argv, { ...options, stdout: 'pipe', stderr: 'pipe' });
  for await (const chunk of proc.output()) onData(chunk.data);
  const result = await proc;
  return { exitCode: result.exitCode };
}

async function execInGuest(vm: VM, argv: string[], guestCwd: string, { onData, signal, timeout, env }: ExecRequest): Promise<{ exitCode: number | null }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const onTimeout = () => {
    timedOut = true;
    controller.abort();
  };
  const timer = timeout && timeout > 0 ? setTimeout(onTimeout, timeout * MS_PER_SECOND) : undefined;
  try {
    return await streamGuestCommand(vm, argv, { cwd: guestCwd, ...sanitizeEnv(env), signal: controller.signal }, onData).catch((error: unknown) => {
      if (signal?.aborted) throw new Error(ABORTED_MESSAGE);
      if (timedOut) throw new Error(`timeout:${timeout}`);
      throw error;
    });
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Runs shell commands in the guest through the shell the VM probe found, with cwd mapped to the guest. */
export function createGondolinBashOps(vm: VM, localCwd: string, shellPath: string): BashOperations {
  return {
    exec: async (command, cwd, request) => {
      if (request.signal?.aborted) throw new Error(ABORTED_MESSAGE);
      return execInGuest(vm, [shellPath, '-lc', command], toGuestPath(localCwd, cwd), request);
    },
  };
}
