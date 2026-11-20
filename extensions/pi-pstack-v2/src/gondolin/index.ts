/**
 * Gondolin tool routing, ported from Pi's gondolin example extension.
 *
 * Runs Pi's built-in tools inside a local Gondolin micro-VM. The host working directory is mounted at /workspace in
 * the guest. File changes under /workspace write through to the host; other guest filesystem changes stay in the VM.
 * Needs QEMU on the host.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createGondolinBashOps } from './bash.ts';
import { SHARED_BUILD_CACHE_FLAG } from './config.ts';
import { GUEST_WORKSPACE } from './paths.ts';
import { GUEST_BUILD_CACHE } from './shared-cache.ts';
import { registerGuestTools } from './tools.ts';
import { createGondolinVm, type GondolinVm } from './vm.ts';

export const HOST_BOUNDARY_NOTE = [
  'The VM has no `git`, `gh`, `tmux`, or `bun`.',
  'Host paths outside the working directory, such as the Pi agent directory, do not exist in the VM, except this package and the user and package skill directories, which are mounted read-only at their host paths.',
  "Run what needs them on the host with `tmux_run`, and read its output with `tmux_jobs` `output`, since the job's log file is a host path.",
].join(' ');

/** Points the model at the guest workspace in place of the host cwd line, or appends the line when Pi's is absent, then says what only the host has. */
export function guestSystemPrompt(systemPrompt: string, localCwd: string): string {
  const localLine = `Current working directory: ${localCwd}`;
  const guestLine = `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM; host workspace mounted from ${localCwd})`;
  const withGuestCwd = systemPrompt.includes(localLine) ? systemPrompt.replace(localLine, guestLine) : `${systemPrompt}\n\n${guestLine}`;
  return `${withGuestCwd}\n\n${HOST_BOUNDARY_NOTE}`;
}

function registerStatusCommand(pi: ExtensionAPI, guest: GondolinVm, localCwd: string): void {
  pi.registerCommand('gondolin', {
    description: 'Show Gondolin VM status',
    handler: async (_args, ctx) => {
      const activeVm = await guest.ensure(ctx);
      const cacheDir = guest.sharedBuildCacheDir();
      const status = [`Gondolin VM: ${activeVm.id}`, `Host workspace: ${localCwd}`, `Guest workspace: ${GUEST_WORKSPACE}`, `Shell: ${guest.shellPath()}`, ...(cacheDir ? [`Shared build cache: ${cacheDir} -> ${GUEST_BUILD_CACHE}`] : [])];
      ctx.ui.notify(status.join('\n'), 'info');
    },
  });
}

export default function gondolin(pi: ExtensionAPI): void {
  const localCwd = process.cwd();
  pi.registerFlag(SHARED_BUILD_CACHE_FLAG, {
    description: 'Share build-tool caches (npm, pip, cargo, go, ...) between Gondolin and unsandboxed tmux_run jobs',
    type: 'boolean',
    default: false,
  });
  const guest = createGondolinVm(localCwd, () => pi.getFlag(SHARED_BUILD_CACHE_FLAG));

  pi.on('session_start', async (_event, ctx) => {
    await guest.ensure(ctx);
  });
  pi.on('session_shutdown', async (_event, ctx) => guest.close(ctx));
  registerStatusCommand(pi, guest, localCwd);
  registerGuestTools(pi, guest, localCwd);
  pi.on('user_bash', async (_event, ctx) => {
    const activeVm = await guest.ensure(ctx);
    return { operations: createGondolinBashOps(activeVm, localCwd, guest.shellPath()) };
  });
  pi.on('before_agent_start', async (event, ctx) => {
    await guest.ensure(ctx);
    return { systemPrompt: guestSystemPrompt(event.systemPrompt, localCwd) };
  });
}
