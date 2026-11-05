// The Linux read-only sandbox: bubblewrap with every namespace but the network unshared, the whole filesystem bound read-only, and a
// seccomp filter that refuses Unix sockets. bubblewrap installs the filter itself, so this needs no nested user
// namespace, which hosts with kernel.apparmor_restrict_unprivileged_userns=1 (Ubuntu 24.04 and later) refuse.
import { spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, existsSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const LD_ABS_W = 0x20;
const JEQ_K = 0x15;
const JGE_K = 0x35;
const RET_K = 0x06;
const SECCOMP_RET_ALLOW = 0x7fff_0000;
const SECCOMP_RET_ERRNO_EPERM = 0x0005_0001;
const SECCOMP_RET_KILL_PROCESS = 0x8000_0000;
const X32_SYSCALL_BIT = 0x4000_0000;
const AF_UNIX = 1;

const ARCHES: Record<string, { audit: number; socket: number; ioUringSetup: number }> = {
  x64: { audit: 0xc000_003e, socket: 41, ioUringSetup: 425 },
  arm64: { audit: 0xc000_00b7, socket: 198, ioUringSetup: 425 },
};

const instruction = (code: number, jt: number, jf: number, k: number): Buffer => {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt16LE(code, 0);
  bytes.writeUInt8(jt, 2);
  bytes.writeUInt8(jf, 3);
  bytes.writeUInt32LE(k >>> 0, 4);
  return bytes;
};

/**
 * A classic BPF seccomp program: socket(AF_UNIX, ...) and io_uring_setup fail with EPERM, any other architecture or
 * the x32 ABI kills the process, and everything else is allowed. Jumps are relative to the next instruction.
 */
export function seccompFilter(arch: string): Buffer {
  const target = ARCHES[arch];
  if (target === undefined) throw new Error(`the read-only shell has no seccomp filter for ${arch}`);
  return Buffer.concat([
    instruction(LD_ABS_W, 0, 0, 4), // 0: architecture
    instruction(JEQ_K, 0, 8, target.audit), // 1: native → 2, otherwise → 10
    instruction(LD_ABS_W, 0, 0, 0), // 2: syscall number
    instruction(JGE_K, 6, 0, X32_SYSCALL_BIT), // 3: x32 → 10
    instruction(JEQ_K, 0, 2, target.socket), // 4: socket → 5, otherwise → 7
    instruction(LD_ABS_W, 0, 0, 16), // 5: low word of the first argument, the domain
    instruction(JEQ_K, 2, 1, AF_UNIX), // 6: AF_UNIX → 9, otherwise → 8
    instruction(JEQ_K, 1, 0, target.ioUringSetup), // 7: io_uring_setup → 9, otherwise → 8
    instruction(RET_K, 0, 0, SECCOMP_RET_ALLOW), // 8
    instruction(RET_K, 0, 0, SECCOMP_RET_ERRNO_EPERM), // 9
    instruction(RET_K, 0, 0, SECCOMP_RET_KILL_PROCESS), // 10
  ]);
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** bubblewrap's arguments before the command: nothing is writable and nothing outside is reachable. */
export function bwrapArgs(cwd: string): string[] {
  return ['--new-session', '--die-with-parent', '--unshare-all', '--share-net', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--cap-drop', 'ALL', '--chdir', cwd, '--seccomp', '3'];
}

interface Sandbox {
  bwrap: string;
  filterPath: string;
  shell: string;
}

/** The first executable `name` on PATH, so every command runs the bubblewrap the check ran. */
function onPath(name: string): string | undefined {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter).filter((entry) => entry !== '')) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return undefined;
}

let verified: { sandbox: Sandbox } | { error: Error } | undefined;

/** The checked sandbox, or the error that stopped it; either is kept, so a failed host never retries into a weaker state. */
function verifiedSandbox(): Sandbox {
  verified ??= (() => {
    try {
      return { sandbox: checkSandbox() };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  })();
  if ('error' in verified) throw verified.error;
  return verified.sandbox;
}

/** Writes the filter into a private directory and checks that bubblewrap can load it here. */
function checkSandbox(): Sandbox {
  const filter = seccompFilter(process.arch);
  const bwrap = onPath('bwrap');
  if (bwrap === undefined) throw new Error('bubblewrap (bwrap) is not available: no bwrap on PATH');
  const dir = mkdtempSync(join(tmpdir(), 'pi-pstack-ro-'));
  const filterPath = join(dir, 'unix-block.bpf');
  writeFileSync(filterPath, filter, { mode: 0o400 });
  const shell = existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  const fd = openSync(filterPath, 'r');
  try {
    const probe = spawnSync(bwrap, [...bwrapArgs('/'), '--', shell, '-c', 'exit 0'], { stdio: ['ignore', 'ignore', 'pipe', fd], encoding: 'utf8', timeout: 15_000 });
    if (probe.error !== undefined) throw new Error(`bubblewrap (bwrap) could not run: ${probe.error.message}`);
    if (probe.status !== 0) throw new Error(`bubblewrap could not start the read-only sandbox: ${probe.stderr.trim() || `exit ${probe.status}`}`);
  } finally {
    closeSync(fd);
  }
  return { bwrap, filterPath, shell };
}

/** The shell command that runs `command` inside the read-only sandbox, or an error when no sandbox can start. */
export function linuxReadonlyCommand(command: string, cwd: string): string {
  const { bwrap, filterPath, shell } = verifiedSandbox();
  return `exec ${quote(bwrap)} ${bwrapArgs(cwd).map(quote).join(' ')} -- ${quote(shell)} -c ${quote(command)} 3< ${quote(filterPath)}`;
}
