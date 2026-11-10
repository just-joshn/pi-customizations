// bubblewrap loads the seccomp filter itself, or the s390x broker does, so this needs no nested user namespace, which hosts with
// kernel.apparmor_restrict_unprivileged_userns=1 (Ubuntu 24.04 and later) refuse.
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, closeSync, constants, copyFileSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BROKER_POLICY, brokeredSeccompFilter, seccompFilter } from './seccomp-filter.ts';

const FILTER_FD = 3;
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

type Sandbox = { kind: 'filter'; bwrap: string; shell: string; filterPath: string } | { kind: 'broker'; bwrap: string; shell: string; filterPath: string; helper: string };

/** bubblewrap's arguments before the command: nothing is writable, and only the network is shared with the host. */
function bwrapArgs(cwd: string): string[] {
  return ['--new-session', '--die-with-parent', '--unshare-all', '--share-net', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--cap-drop', 'ALL', '--chdir', cwd];
}

/** The one chain a command, and the check that vouches for it, both run: the broker (when there is one) starts bubblewrap, which starts `inner`. */
function launchArgv(sandbox: Sandbox, cwd: string, inner: string[]): string[] {
  const bubblewrap = [sandbox.bwrap, ...bwrapArgs(cwd), ...(sandbox.kind === 'broker' ? [] : ['--seccomp', String(FILTER_FD)]), '--', ...inner];
  return sandbox.kind === 'broker' ? [sandbox.helper, '--policy', BROKER_POLICY, '--filter-fd', String(FILTER_FD), '--', ...bubblewrap] : bubblewrap;
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

/** Copies the packaged broker somewhere executable, or returns undefined when there is none or it cannot be copied. */
function stageBroker(dir: string): string | undefined {
  const staged = join(dir, 'netbroker');
  try {
    copyFileSync(fileURLToPath(new URL(`../dist/netbroker-${process.arch}`, import.meta.url)), staged);
    chmodSync(staged, 0o700);
  } catch {
    return undefined;
  }
  return staged;
}

/** Runs `argv` with `filterPath` open as fd 3, and returns why it did not exit 0 within the timeout, or undefined when it did. */
function failureOf(argv: string[], filterPath: string): string | undefined {
  const [command = '', ...args] = argv;
  const fd = openSync(filterPath, 'r');
  try {
    const probe = spawnSync(command, args, { stdio: ['ignore', 'ignore', 'pipe', fd], encoding: 'utf8', timeout: 15_000 });
    if (probe.error !== undefined) return probe.error.message;
    return probe.status === 0 ? undefined : probe.stderr.trim() || `exit ${probe.status}`;
  } finally {
    closeSync(fd);
  }
}

/** Checks, in the exact chain a command will run, that this host can load the filter, and the broker where this architecture has one. */
function checkSandbox(): Sandbox {
  const bwrap = onPath('bwrap');
  if (bwrap === undefined) throw new Error('bubblewrap (bwrap) is not available: no bwrap on PATH');
  const dir = mkdtempSync(join(tmpdir(), 'pi-pstack-ro-'));
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  const shell = existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  const filterPath = join(dir, 'unix-block.bpf');
  writeFileSync(filterPath, seccompFilter(process.arch), { mode: 0o400 });
  const filter: Sandbox = { kind: 'filter', bwrap, shell, filterPath };
  const failure = failureOf(launchArgv(filter, '/', [shell, '-c', 'exit 0']), filterPath);
  if (failure !== undefined) throw new Error(`bubblewrap could not start the read-only sandbox: ${failure}`);
  const brokered = brokeredSeccompFilter(process.arch);
  const helper = brokered === undefined ? undefined : stageBroker(dir);
  if (brokered === undefined || helper === undefined) return filter;
  const brokerFilterPath = join(dir, 'broker.bpf');
  writeFileSync(brokerFilterPath, brokered, { mode: 0o400 });
  const broker: Sandbox = { kind: 'broker', bwrap, shell, filterPath: brokerFilterPath, helper };
  return failureOf(launchArgv(broker, '/', [helper, '--policy', BROKER_POLICY, '--selftest']), brokerFilterPath) === undefined ? broker : filter;
}

const CLOSE_INHERITED_DESCRIPTORS = `for f in /proc/self/fd/*; do n=\${f##*/}; if [ "$n" -gt ${FILTER_FD} ]; then eval "exec $n>&-"; fi; done; `;

/** The shell command that runs `command` inside the read-only sandbox, or an error when no sandbox can start. */
export function linuxReadonlyCommand(command: string, cwd: string): string {
  const sandbox = verifiedSandbox();
  const argv = launchArgv(sandbox, cwd, [sandbox.shell, '-c', command]);
  return `${CLOSE_INHERITED_DESCRIPTORS}exec ${argv.map(quote).join(' ')} ${FILTER_FD}< ${quote(sandbox.filterPath)}`;
}
