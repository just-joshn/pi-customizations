import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { VM } from '@earendil-works/gondolin';
import { type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { hostEnv } from '../host-env.ts';
import { isInsideHostPath } from '../paths.ts';
import { SUBAGENT_MEMORY_DIR_ENV } from '../subagent/memory.ts';
import { resolveGondolinConfig } from './config.ts';
import { GUEST_WORKSPACE } from './paths.ts';
import { createVmOptions, type VmPolicyOptions } from './policy.ts';
import { ensureSharedBuildCacheDir, sharedBuildCacheHostDir } from './shared-cache.ts';
import { discoverReadonlySkillMounts } from './skills.ts';

export const STATUS_KEY = 'gondolin';
const DEFAULT_SHELL = '/bin/sh';
const BASH_PROBE = [DEFAULT_SHELL, '-lc', 'command -v bash || true'];
const SHORT_ID_LENGTH = 8;
// Pi names skill files by their host path, so the package is mounted read-only at that same path in the guest.
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

/** A running VM with what its start decided. */
export type Started = {
  vm: VM;
  /** Commands run in bash when the guest image has it, and in the POSIX shell otherwise. */
  shellPath: string;
  /** The host directory shared as /cache, when the VM started with the shared build cache on. */
  sharedBuildCacheDir: string | undefined;
};

/** The session's one VM, started on first use and shared by every tool call until shutdown. */
export type GondolinVm = {
  ensure: (ctx?: ExtensionContext) => Promise<Started>;
  close: (ctx: ExtensionContext) => Promise<void>;
};

/** The memory directory a parent subagent named, when it is a real directory that the workspace mount does not already cover. */
function subagentMemoryMount(localCwd: string, memoryDir: string | undefined): string | undefined {
  if (!memoryDir || !fs.statSync(memoryDir, { throwIfNoEntry: false })?.isDirectory()) return undefined;
  return isInsideHostPath(localCwd, memoryDir) ? undefined : memoryDir;
}

/** What the VM mounts, decided when it starts so the flag, environment and config files are read as they are then. */
function vmPolicy(localCwd: string, flag: unknown): VmPolicyOptions {
  const agentDir = getAgentDir();
  const config = resolveGondolinConfig({ localCwd, agentDir, env: hostEnv(), flag });
  return {
    localCwd,
    readonlyMounts: discoverReadonlySkillMounts({ packageRoot: PACKAGE_ROOT, agentDir, homeDir: os.homedir(), localCwd }),
    sharedBuildCacheDir: config.enableSharedBuildCache ? ensureSharedBuildCacheDir(sharedBuildCacheHostDir()) : undefined,
    writableMemoryDir: subagentMemoryMount(localCwd, hostEnv()[SUBAGENT_MEMORY_DIR_ENV]),
  };
}

const probeShell = async (vm: VM): Promise<string> => (await vm.exec(BASH_PROBE)).stdout.trim() || DEFAULT_SHELL;

export function createGondolinVm(localCwd: string, getFlag: () => unknown = () => undefined): GondolinVm {
  let started: Promise<Started> | undefined;

  const start = async (ctx?: ExtensionContext): Promise<Started> => {
    ctx?.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('accent', `Gondolin: starting ${GUEST_WORKSPACE}`));
    const policy = vmPolicy(localCwd, getFlag());
    const vm = await VM.create(createVmOptions(policy));
    // A VM whose shell probe fails is closed, not leaked.
    const shellPath = await probeShell(vm).catch(async (error: unknown) => {
      await vm.close();
      throw error;
    });
    ctx?.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('accent', `Gondolin: ${vm.id.slice(0, SHORT_ID_LENGTH)} (${GUEST_WORKSPACE})`));
    ctx?.ui.notify(`Gondolin VM ready. ${localCwd} is mounted at ${GUEST_WORKSPACE}.`, 'info');
    return { vm, shellPath, sharedBuildCacheDir: policy.sharedBuildCacheDir };
  };

  // Concurrent callers share one start, so a burst of tool calls at session start boots a single VM.
  // A start that fails is forgotten, so the next call tries again.
  const ensure = async (ctx?: ExtensionContext): Promise<Started> => {
    if (started) return started;
    const attempt: Promise<Started> = start(ctx).catch((error: unknown) => {
      if (started === attempt) started = undefined;
      throw error;
    });
    started = attempt;
    return attempt;
  };

  const close = async (ctx: ExtensionContext): Promise<void> => {
    const pending = started;
    started = undefined;
    // A VM still starting is closed once it is up. A start that failed already closed its VM.
    const active = await pending?.catch(() => undefined);
    if (!active) return;
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('muted', 'Gondolin: stopping'));
    try {
      await active.vm.close();
    } finally {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  };

  return { ensure, close };
}
