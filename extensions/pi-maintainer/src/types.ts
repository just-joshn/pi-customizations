/**
 * Domain types for the lint and test repair pipeline.
 *
 * Shapes mirror the reference architecture: a per-file `LintResult`, a checker
 * that is either a callable or a shell command string, and per-language lint
 * commands with at most one language-less global command.
 */

import type { ProcessOutcome } from './run-command.ts';

/** Overrides the fatal-lint subprocess runner; the real runner stays the default. */
export type FatalLintRunner = (args: readonly string[], cwd: string | undefined, signal?: AbortSignal) => Promise<ProcessOutcome>;

export interface LintResult {
  readonly text: string;
  readonly lines: readonly number[];
}
export interface LintCallableInput {
  readonly fname: string;
  readonly relFname: string;
  readonly code: string;
}

export type LintCallable = (input: LintCallableInput) => Promise<LintResult | undefined> | LintResult | undefined;

export type LintChecker = LintCallable | string;

/**
 * One lint command as it appeared on the command line. A language-less entry
 * overrides every per-language entry for dispatch, but the prompt lists the
 * entries in the order they were given.
 */
export interface LintCommandEntry {
  readonly lang: string | undefined;
  readonly cmd: string;
}

/**
 * Lint commands parsed from the flag, plus the derived dispatch fields. The
 * global command is the one given without a `language:` prefix; at most one
 * exists and it overrides every per-language entry. A repeated language keeps
 * the last command for dispatch and every entry for the prompt.
 */
export interface LintCommands {
  readonly entries: readonly LintCommandEntry[];
  readonly global: string | undefined;
  readonly byLanguage: ReadonlyMap<string, string>;
}

/** Terminal output channels, mirroring the reference io tool methods. */
export interface LinterIo {
  readonly output: (message: string) => void;
  readonly warning: (message: string) => void;
  readonly error: (message: string) => void;
}

export interface LinterDeps {
  readonly io: LinterIo;
  readonly root: string | undefined;
  readonly pythonPath: string;
  readonly loadParser: (lang: string) => Promise<TreeSitterParser>;
  readonly runShell: (command: string, cwd: string | undefined, signal?: AbortSignal) => Promise<readonly [number, string]>;
  readonly readReplacement: (path: string) => string;
  /** The abort signal for the operation that owns the current lint run, if any. */
  readonly signal?: (() => AbortSignal | undefined) | undefined;
  /** Overrides the fatal-lint subprocess runner; the real runner stays the default. */
  readonly runFatalLint?: FatalLintRunner | undefined;
}

/** Minimal structural type for a web-tree-sitter parser (keeps core modules Pi-free). */
export interface TreeSitterParser {
  parse(input: string): ParsedTree | null;
}

export interface ParsedTree {
  readonly rootNode: ParsedNode;
}

export interface ParsedNode {
  readonly type: string;
  readonly isMissing: boolean;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly children: ReadonlyArray<ParsedNode | null>;
}

export interface CustomMessageDraft {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}

/** Counters and flags that live for one user message (reset by before_agent_start). */
export interface MessageRepairState {
  readonly numReflections: number;
  readonly lintOutcome: boolean | undefined;
  readonly testOutcome: boolean | undefined;
  readonly reflectedMessage: string | undefined;
}

export const INITIAL_MESSAGE_STATE: MessageRepairState = {
  numReflections: 0,
  lintOutcome: undefined,
  testOutcome: undefined,
  reflectedMessage: undefined,
};

export const MAX_REFLECTIONS = 3;
