import { existsSync } from 'node:fs';

import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import { type BashSpawnContext, createBashTool, type ExtensionAPI, type ExtensionToolContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { linuxReadonlyCommand } from './linux-readonly-sandbox.ts';

// Cursor's readonly subagent: "no file edits, no state-changing shell commands". The OS sandbox enforces the file
// half: nothing may be written, so a pipe, substitution, or pager cannot get around it. Network stays open, as it is in
// Cursor's Ask-mode shell (workspace_readonly with the user's network policy; no sandbox at all by default), so
// `gh pr view` and `curl` work, and "no state-changing commands" over the network is an instruction, as in Cursor.
// Linux uses bubblewrap directly (linux-readonly-sandbox.ts); macOS uses sandbox-runtime's Seatbelt policy below, whose
// proxy admits every host through the ask callback.
// denyWrite names the paths the sandbox makes writable for itself (/tmp/claude is a dependency default), and
// denyRead drops the dependency's writable home defaults (~/.npm/_logs, ~/.claude/debug). Seatbelt is
// last-match-wins with deny emitted after allow.
// Unix sockets must stay blocked too: a host service can mutate files on a command's behalf.
const READ_ONLY_POLICY: SandboxRuntimeConfig = {
  network: { allowedDomains: [], deniedDomains: [], allowAllUnixSockets: false, allowMachLookup: ['com.apple.trustd', 'com.apple.ocspd'] },
  // trustd verifies TLS certificates for macOS and Go clients (curl, gh, git); without it every HTTPS read fails.
  enableWeakerNetworkIsolation: true,
  filesystem: {
    denyRead: ['~/.npm/_logs', '~/.claude/debug'],
    allowWrite: [],
    denyWrite: ['/tmp/claude', '/private/tmp/claude'],
  },
};

const NOTE =
  ' This shell is read-only: each command runs in an OS sandbox that denies filesystem writes and Unix sockets. Network requests work, but run no command that changes state anywhere (no pushes, merges, posts, or deploys). Pi and trusted extensions are not sandboxed by it. Use it for commands such as git log, git blame, rg, or gh pr view.';

// Startup hooks and exported shell functions run in the outer shell before the sandbox wrapper does, so none of
// them may reach it.
const STRIP_ENV = ['BASH_ENV', 'ENV', ...Object.keys(process.env).filter((key) => key.startsWith('BASH_FUNC_'))];

type Sandbox = typeof import('@anthropic-ai/sandbox-runtime')['SandboxManager'];

let ready: Promise<Sandbox> | undefined;

/**
 * Starts sandbox-runtime once per process, loading it only in a readonly subagent: a local package install gets no
 * dependency install, and everything else in the package works without it. A failure is kept, so no command ever
 * runs outside the sandbox.
 */
function sandboxReady(): Promise<Sandbox> {
  ready ??= (async () => {
    try {
      const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
      if (!SandboxManager.isSupportedPlatform()) throw new Error(`${process.platform} is not supported`);
      const socketWarning = SandboxManager.checkDependencies().warnings.find((warning) => warning.includes('unix socket access not restricted'));
      if (socketWarning !== undefined) throw new Error(socketWarning);
      // initialize is a no-op if another consumer started the manager. Linux socket isolation also
      // reads the shared config, so both it and the per-command override must carry this policy.
      await SandboxManager.initialize(READ_ONLY_POLICY, async () => true);
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
      const command = process.platform === 'linux' ? linuxCommand(params.command, ctx.cwd) : await wrapped(params.command, signal);
      const bash = createBashTool(ctx.cwd, {
        ...(existsSync('/bin/bash') ? { shellPath: '/bin/bash' } : {}),
        // Node's fetch ignores the proxy variables unless told to use them, and the proxy is the only way out.
        spawnHook: (spawn: BashSpawnContext) => ({ ...spawn, command, env: { ...strippedEnv(spawn.env), NODE_USE_ENV_PROXY: '1' } }),
      });
      return bash.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

function linuxCommand(command: string, cwd: string): string {
  try {
    return linuxReadonlyCommand(command, cwd);
  } catch (error) {
    throw new Error(`no verified OS sandbox is available: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The per-command policy re-states READ_ONLY_POLICY, so the command never inherits a policy another consumer left on
 * the shared manager. Wrapping honors abort, and Pi's own shell operations then enforce the pre-spawn abort check,
 * timeouts, and process-tree cleanup.
 */
async function wrapped(command: string, signal: AbortSignal | undefined): Promise<string> {
  const sandbox = await sandboxReady();
  return sandbox.wrapWithSandbox(command, undefined, READ_ONLY_POLICY, signal);
}

/** Releases sandbox-runtime if it started, so a process that used the shell can exit. */
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
