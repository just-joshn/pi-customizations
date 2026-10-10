import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import ignore from 'ignore';

/** One watchfiles-style change: change kind plus absolute path. */
export type WatchChange = readonly [changeType: string, path: string];

/** Injected monitor so start/stop/join can be proved without a live filesystem watcher. */
export interface WatchMonitor {
  start(): void;
  stop(): void;
  join(): void;
}

export type WatchAction = '!' | '?';

export interface AiComments {
  readonly lineNums: readonly number[];
  readonly comments: readonly string[];
  readonly action: WatchAction | null;
}

export interface IgnoreSpec {
  matchFile(path: string): boolean;
}

export interface FileWatcherOptions {
  readonly root: string;
  readonly gitignores?: readonly string[];
  readonly readText: (path: string) => string | null | undefined;
  readonly interruptInput: () => void;
  readonly createMonitor?: () => WatchMonitor;
}

const ALWAYS_IGNORE = [
  '.aider*',
  '.git',
  '*~',
  '*.bak',
  '*.swp',
  '*.swo',
  '\\#*\\#',
  '.#*',
  '*.tmp',
  '*.temp',
  '*.orig',
  '*.pyc',
  '__pycache__/',
  '.DS_Store',
  'Thumbs.db',
  '*.svg',
  '*.pdf',
  '.idea/',
  '.vscode/',
  '*.sublime-*',
  '.project',
  '.settings/',
  '*.code-workspace',
  '.env',
  '.venv/',
  'node_modules/',
  'vendor/',
  '*.log',
  '.cache/',
  '.pytest_cache/',
  'coverage/',
] as const;

const AI_COMMENT_PATTERN = /(?:#|\/\/|--|;+) *(ai\b.*|ai\b.*|.*\bai[?!]?) *$/i;
const ONE_MIB = 1024 * 1024;

/** Load Aider's built-in ignore list plus each existing gitignore path into one matcher. */
export function loadGitignores(gitignorePaths: readonly string[]): IgnoreSpec | null {
  if (gitignorePaths.length === 0) return null;
  const ig = ignore().add([...ALWAYS_IGNORE]);
  for (const path of gitignorePaths) {
    if (!existsSync(path)) continue;
    ig.add(readFileSync(path, 'utf8'));
  }
  return {
    matchFile(path) {
      return ig.ignores(path);
    },
  };
}

/** Extract AI comment lines, comments, and the last AI! / AI? action from a file. */
export function getAiComments(filepath: string, readText: (path: string) => string | null | undefined): AiComments | null {
  let content: string | null | undefined;
  try {
    content = readText(filepath);
  } catch {
    return null;
  }
  if (!content) return null;
  const lineNums: number[] = [];
  const comments: string[] = [];
  let action: WatchAction | null = null;
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = AI_COMMENT_PATTERN.exec(line);
    if (!match) continue;
    const comment = match[0].trim();
    if (!comment) continue;
    lineNums.push(index + 1);
    comments.push(comment);
    const normalized = comment.toLowerCase().replace(/^[/#\-;]+/, '').trim();
    if (normalized.startsWith('ai!') || normalized.endsWith('ai!')) action = '!';
    else if (normalized.startsWith('ai?') || normalized.endsWith('ai?')) action = '?';
  }
  if (lineNums.length === 0) return null;
  return { lineNums, comments, action };
}

function posixRel(root: string, absolute: string): string | null {
  const rootAbs = resolve(root);
  const pathAbs = resolve(absolute);
  const rel = relative(rootAbs, pathAbs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return rel === '' ? '.' : null;
  return rel.split('\\').join('/');
}

function defaultMonitor(): WatchMonitor {
  return { start() {}, stop() {}, join() {} };
}

/** Aider FileWatcher port: filter, roots, change accumulation, and start/stop lifecycle. */
export class FileWatcher {
  readonly #root: string;
  readonly #ignore: IgnoreSpec | null;
  readonly #readText: (path: string) => string | null | undefined;
  readonly #interruptInput: () => void;
  readonly #createMonitor: () => WatchMonitor;
  #changedFiles = new Set<string>();
  #monitor: WatchMonitor | null = null;

  constructor(options: FileWatcherOptions) {
    this.#root = options.root;
    this.#ignore = loadGitignores(options.gitignores ?? []);
    this.#readText = options.readText;
    this.#interruptInput = options.interruptInput;
    this.#createMonitor = options.createMonitor ?? defaultMonitor;
  }

  get changedFiles(): ReadonlySet<string> {
    return this.#changedFiles;
  }

  get hasMonitor(): boolean {
    return this.#monitor !== null;
  }

  /** True when the path is under the root, not ignored, at most one MiB, and has AI comments. */
  filterPath(_changeType: string, path: string): boolean {
    const abs = resolve(path);
    const rel = posixRel(this.#root, abs);
    if (rel === null || rel === '.') return false;
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      return false;
    }
    if (this.#ignore?.matchFile(rel + (stats.isDirectory() ? '/' : ''))) return false;
    if (!stats.isFile() || stats.size > ONE_MIB) return false;
    try {
      return getAiComments(abs, this.#readText) !== null;
    } catch {
      return false;
    }
  }

  /** Top-level roots to watch, or the workspace root when every entry is ignored. */
  getRootsToWatch(): string[] {
    if (!this.#ignore) return [this.#root];
    const roots: string[] = [];
    for (const name of readdirSync(this.#root)) {
      const absolute = resolve(this.#root, name);
      let isDir = false;
      try {
        isDir = statSync(absolute).isDirectory();
      } catch {
        continue;
      }
      const rel = `${name}${isDir ? '/' : ''}`;
      if (!this.#ignore.matchFile(rel)) roots.push(absolute);
    }
    return roots.length > 0 ? roots : [this.#root];
  }

  /** Retain distinct changed paths and interrupt waiting input when the batch is nonempty. */
  handleChanges(changes: readonly WatchChange[]): boolean {
    if (changes.length === 0) return false;
    const next = new Set(this.#changedFiles);
    for (const change of changes) next.add(resolve(change[1]));
    this.#changedFiles = next;
    this.#interruptInput();
    return true;
  }

  /** Clear pending changes and start the injected monitor. */
  start(): void {
    this.#changedFiles = new Set();
    const monitor = this.#createMonitor();
    this.#monitor = monitor;
    monitor.start();
  }

  /** Signal the monitor, join it, then discard the handle. */
  stop(): void {
    const monitor = this.#monitor;
    if (!monitor) return;
    monitor.stop();
    monitor.join();
    this.#monitor = null;
  }
}
