/**
 * The /lint, /test, and /run command flows plus the one-shot flag flows.
 * All behavior mirrors the reference commands, including the order of the
 * confirmations and the exact message texts. Pi session operations arrive
 * through narrow ports so the flows stay testable.
 */

import type { ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent';
import { dirtyFiles, type GitRunner, isGitRepo } from './git.ts';
import { LintRepairQueue } from './lint-queue.ts';
import type { Linter } from './linter.ts';
import { COMMAND_OUTPUT_CUSTOM_TYPE, RUN_PLACEHOLDER } from './strings.ts';
import { type CmdRunIo, type CommandRunResult, cmdRun } from './test-run.ts';
import type { CustomMessageDraft, LinterIo } from './types.ts';

export interface RepairDeps {
  readonly pi: Pick<ExtensionAPI, 'sendUserMessage'>;
  readonly linter: Linter;
  readonly io: LinterIo;
  readonly confirm: (question: string) => Promise<boolean>;
  readonly cmdRunIo: CmdRunIo;
  readonly git: GitRunner;
  readonly appendOutputEntry: (draft: CustomMessageDraft) => void;
  readonly testCmd: string | undefined;
}

/** Session operations /lint needs, supplied by the extension entry point. */
export interface LintSessionPorts {
  readonly cwd: string;
  readonly branch: readonly SessionEntry[];
  readonly waitForIdle: () => Promise<void>;
  readonly originalSessionFile: string | undefined;
  /** Runs the callback inside a fresh session and returns to the original one. */
  readonly newSession: (run: (clone: ClonePorts) => Promise<void>) => Promise<unknown>;
}

export interface ClonePorts {
  readonly sendUserMessage: (content: string) => Promise<void>;
  readonly waitForIdle: () => Promise<void>;
  readonly switchSession: (sessionFile: string) => Promise<unknown>;
  /** Confirmation bound to the replacement session's context. */
  readonly confirm: (question: string) => Promise<boolean>;
}

/** Files the model edited earlier in the active branch, first-seen order. */
export function inChatFiles(cwd: string, branch: readonly SessionEntry[]): readonly string[] {
  const files: string[] = [];
  for (const entry of branch) {
    if (entry.type !== 'message') continue;
    const { message } = entry;
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type !== 'toolCall') continue;
      if (block.name !== 'edit' && block.name !== 'write') continue;
      const path = toolCallPath(block.arguments);
      if (path === undefined) continue;
      const resolved = absolutePath(cwd, path);
      if (!files.includes(resolved)) files.push(resolved);
    }
  }
  return files;
}

function toolCallPath(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || !('path' in args)) return undefined;
  const candidate: unknown = args.path;
  return typeof candidate === 'string' ? candidate : undefined;
}

function absolutePath(cwd: string, path: string): string {
  return path.startsWith('/') ? path : `${cwd}/${path}`;
}

/** /lint: repo required, args deliberately ignored, per-file confirm, repairs in a fresh session. */
export async function runLintCommand(deps: RepairDeps, session: LintSessionPorts): Promise<void> {
  if (!(await isGitRepo(deps.git))) {
    deps.io.error('No git repository found.');
    return;
  }
  let files = inChatFiles(session.cwd, session.branch);
  if (files.length === 0) files = await dirtyFiles(deps.git);
  if (files.length === 0) {
    deps.io.warning('No dirty files to lint.');
    return;
  }

  const queue = new LintRepairQueue({ linter: deps.linter, io: deps.io, files });
  const first = await queue.next(deps.confirm);
  if (first === undefined) return;
  await session.newSession(async (clone) => {
    await repairAcceptedFiles(queue, clone, first, session.originalSessionFile);
  });
}

/** Repairs run in one fresh session with empty history; the session is reused for every file. */
async function repairAcceptedFiles(queue: LintRepairQueue, clone: ClonePorts, first: string, originalSessionFile: string | undefined): Promise<void> {
  await repairOneFile(clone, first);
  for (;;) {
    const errors = await queue.next(clone.confirm);
    if (errors === undefined) break;
    await repairOneFile(clone, errors);
  }
  if (originalSessionFile !== undefined) await clone.switchSession(originalSessionFile);
}

async function repairOneFile(clone: ClonePorts, errors: string): Promise<void> {
  await clone.sendUserMessage(errors);
  await clone.waitForIdle();
}

export async function runTestCommand(deps: RepairDeps, args: string): Promise<void> {
  const arg = args.trim().length > 0 ? args.trim() : undefined;
  const command = arg ?? deps.testCmd;
  if (command === undefined || command === '') return;

  const result = await cmdRun(deps.cmdRunIo, command, true);
  appendRunOutput(deps, result);
  if (result.returnedMessage !== undefined) deps.pi.sendUserMessage(result.returnedMessage);
}

export async function runRunCommand(deps: RepairDeps, args: string, editor: { setEditorText(text: string): void; readonly mode: string }): Promise<void> {
  const result = await cmdRun(deps.cmdRunIo, args, false);
  appendRunOutput(deps, result);
  if (result.placeholder && editor.mode === 'tui') editor.setEditorText(RUN_PLACEHOLDER);
}

export function appendRunOutput(deps: RepairDeps, result: CommandRunResult): void {
  if (result.formattedMessage === undefined) return;
  deps.appendOutputEntry({
    customType: COMMAND_OUTPUT_CUSTOM_TYPE,
    content: result.formattedMessage,
    display: true,
  });
}
