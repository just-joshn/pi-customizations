import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';

import { type BashOperations, type BashToolOptions, createBashToolDefinition, createLocalBashOperations, type ExtensionAPI, getShellConfig } from '@earendil-works/pi-coding-agent';

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

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The capture runs on fd 9, a copy of the original stdout that the command cannot see, so a command that redirects its
 * own stdout still reports its state. Its record is the marker, then NUL-terminated fields: the working directory,
 * each exported variable that differs from the command's starting environment, and the marker again.
 */
function captureFunction(marker: string): string {
  return [
    '__pstack_capture() {',
    '  local __pstack_n __pstack_b __pstack_vars=()',
    '  [ -d "$PWD" ] && builtin cd -P . 2>/dev/null',
    '  for __pstack_n in $(builtin compgen -e); do',
    '    case $__pstack_n in PWD|OLDPWD|SHLVL|_) continue ;; esac',
    '    __pstack_b=__pstack_0_$__pstack_n',
    `    if [ "\${!__pstack_b+x}" != x ] || [ "\${!__pstack_b}" != "\${!__pstack_n}" ]; then __pstack_vars+=("$__pstack_n=\${!__pstack_n}"); fi`,
    '  done',
    `  builtin printf '%s\\0' ${quote(marker)}"$PWD" "\${__pstack_vars[@]}" ${quote(marker)} >&9`,
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
      captureFunction(marker),
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

  const record = (payload: Buffer): Buffer => {
    const fields = payload.toString('utf8').split('\0');
    const end = fields.indexOf(marker);
    if (end < 1) return Buffer.alloc(0);
    const env = new Map<string, string>();
    for (const field of fields.slice(1, end)) {
      const at = field.indexOf('=');
      const name = field.slice(0, at);
      if (at > 0 && NAME.test(name)) env.set(name, field.slice(at + 1));
    }
    state = { cwd: fields[0], env };
    return Buffer.from(fields.slice(end + 1).join('\0'));
  };

  /** Passes the command's output through and keeps its state record out of it. */
  const operations = (inner: BashOperations): BashOperations => ({
    exec: async (command, cwd, options) => {
      let held = Buffer.alloc(0);
      let payload: Buffer[] | undefined;
      const forward = (bytes: Buffer) => {
        if (bytes.length > 0) options.onData(bytes);
      };
      const onData = (chunk: Buffer) => {
        if (payload !== undefined) return void payload.push(chunk);
        const bytes = Buffer.concat([held, chunk]);
        const at = bytes.indexOf(markerBytes);
        if (at !== -1) {
          forward(bytes.subarray(0, at));
          payload = [bytes.subarray(at + markerBytes.length)];
          held = Buffer.alloc(0);
          return;
        }
        let keep = Math.min(markerBytes.length - 1, bytes.length);
        while (keep > 0 && !bytes.subarray(bytes.length - keep).equals(markerBytes.subarray(0, keep))) keep -= 1;
        forward(bytes.subarray(0, bytes.length - keep));
        held = bytes.subarray(bytes.length - keep);
      };
      try {
        return await inner.exec(command, cwd, { ...options, onData });
      } finally {
        if (payload === undefined) forward(held);
        else forward(record(Buffer.concat(payload)));
      }
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

/** Pi's bash tool definition, running each command through the session's shell. */
export function sessionBashDefinition(shell: SessionShell, cwd: string, operations: BashOperations, options: Pick<BashToolOptions, 'commandPrefix'> = {}) {
  const definition = createBashToolDefinition(cwd, { ...options, operations: shell.operations(operations), spawnHook: (spawn) => ({ ...spawn, command: shell.script(spawn.command) }) });
  return { ...definition, description: `${definition.description}${SHELL_STATE_NOTE}` };
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
export function registerSessionBash(pi: ExtensionAPI, shell: SessionShell): void {
  pi.registerTool({
    ...sessionBashDefinition(shell, process.cwd(), createLocalBashOperations()),
    execute(toolCallId, params, signal, onUpdate, ctx) {
      const shellPath = settingsShellPath(pi);
      const commandPrefix = pi.getSettings().shellCommandPrefix;
      const prefix = commandPrefix === undefined ? {} : { commandPrefix };
      const path = shellPath === undefined ? {} : { shellPath };
      const definition = /^bash(\.exe)?$/i.test(basename(getShellConfig(shellPath).shell)) ? sessionBashDefinition(shell, ctx.cwd, createLocalBashOperations(path), prefix) : createBashToolDefinition(ctx.cwd, { ...prefix, ...path });
      return definition.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
