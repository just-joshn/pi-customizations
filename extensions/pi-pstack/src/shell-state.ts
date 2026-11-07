import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';

import { type BashOperations, type BashToolOptions, createBashToolDefinition, createLocalBashOperations, type ExtensionAPI, type ExtensionContext, getShellConfig } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/**
 * What a session's shell carries from one finished command to the next, as Cursor's shell does: the working directory
 * and every exported variable the commands set. Each command starts from Pi's fresh environment with `env` laid over
 * it, so an unset variable comes back, as it does in Cursor, and a variable Pi refreshes per call (PI_MODEL) stays fresh
 * until a command sets it.
 */
interface ShellState {
  readonly cwd: string | undefined;
  readonly env: ReadonlyMap<string, string>;
}

export const SHELL_STATE_NOTE = ' The working directory and exported environment variables carry over to the next call in this session. A command that runs exit, times out, or is aborted keeps neither.';

const BACKGROUND_NOTE =
  ' A command still running when its timeout elapses is not stopped: it moves to the background, and the result names its shell ID, PID, and output file. Without a timeout, that happens after 30 seconds. AwaitShell waits on it, and a notification arrives after your turn when it finishes.';

/** Cursor's Shell waits 30 seconds in the foreground when the call names no time. */
const DEFAULT_WAIT_SECONDS = 30;

const MAX_TIMEOUT_MS = 2_147_483_647;

/** A command still running when its timeout elapsed, as the bash call hands it to the background shells. */
export interface MovedCommand {
  readonly pid: number;
  readonly startedAt: number;
  readonly waitedMs: number;
  /** What it printed before the timeout. */
  readonly output: Buffer;
  /** Ends the command, which then reports its exit. */
  readonly stop: () => void;
}

/** The background job a moved command became: where its later output and its exit go, and what the bash call returns. */
export interface BackgroundedCommand {
  readonly data: (chunk: Buffer) => void;
  readonly exit: (exitCode: number | undefined) => void;
  readonly text: string;
  readonly outputPath: string;
}

/** Takes over a bash call's command when its timeout elapses. Undefined leaves Pi's behavior, which stops the command. */
export type Background = (ctx: ExtensionContext, call: { toolCallId: string; command: string; cwd: string }, moved: MovedCommand) => BackgroundedCommand | undefined;

class MovedToBackground extends Error {
  readonly command: BackgroundedCommand;
  constructor(command: BackgroundedCommand) {
    super('moved to the background');
    this.command = command;
  }
}

const timeoutMs = (timeout: number | undefined) => (timeout !== undefined && Number.isFinite(timeout) && timeout > 0 && timeout * 1000 <= MAX_TIMEOUT_MS ? timeout * 1000 : undefined);

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The script reports on fd 9, a copy of the original stdout that the command cannot see, so a command that redirects
 * its own stdout still reports. A record is the marker, NUL-terminated fields, and the marker again: `pid` and the
 * shell's process ID before the command runs, then `state`, the working directory, and each exported variable that
 * differs from the command's starting environment once it has finished.
 */
function recordFunctions(marker: string): string {
  return [
    `__pstack_record() { builtin printf '%s' ${quote(marker)}; builtin printf '%s\\0' "$@"; builtin printf '%s' ${quote(marker)}; }`,
    '__pstack_capture() {',
    '  local __pstack_n __pstack_b __pstack_vars=()',
    '  [ -d "$PWD" ] && builtin cd -P . 2>/dev/null',
    '  for __pstack_n in $(builtin compgen -e); do',
    '    case $__pstack_n in PWD|OLDPWD|SHLVL|_) continue ;; esac',
    '    __pstack_b=__pstack_0_$__pstack_n',
    `    if [ "\${!__pstack_b+x}" != x ] || [ "\${!__pstack_b}" != "\${!__pstack_n}" ]; then __pstack_vars+=("$__pstack_n=\${!__pstack_n}"); fi`,
    '  done',
    `  __pstack_record state "$PWD" "\${__pstack_vars[@]}" >&9`,
    '}',
  ].join('\n');
}

/** The per-session shell: `script` wraps a command so it restores and reports the state, `operations` reads the report. */
export function createSessionShell() {
  let state: ShellState = { cwd: undefined, env: new Map() };
  const marker = `\u001epstack-shell-${randomBytes(8).toString('hex')}\u001e`;
  const markerBytes = Buffer.from(marker);

  const exports = () => [...state.env].map(([name, value]) => `export ${name}=${quote(value)}\n`).join('');

  const script = (command: string): string => {
    const cwd = state.cwd;
    return [
      'exec 2>&1 9>&1',
      recordFunctions(marker),
      '__pstack_record pid "$$" >&9',
      `for __pstack_n in $(builtin compgen -e); do builtin printf -v "__pstack_0_$__pstack_n" %s "\${!__pstack_n}"; done`,
      exports(),
      cwd === undefined
        ? ''
        : `cd -- ${quote(cwd)} 2>/dev/null || { printf '%s\\n' ${quote(`The shell's working directory ${cwd} no longer exists or cannot be entered. The command did not run. The shell is back in `)}"$PWD; run the command again." >&2; __pstack_capture; exit 1; }`,
      `eval ${quote(command)} 9>&-`,
      '{ __pstack_status=$?; set +eux; } 2>/dev/null',
      '__pstack_capture',
      'builtin exit $__pstack_status',
    ].join('\n');
  };

  const parseState = ([cwd, ...variables]: string[]): ShellState => {
    const env = new Map<string, string>();
    for (const field of variables) {
      const at = field.indexOf('=');
      const name = field.slice(0, at);
      if (at > 0 && NAME.test(name)) env.set(name, field.slice(at + 1));
    }
    return { cwd, env };
  };

  /** Splits a command's output into what the command printed, for `forward`, and the script's records, for `receive`. */
  const splitter = (forward: (bytes: Buffer) => void, receive: (fields: string[]) => void) => {
    let held = Buffer.alloc(0);
    let inRecord = false;
    const onData = (chunk: Buffer) => {
      let bytes = Buffer.concat([held, chunk]);
      for (let at = bytes.indexOf(markerBytes); at !== -1; at = bytes.indexOf(markerBytes)) {
        if (inRecord) receive(bytes.subarray(0, at).toString('utf8').split('\0').slice(0, -1));
        else forward(bytes.subarray(0, at));
        inRecord = !inRecord;
        bytes = bytes.subarray(at + markerBytes.length);
      }
      if (inRecord) {
        held = bytes;
        return;
      }
      let keep = Math.min(markerBytes.length - 1, bytes.length);
      while (keep > 0 && !bytes.subarray(bytes.length - keep).equals(markerBytes.subarray(0, keep))) keep -= 1;
      forward(bytes.subarray(0, bytes.length - keep));
      held = bytes.subarray(bytes.length - keep);
    };
    const flush = () => {
      if (!inRecord) forward(held);
      held = Buffer.alloc(0);
    };
    return { onData, flush };
  };

  /**
   * Passes the command's output through without the script's records and keeps the state it reports. Given
   * `moveOnTimeout`, a command still running when its timeout elapses goes there instead of being stopped, and keeps no
   * state.
   */
  const operations = (inner: BashOperations, moveOnTimeout?: (moved: MovedCommand) => BackgroundedCommand | undefined, keepUnmoved = false): BashOperations => ({
    exec: (command, cwd, options) => {
      const { onData, signal, timeout, ...rest } = options;
      const waitMs = timeoutMs(timeout);
      const move = waitMs === undefined ? undefined : moveOnTimeout;
      const startedAt = Date.now();
      const before: Buffer[] = [];
      let pid: number | undefined;
      let finished = false;
      let moved: BackgroundedCommand | undefined;
      const output = splitter(
        (bytes) => {
          if (bytes.length === 0) return;
          if (moved !== undefined) return moved.data(bytes);
          if (move !== undefined) before.push(bytes);
          onData(bytes);
        },
        ([kind, ...fields]) => {
          if (kind === 'pid') pid = Number(fields[0]);
          if (kind !== 'state' || fields.length === 0) return;
          finished = true;
          if (moved === undefined) state = parseState(fields);
        },
      );
      if (move === undefined || waitMs === undefined) return inner.exec(command, cwd, { ...options, onData: output.onData }).finally(output.flush);

      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted === true) abort();
      let timedOut = false;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (finished) return;
          try {
            moved = pid === undefined ? undefined : move({ pid, startedAt, waitedMs: waitMs, output: Buffer.concat(before), stop: abort });
          } catch (error) {
            abort();
            return reject(error);
          }
          if (moved === undefined) {
            if (keepUnmoved) return;
            timedOut = true;
            return abort();
          }
          signal?.removeEventListener('abort', abort);
          reject(new MovedToBackground(moved));
        }, waitMs);
        inner
          .exec(command, cwd, { ...rest, onData: output.onData, signal: controller.signal })
          .then(
            (result) => {
              clearTimeout(timer);
              output.flush();
              if (moved === undefined) resolve(result);
              else moved.exit(result.exitCode ?? undefined);
            },
            (error: unknown) => {
              clearTimeout(timer);
              output.flush();
              if (moved !== undefined) moved.exit(undefined);
              else reject(timedOut ? new Error(`timeout:${timeout}`) : error);
            },
          )
          .finally(() => signal?.removeEventListener('abort', abort));
      });
    },
  });

  return {
    script,
    operations,
    /** The shell's working directory, once a command has finished. */
    cwd: () => state.cwd,
    /** `export` lines that give another command the shell's variables. */
    exports,
  };
}

export type SessionShell = ReturnType<typeof createSessionShell>;

/**
 * Pi's bash tool definition, running each command through the session's shell. Given `background`, a command whose
 * timeout elapses moves there instead of being stopped, as Cursor's Shell does.
 */
export function sessionBashDefinition(shell: SessionShell, cwd: string, operations: BashOperations, options: Pick<BashToolOptions, 'commandPrefix'> & { background?: Background | undefined } = {}) {
  const { background, ...bashOptions } = options;
  const define = (moveOnTimeout?: (moved: MovedCommand) => BackgroundedCommand | undefined, keepUnmoved = false) =>
    createBashToolDefinition(cwd, { ...bashOptions, operations: shell.operations(operations, moveOnTimeout, keepUnmoved), spawnHook: (spawn) => ({ ...spawn, command: shell.script(spawn.command) }) });
  const definition = define();
  if (background === undefined) return { ...definition, description: `${definition.description}${SHELL_STATE_NOTE}` };
  const tool: typeof definition = {
    ...definition,
    description: `${definition.description}${SHELL_STATE_NOTE}${BACKGROUND_NOTE}`,
    parameters: {
      ...definition.parameters,
      properties: {
        ...definition.parameters.properties,
        timeout: Type.Optional(Type.Number({ description: `Seconds to wait for the command before it moves to the background, where it keeps running (default ${DEFAULT_WAIT_SECONDS})` })),
      },
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const call = { toolCallId, command: params.command, cwd: shell.cwd() ?? ctx.cwd };
      try {
        const defaulted = params.timeout === undefined;
        const timed = defaulted ? { ...params, timeout: DEFAULT_WAIT_SECONDS } : params;
        return await define((moved) => background(ctx, call, moved), defaulted).execute(toolCallId, timed, signal, onUpdate, ctx);
      } catch (error) {
        if (!(error instanceof MovedToBackground)) throw error;
        return { content: [{ type: 'text', text: error.command.text }], details: { fullOutputPath: error.command.outputPath } };
      }
    },
  };
  return tool;
}

/** The `shellPath` setting, with a leading `~` expanded as Pi expands it. */
export function settingsShellPath(pi: ExtensionAPI): string | undefined {
  const value = (pi.getSettings() as { shellPath?: unknown }).shellPath;
  return typeof value === 'string' && value !== '' ? value.replace(/^~(?=$|\/)/, process.env['HOME'] ?? '~') : undefined;
}

/**
 * Replaces Pi's `bash` with one that keeps the session's shell state, honoring the shellPath and shellCommandPrefix
 * settings as Pi's does. A shellPath that is not bash runs Pi's plain tool, since the state script is bash.
 */
export function registerSessionBash(pi: ExtensionAPI, shell: SessionShell, background: Background): void {
  pi.registerTool({
    ...sessionBashDefinition(shell, process.cwd(), createLocalBashOperations(), { background }),
    execute(toolCallId, params, signal, onUpdate, ctx) {
      const shellPath = settingsShellPath(pi);
      const commandPrefix = pi.getSettings().shellCommandPrefix;
      const prefix = commandPrefix === undefined ? {} : { commandPrefix };
      const path = shellPath === undefined ? {} : { shellPath };
      const definition = /^bash(\.exe)?$/i.test(basename(getShellConfig(shellPath).shell))
        ? sessionBashDefinition(shell, ctx.cwd, createLocalBashOperations(path), { ...prefix, background })
        : createBashToolDefinition(ctx.cwd, { ...prefix, ...path });
      return definition.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
