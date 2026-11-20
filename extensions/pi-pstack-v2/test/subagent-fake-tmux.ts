/**
 * Stands in for `node:child_process`, the only door the subagent tool uses to reach tmux. A test installs it with
 * `vi.mock('node:child_process', () => import('./subagent-fake-tmux.ts'))`, then scripts how each spawned Pi behaves.
 *
 * The tool starts a child as `tmux new-session ... bash run.sh`. The fake reads `run.sh` the way bash would, to learn
 * the command line and the files the child's stdout, stderr and exit code land in, then hands a `FakeChild` to the
 * test's script. The fake answers `has-session` and `kill-server` for the tmux server each run owns.
 */
import * as fs from 'node:fs';

const NEW_SESSION = 'new-session';
const HAS_SESSION = 'has-session';
const KILL_SERVER = 'kill-server';
const SUBCOMMAND_INDEX = 2;
const SUCCESS = 0;
const FAILURE = 1;
const WRAPPER_LINE = /^(.*) > '([^']*)' 2> '([^']*)'$/;
const EXIT_LINE = /^echo \$\? > '([^']*)'$/;

type Env = NodeJS.ProcessEnv;
type SpawnOptions = { cwd: string; env: Env };
type ChildState = 'running' | 'exited' | 'gone';
type ChildFiles = { out: string; err: string; exit: string };

export interface TmuxCall {
  readonly command: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Env;
}

type WordScan = { words: readonly string[]; word: string; quote: string };

function scanChar({ words, word, quote }: WordScan, char: string): WordScan {
  if (quote) return char === quote ? { words, word, quote: '' } : { words, word: word + char, quote };
  if (char === "'" || char === '"') return { words, word, quote: char };
  if (char === ' ') return { words: [...words, word], word: '', quote: '' };
  return { words, word: word + char, quote };
}

/** Splits a line of single-quoted shell words, where `'"'"'` stands for a quote inside a word. */
function shellWords(line: string): string[] {
  const { words, word } = [...line].reduce(scanChar, { words: [], word: '', quote: '' });
  return [...words, word];
}

/** One Pi process the tool started inside tmux. The test script decides what it prints and when it ends. */
export interface FakeChild {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Env;
  readonly state: ChildState;
  /** The text after `Task: ` in the last argument, which is what the tool sends the child to do. */
  readonly task: string;
  /** The value that follows a flag such as `--model`, or undefined when the flag is absent. */
  flag(name: string): string | undefined;
  stdout(text: string): void;
  stderr(text: string): void;
  exit(code: number): void;
  /** The tmux session disappears without the child writing an exit code. */
  vanish(): void;
}

function createChild(command: string, args: readonly string[], cwd: string, env: Env, files: ChildFiles): FakeChild {
  let state: ChildState = 'running';
  return {
    command,
    args,
    cwd,
    env,
    get state() {
      return state;
    },
    get task() {
      return (args.at(-1) ?? '').replace(/^Task: /, '');
    },
    flag: (name) => {
      const index = args.indexOf(name);
      return index === -1 ? undefined : args[index + 1];
    },
    stdout: (text) => fs.appendFileSync(files.out, text),
    stderr: (text) => fs.appendFileSync(files.err, text),
    exit: (code) => {
      fs.writeFileSync(files.exit, `${code}\n`);
      state = 'exited';
    },
    vanish: () => {
      state = 'gone';
    },
  };
}

export type ChildScript = (child: FakeChild) => void;

let script: ChildScript = () => undefined;
let startError: Error | undefined;
let started: readonly FakeChild[] = [];
let calls: readonly TmuxCall[] = [];
let servers: ReadonlyMap<string, FakeChild> = new Map();

export const fakeTmux = {
  /** Forgets every child and call, and makes children hold until a test ends them. */
  reset(): void {
    script = () => undefined;
    startError = undefined;
    started = [];
    calls = [];
    servers = new Map();
  },
  onChild(next: ChildScript): void {
    script = next;
  },
  /** Makes starting a tmux session fail, as it does when tmux is not installed. */
  failToStart(error: Error): void {
    startError = error;
  },
  children: (): readonly FakeChild[] => started,
  calls: (): readonly TmuxCall[] => calls,
};

function parseWrapper(wrapper: string): { argv: string[]; files: ChildFiles } {
  const lines = fs.readFileSync(wrapper, 'utf8').split('\n');
  const [, argvText = '', out = '', err = ''] = WRAPPER_LINE.exec(lines[1] ?? '') ?? [];
  const [, exit = ''] = EXIT_LINE.exec(lines[2] ?? '') ?? [];
  return { argv: shellWords(argvText), files: { out, err, exit } };
}

function startChild(argv: readonly string[], options: SpawnOptions): void {
  const wrapper = argv.at(-1) ?? '';
  const { argv: words, files } = parseWrapper(wrapper);
  const [command = '', ...args] = words;
  const cwd = argv[argv.indexOf('-c') + 1] ?? '';
  const child = createChild(command, args, cwd, options.env, files);
  started = [...started, child];
  servers = new Map([...servers, [options.cwd, child]]);
  script(child);
}

/** `execFileSync('tmux', ['-S', sock, 'new-session', ...])`, the call that starts a child. */
export function execFileSync(command: string, argv: readonly string[], options: SpawnOptions): void {
  calls = [...calls, { command, argv, cwd: options.cwd, env: options.env }];
  if (startError) throw startError;
  if (argv[SUBCOMMAND_INDEX] === NEW_SESSION) startChild(argv, options);
}

/** `spawnSync('tmux', ...)` for `has-session` and `kill-server`, answered for the run directory's own server. */
export function spawnSync(command: string, argv: readonly string[], options: SpawnOptions): { status: number } {
  calls = [...calls, { command, argv, cwd: options.cwd, env: options.env }];
  const child = servers.get(options.cwd);
  const subcommand = argv[SUBCOMMAND_INDEX];
  if (subcommand === HAS_SESSION) return { status: child?.state === 'running' ? SUCCESS : FAILURE };
  if (subcommand === KILL_SERVER && child) {
    if (child.state === 'running') child.vanish();
    return { status: SUCCESS };
  }
  return { status: FAILURE };
}
