import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

const commandInputSchema = z.object({ command: z.string(), cwd: z.string().optional() });
const GIT_GLOBAL_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const GIT_PUSH_VALUE_FLAGS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_WRAPPERS = new Set(['env', 'command']);
const BROAD_PATHSPECS = new Set(['.', './', '*', ':/']);
const TRUNK_BRANCHES = new Set(['main', 'master']);
const DOUBLE_AMP = '&&';
const DOUBLE_PIPE = '||';
const GIT_BIN_SUFFIX = '/git';
const TODO_FILE_SUFFIX = '/TODO.md';

function splitShellSegments(command: string): readonly string[] {
  let segments: readonly string[] = [];
  let current = '';
  let quote: '"' | "'" | '' = '';
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? '';
    const next = command[i + 1] ?? '';
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        current += ch + next;
        i += 1;
        continue;
      }
      if (ch === quote) quote = '';
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|') {
      segments = [...segments, current];
      current = '';
      if (ch + next === DOUBLE_PIPE) i += 1;
      continue;
    }
    if (ch + next === DOUBLE_AMP) {
      segments = [...segments, current];
      current = '';
      i += 1;
      continue;
    }
    current += ch;
  }
  return [...segments, current].map((s) => s.trim()).filter(Boolean);
}

function tokenizeSegment(segment: string): readonly string[] {
  let tokens: readonly string[] = [];
  let current = '';
  let quote: '"' | "'" | '' = '';
  let hasToken = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i] ?? '';
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        current += segment[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = '';
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) tokens = [...tokens, current];
      current = '';
      hasToken = false;
      continue;
    }
    current += ch;
    hasToken = true;
  }
  return hasToken ? [...tokens, current] : tokens;
}

function findRepoRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function hasWorkingTodoFile(cwd: string): boolean {
  const repoRoot = findRepoRoot(cwd);
  const dirs = repoRoot && repoRoot !== resolve(cwd) ? [cwd, repoRoot] : [cwd];
  return dirs.some((dir) => existsSync(join(dir, 'TODO.md')) || existsSync(join(dir, '.pi', 'TODO.md')));
}

function stripLeadingWrappers(tokens: readonly string[]): readonly string[] {
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i] ?? '';
    if (ENV_ASSIGNMENT.test(tok) || SHELL_WRAPPERS.has(tok)) {
      i += 1;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

function parseGitInvocation(rawTokens: readonly string[], baseCwd: string): { readonly subcommand: string; readonly args: readonly string[]; readonly cwd: string } | undefined {
  const tokens = stripLeadingWrappers(rawTokens);
  const bin = tokens[0] ?? '';
  if (bin !== 'git' && !bin.endsWith(GIT_BIN_SUFFIX)) return undefined;
  let cwd = baseCwd;
  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i] ?? '';
    if (!tok.startsWith('-')) return { subcommand: tok, args: tokens.slice(i + 1), cwd };
    if (tok === '-C' && i + 1 < tokens.length) {
      cwd = resolve(cwd, tokens[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (tok.startsWith('-C') && tok.length > 2) {
      cwd = resolve(cwd, tok.slice(2));
      i += 1;
      continue;
    }
    i += GIT_GLOBAL_VALUE_FLAGS.has(tok) ? 2 : 1;
  }
  return undefined;
}

function checkGitAdd(args: readonly string[], cwd: string): string | undefined {
  const hasTodo = hasWorkingTodoFile(cwd);
  const hasPiTodo = existsSync(join(cwd, '.pi', 'TODO.md'));
  let broad = false;
  let afterDashDash = false;
  for (const arg of args) {
    if (!afterDashDash && arg === '--') {
      afterDashDash = true;
      continue;
    }
    if (!afterDashDash && arg.startsWith('-')) {
      if (arg === '--all' || (!arg.startsWith('--') && arg.includes('A'))) broad = true;
      continue;
    }
    const clean = arg.replace(/^\.\//, '').replace(/\/+$/, '');
    if (clean === 'TODO.md' || clean === '.pi/TODO.md' || clean.endsWith(TODO_FILE_SUFFIX) || (clean === '.pi' && hasPiTodo)) {
      return 'TODO.md and .pi/TODO.md are working state and must never be staged. Stage only the files you changed.';
    }
    if (BROAD_PATHSPECS.has(arg)) broad = true;
  }
  if (broad && hasTodo) return 'Refusing broad `git add -A`/`.` while working TODO.md or .pi/TODO.md exists. Stage explicit paths with `git add <files>`.';
  return undefined;
}

function resolveGitHead(startDir: string): string | undefined {
  const repoRoot = findRepoRoot(startDir);
  if (!repoRoot) return undefined;
  const dotGit = join(repoRoot, '.git');
  if (statSync(dotGit).isDirectory()) return join(dotGit, 'HEAD');
  const gitdir = readFileSync(dotGit, 'utf8')
    .match(/^gitdir:\s*(.+)$/m)?.[1]
    ?.trim();
  return gitdir ? join(resolve(repoRoot, gitdir), 'HEAD') : undefined;
}

function currentBranch(cwd: string): string | undefined {
  const headPath = resolveGitHead(cwd);
  if (!headPath || !existsSync(headPath)) return undefined;
  return readFileSync(headPath, 'utf8')
    .trim()
    .match(/^ref:\s*refs\/heads\/(.+)$/)?.[1];
}

function isTrunkTarget(refspec: string, branch: string | undefined): boolean {
  const stripped = refspec.startsWith('+') ? refspec.slice(1) : refspec;
  const rawDest = stripped.includes(':') ? (stripped.split(':').at(-1) ?? '') : stripped;
  const dest = rawDest === 'HEAD' || rawDest === '@' ? (branch ?? '') : rawDest.replace(/^refs\/heads\//, '');
  return TRUNK_BRANCHES.has(dest);
}

function checkGitPush(args: readonly string[], cwd: string): string | undefined {
  let forceFlag = false;
  let allOrMirror = false;
  let explicitRepo = false;
  let afterDashDash = false;
  let positionals: readonly string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (!afterDashDash && arg === '--') {
      afterDashDash = true;
      continue;
    }
    if (!afterDashDash && arg.startsWith('-')) {
      if (arg === '--force' || arg === '--force-with-lease' || arg.startsWith('--force-with-lease=') || (!arg.startsWith('--') && arg.includes('f'))) forceFlag = true;
      if (arg === '--all' || arg === '--mirror') allOrMirror = true;
      if (arg === '--repo' || arg.startsWith('--repo=')) explicitRepo = true;
      if (GIT_PUSH_VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    positionals = [...positionals, arg];
  }
  const branch = currentBranch(cwd);
  const refspecs = explicitRepo ? positionals : positionals.slice(1);
  const explicitTrunk = refspecs.some((ref) => (forceFlag || ref.startsWith('+')) && isTrunkTarget(ref, branch));
  const implicitTrunk = forceFlag && (allOrMirror || (refspecs.length === 0 && TRUNK_BRANCHES.has(branch ?? '')));
  if (explicitTrunk || implicitTrunk) return 'Force-pushing to shared trunk (main/master) is an irreversible write. Stop and ask the user for explicit approval.';
  return undefined;
}

function checkSegment(tokens: readonly string[], cwd: string): string | undefined {
  const git = parseGitInvocation(tokens, cwd);
  if (!git) return undefined;
  if (git.subcommand === 'add' || git.subcommand === 'stage') return checkGitAdd(git.args, git.cwd);
  if (git.subcommand === 'push') return checkGitPush(git.args, git.cwd);
  return undefined;
}

/** Returns a block reason when `command` violates a pstack safety invariant, or undefined when allowed. */
export function checkCommandGuard(command: string, cwd: string): string | undefined {
  let activeCwd = cwd;
  for (const segment of splitShellSegments(command)) {
    const tokens = tokenizeSegment(segment);
    if (tokens[0] === 'cd' && tokens[1] && !tokens[1].startsWith('-')) {
      activeCwd = resolve(activeCwd, tokens[1]);
      continue;
    }
    const reason = checkSegment(tokens, activeCwd);
    if (reason) return reason;
  }
  return undefined;
}

/** Registers pstack tool-call guards (never stage TODO.md, never force-push shared trunk). */
export function registerGuards(pi: ExtensionAPI): void {
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'bash' && event.toolName !== 'tmux_run') return undefined;
    const parsed = commandInputSchema.safeParse(event.input);
    if (!parsed.success) return undefined;
    const targetCwd = parsed.data.cwd ? resolve(ctx.cwd, parsed.data.cwd) : ctx.cwd;
    const reason = checkCommandGuard(parsed.data.command, targetCwd);
    return reason ? { block: true, reason } : undefined;
  });
}
