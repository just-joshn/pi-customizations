/**
 * Gondolin tool routing, ported from Pi's gondolin example extension.
 *
 * Runs Pi's built-in tools inside a local Gondolin micro-VM. The host working directory is mounted at /workspace in
 * the guest. File changes under /workspace write through to the host; other guest filesystem changes stay in the VM.
 * Needs QEMU on the host.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createGondolinBashOps } from './bash.ts';
import { GUEST_WORKSPACE } from './paths.ts';
import { registerGuestTools } from './tools.ts';
import { createGondolinVm, type GondolinVm } from './vm.ts';

/** Points the model at the guest workspace in place of the host cwd line, or appends the line when Pi's is absent. */
export function guestSystemPrompt(systemPrompt: string, localCwd: string): string {
  const localLine = `Current working directory: ${localCwd}`;
  const guestLine = `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM; host workspace mounted from ${localCwd})`;
  return systemPrompt.includes(localLine) ? systemPrompt.replace(localLine, guestLine) : `${systemPrompt}\n\n${guestLine}`;
}

function registerStatusCommand(pi: ExtensionAPI, guest: GondolinVm, localCwd: string): void {
  pi.registerCommand('gondolin', {
    description: 'Show Gondolin VM status',
    handler: async (_args, ctx) => {
      const activeVm = await guest.ensure(ctx);
      const status = [`Gondolin VM: ${activeVm.id}`, `Host workspace: ${localCwd}`, `Guest workspace: ${GUEST_WORKSPACE}`, `Shell: ${guest.shellPath()}`];
      ctx.ui.notify(status.join('\n'), 'info');
    },
  });
}

export default function gondolin(pi: ExtensionAPI): void {
  const localCwd = process.cwd();
  const guest = createGondolinVm(localCwd);

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
