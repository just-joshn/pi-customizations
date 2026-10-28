import { existsSync } from 'node:fs';

import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import { type BashSpawnContext, createBashTool, type ExtensionAPI, type ExtensionToolContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';

// Cursor's readonly subagent: "no file edits, no state-changing shell commands". The OS sandbox enforces it:
// nothing may be written and no host may be reached, so a pipe, substitution, or pager cannot get around it.
// denyWrite names the paths the sandbox makes writable for itself (/tmp/claude is a dependency default), and
// denyRead drops the dependency's writable home defaults (~/.npm/_logs, ~/.claude/debug). Seatbelt is
// last-match-wins with deny emitted after allow; on Linux bubblewrap binds deny last the same way.
// allowAllUnixSockets skips apply-seccomp: on GitHub-hosted runners (and other nested-userns hosts) that
// helper fails writing /proc/self/setgroups even with setuid bwrap. Write and network denial still come
// from bubblewrap / sandbox-exec; only AF_UNIX blocking is dropped.
const READ_ONLY_POLICY: SandboxRuntimeConfig = {
  network: { allowedDomains: [], deniedDomains: [], allowAllUnixSockets: true },
  filesystem: {
    denyRead: ['~/.npm/_logs', '~/.claude/debug'],
    allowWrite: [],
    denyWrite: ['/tmp/claude', '/private/tmp/claude'],
  },
};

const NOTE = ' This shell is read-only: each command runs in an OS sandbox that denies filesystem writes and network access. Pi and trusted extensions are not sandboxed by it. Use it for commands such as git log, git blame, or rg.';

// Startup hooks and exported shell functions run in the outer shell before the sandbox wrapper does, so none of
// them may reach it.
const STRIP_ENV = ['BASH_ENV', 'ENV', ...Object.keys(process.env).filter((key) => key.startsWith('BASH_FUNC_'))];

type Sandbox = typeof import('@anthropic-ai/sandbox-runtime')['SandboxManager'];

let ready: Promise<Sandbox> | undefined;

/**
 * Starts the sandbox once per process, loading it only in a readonly subagent: a local package install gets no
 * dependency install, and everything else in the package works without it. A failure is kept, so no command ever
 * runs outside the sandbox.
 */
function sandboxReady(): Promise<Sandbox> {
  ready ??= (async () => {
    try {
      const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
      if (!SandboxManager.isSupportedPlatform()) throw new Error(`${process.platform} is not supported`);
      // initialize verifies the sandbox dependencies (bubblewrap, socat, sandbox-exec) before it starts.
      // A second initialize is a no-op once another consumer has started the manager, and several
      // Linux flags (notably allowAllUnixSockets) are read from the manager config, not the per-call
      // wrap override — so updateConfig installs our policy even when we lost the initialize race.
      await SandboxManager.initialize(READ_ONLY_POLICY);
      SandboxManager.updateConfig(READ_ONLY_POLICY);
      return SandboxManager;
    } catch (error) {
      throw new Error(`no verified OS sandbox is available: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
  return ready;
}

function strippedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const name of STRIP_ENV) delete clean[name];
  return clean;
}

type BashParameters = ReturnType<typeof createBashTool>['parameters'];

/**
 * The read-only shell as a tool definition: every command runs inside the read-only OS sandbox, or not at all.
 * `name` lets a caller offer it next to Pi's own `bash` (plan mode does).
 */
export function createReadonlyBashTool(name = 'bash'): ToolDefinition<BashParameters> {
  const base = createBashTool(process.cwd());
  return {
    ...base,
    name,
    label: 'bash (read-only)',
    description: `${base.description}${NOTE}`,
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionToolContext) {
      // Fail closed: when the sandbox cannot start, the call fails here and nothing spawns.
      const sandbox = await sandboxReady();
      // The per-command policy re-states READ_ONLY_POLICY, so the command never inherits a policy another
      // consumer left on the shared manager. Wrapping honors abort, and Pi's own shell operations then enforce
      // the pre-spawn abort check, timeouts, and process-tree cleanup.
      const command = await sandbox.wrapWithSandbox(params.command, undefined, READ_ONLY_POLICY, signal);
      const bash = createBashTool(ctx.cwd, {
        ...(existsSync('/bin/bash') ? { shellPath: '/bin/bash' } : {}),
        spawnHook: (spawn: BashSpawnContext) => ({ ...spawn, command, env: strippedEnv(spawn.env) }),
      });
      return bash.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

/**
 * Releases the sandbox if it started. On Linux the sandbox's socat bridges keep the event loop alive, so a process
 * that used the shell never exits unless the sandbox is released.
 */
export async function releaseReadonlySandbox(): Promise<void> {
  const started = ready;
  ready = undefined;
  const sandbox = await started?.catch(() => undefined);
  await sandbox?.reset();
}

/** Replaces `bash` in a readonly subagent. */
export function registerReadonlyShell(pi: ExtensionAPI): void {
  pi.registerTool(createReadonlyBashTool());
  pi.on('session_shutdown', releaseReadonlySandbox);
}
