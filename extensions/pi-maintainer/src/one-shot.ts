/**
 * The one-shot --lint and --test flows. In a fresh session the session itself
 * is the empty-history repair coder: accepted lint failures are sent as user
 * messages and the model repairs through its own loop. The lint queue advances
 * one file per turn, so lint, confirmation, and repair interleave per file.
 * The test flow runs the command, adds failing output to the conversation, and
 * exits without calling the model.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { dirtyFiles, type GitRunner, isGitRepo } from './git.ts';
import { LintRepairQueue } from './lint-queue.ts';
import type { Linter } from './linter.ts';
import { COMMAND_OUTPUT_CUSTOM_TYPE } from './strings.ts';
import { type CmdRunIo, cmdRun } from './test-run.ts';
import type { CustomMessageDraft, LinterIo } from './types.ts';

export interface OneShotDeps {
  readonly pi: Pick<ExtensionAPI, 'sendUserMessage' | 'sendMessage'>;
  readonly io: LinterIo;
  readonly confirm: (question: string) => Promise<boolean>;
  readonly cmdRunIo: CmdRunIo;
  readonly git: GitRunner;
  readonly linter: Linter;
  readonly cwd: string;
  readonly shutdown: () => void;
}

export class OneShotRunner {
  private readonly deps: OneShotDeps;

  private readonly runLint: boolean;

  private readonly runTests: boolean;

  private readonly testCmd: string | undefined;

  private queue: LintRepairQueue | undefined;

  constructor(deps: OneShotDeps, runLint: boolean, runTests: boolean, testCmd: string | undefined) {
    this.deps = deps;
    this.runLint = runLint;
    this.runTests = runTests;
    this.testCmd = testCmd;
  }

  async start(): Promise<void> {
    if (this.runLint) await this.prepareLint();
    if (await this.advanceLint()) return;
    await this.finish();
  }

  /** Continues after a repair settles: next accepted file, else the test flow, then shutdown. */
  async onSettled(): Promise<void> {
    if (await this.advanceLint()) return;
    await this.finish();
  }

  private async prepareLint(): Promise<void> {
    if (!(await isGitRepo(this.deps.git))) {
      this.deps.io.error('No git repository found.');
      return;
    }
    const files = await dirtyFiles(this.deps.git);
    if (files.length === 0) {
      this.deps.io.warning('No dirty files to lint.');
      return;
    }
    this.queue = new LintRepairQueue({ linter: this.deps.linter, io: this.deps.io, files });
  }

  private async advanceLint(): Promise<boolean> {
    if (this.queue === undefined) return false;
    const errors = await this.queue.next(this.deps.confirm);
    if (errors === undefined) return false;
    this.deps.pi.sendUserMessage(errors);
    return true;
  }

  private async finish(): Promise<void> {
    if (this.runTests) {
      const command = this.testCmd;
      if (command === undefined || command === '') {
        this.deps.io.error('No --test-cmd provided.');
        process.exitCode = 1;
        this.deps.shutdown();
        return;
      }
      const result = await cmdRun(this.deps.cmdRunIo, command, true);
      if (result.formattedMessage !== undefined) {
        const draft: CustomMessageDraft = {
          customType: COMMAND_OUTPUT_CUSTOM_TYPE,
          content: result.formattedMessage,
          display: true,
        };
        this.deps.pi.sendMessage(draft);
      }
    }
    this.deps.shutdown();
  }
}
