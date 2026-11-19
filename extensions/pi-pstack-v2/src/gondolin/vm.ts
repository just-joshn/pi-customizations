import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ReadonlyProvider, RealFSProvider, VM } from '@earendil-works/gondolin';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { GUEST_WORKSPACE } from './paths.ts';

export const STATUS_KEY = 'gondolin';
const DEFAULT_SHELL = '/bin/sh';
const BASH_PROBE = [DEFAULT_SHELL, '-lc', 'command -v bash || true'];
const SHORT_ID_LENGTH = 8;
// Pi names skill files by their host path, so the package is mounted read-only at that same path in the guest.
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

/** The session's one VM, started on first use and shared by every tool call until shutdown. */
export type GondolinVm = {
  ensure: (ctx?: ExtensionContext) => Promise<VM>;
  close: (ctx: ExtensionContext) => Promise<void>;
  shellPath: () => string;
};

export function createGondolinVm(localCwd: string): GondolinVm {
  let vm: VM | undefined;
  let starting: Promise<VM> | undefined;
  // Commands run in bash when the guest image has it, and in the POSIX shell otherwise.
  let shellPath = DEFAULT_SHELL;

  const start = async (ctx?: ExtensionContext): Promise<VM> => {
    ctx?.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('accent', `Gondolin: starting ${GUEST_WORKSPACE}`));
    const created = await VM.create({
      sessionLabel: `pi ${path.basename(localCwd)}`,
      vfs: { mounts: { [GUEST_WORKSPACE]: new RealFSProvider(localCwd), [PACKAGE_ROOT]: new ReadonlyProvider(new RealFSProvider(PACKAGE_ROOT)) } },
    });
    const bashProbe = await created.exec(BASH_PROBE);
    shellPath = bashProbe.stdout.trim() || DEFAULT_SHELL;
    vm = created;
    ctx?.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('accent', `Gondolin: ${created.id.slice(0, SHORT_ID_LENGTH)} (${GUEST_WORKSPACE})`));
    ctx?.ui.notify(`Gondolin VM ready. ${localCwd} is mounted at ${GUEST_WORKSPACE}.`, 'info');
    return created;
  };

  // Concurrent callers share one start, so a burst of tool calls at session start boots a single VM.
  const ensure = async (ctx?: ExtensionContext): Promise<VM> => {
    if (vm) return vm;
    starting ??= start(ctx).finally(() => {
      starting = undefined;
    });
    return starting;
  };

  const close = async (ctx: ExtensionContext): Promise<void> => {
    const activeVm = vm;
    vm = undefined;
    starting = undefined;
    if (!activeVm) return;
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('muted', 'Gondolin: stopping'));
    try {
      await activeVm.close();
    } finally {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  };

  return { ensure, close, shellPath: () => shellPath };
}
