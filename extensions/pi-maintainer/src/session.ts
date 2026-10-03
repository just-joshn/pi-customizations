/**
 * The maintainer's per-session state and the flows that act on it. The
 * extension entry point only registers flags, events, and commands; every
 * handler here owns the state it needs for the session's lifetime.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent, ToolCallEvent, ToolResultEvent, TurnEndEvent, TurnEndEventResult } from '@earendil-works/pi-coding-agent';
import { type LintSessionPorts, type RepairDeps, runLintCommand, runRunCommand, runTestCommand } from './commands.ts';
import { makeConfirm } from './confirm.ts';
import type { GitRunner } from './git.ts';
import { Linter } from './linter.ts';
import { OneShotRunner } from './one-shot.ts';
import { parseLintCmds } from './parse-lint-cmds.ts';
import { loadParser } from './parsers.ts';
import { lintTestPromptSection } from './platform-info.ts';
import { nextReflectionCount, type PostEditConfig, type PostEditIo, type PostEditPlan, planPostEditRepair } from './reflection.ts';
import { runShellCommand } from './run-command.ts';
import { type CmdRunIo, cmdRun } from './test-run.ts';
import { type CustomMessageDraft, INITIAL_MESSAGE_STATE, type LintCommands, type LinterIo, MAX_REFLECTIONS, type MessageRepairState } from './types.ts';

const EMPTY_COMMANDS: LintCommands = { entries: [], global: undefined, byLanguage: new Map() };
const PROMPT_SECTION_KEY = 'maintainer-lint-test';

export class MaintainerSession {
  private readonly pi: ExtensionAPI;

  /**
   * The context the current operation must use. Pi disposes a replaced
   * session's context, so handlers set this before doing work, `withSession`
   * sets it to the replacement, and every port reads it at call time.
   */
  private currentContext: ExtensionContext | undefined = undefined;

  private readonly io: LinterIo = {
    output: (message) => this.emitOutput(message, 'info'),
    warning: (message) => this.emitOutput(message, 'warning'),
    error: (message) => this.emitOutput(message, 'error'),
  };

  private messageState: MessageRepairState = INITIAL_MESSAGE_STATE;

  private editedPaths: readonly string[] = [];

  private editFailedThisTurn = false;

  private linter: Linter | undefined;

  private lintCommands: LintCommands = EMPTY_COMMANDS;

  private testCmd: string | undefined;

  private autoLint = true;

  private autoTest = false;

  private yesAlways = false;

  private configError = false;

  private oneShot: OneShotRunner | undefined;

  /** The abort signal for the operation that owns the current lint run. */
  private activeSignal: AbortSignal | undefined = undefined;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  async onSessionStart(event: SessionStartEvent, ctx: ExtensionContext): Promise<void> {
    this.currentContext = ctx;
    this.messageState = INITIAL_MESSAGE_STATE;
    this.editedPaths = [];
    this.configure(ctx);
    if (this.configError) {
      process.exitCode = 1;
      ctx.shutdown();
      return;
    }
    if (event.reason !== 'startup') return;
    await this.startOneShot(ctx);
  }

  onBeforeAgentStart(event: BeforeAgentStartEvent): void {
    this.messageState = INITIAL_MESSAGE_STATE;
    const section = lintTestPromptSection(this.lintCommands, this.testCmd, this.autoLint, this.autoTest);
    // agents-compliance-ignore immutability: mutating systemPromptOptions.sections is the documented Pi mechanism for structured prompt changes
    const sections = event.systemPromptOptions.sections;
    // agents-compliance-ignore immutability: sections mutation appends or clears this extension's key only
    if (section !== undefined) sections[PROMPT_SECTION_KEY] = section;
    else delete sections[PROMPT_SECTION_KEY];
  }

  onTurnStart(): void {
    this.editedPaths = [];
    this.editFailedThisTurn = false;
  }

  onToolCall(event: ToolCallEvent, ctx: ExtensionContext): void {
    this.currentContext = ctx;
    if (event.toolName !== 'edit' && event.toolName !== 'write') return;
    const path = toolCallPath(event.input);
    if (path === undefined) return;
    const resolved = resolve(ctx.cwd, path);
    if (!this.editedPaths.includes(resolved)) this.editedPaths = [...this.editedPaths, resolved];
  }

  onToolResult(event: ToolResultEvent): void {
    if (event.toolName !== 'edit' && event.toolName !== 'write') return;
    if (event.isError) this.editFailedThisTurn = true;
  }

  async onTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<TurnEndEventResult | undefined> {
    this.currentContext = ctx;
    if (event.outcome !== 'completed') return undefined;
    if (this.linter === undefined) return undefined;
    if (this.editFailedThisTurn) {
      // The malformed edit's failure text is the turn's repair payload, so it spends one reflection.
      this.messageState = { ...this.messageState, numReflections: this.messageState.numReflections + 1 };
      return undefined;
    }
    if (this.editedPaths.length === 0) return undefined;
    this.activeSignal = ctx.signal;
    const plan = await planPostEditRepair(this.messageState, this.postEditConfig(), this.editedPaths, this.postEditIo(ctx));
    this.messageState = {
      ...this.messageState,
      numReflections: nextReflectionCount(this.messageState, plan),
      lintOutcome: plan.lintOutcome,
      testOutcome: plan.testOutcome,
      reflectedMessage: plan.reflection,
    };
    return planResult(plan);
  }

  async onAgentSettled(): Promise<void> {
    const runner = this.oneShot;
    if (runner === undefined) return;
    await runner.onSettled();
  }

  async onLintCommand(ctx: ExtensionCommandContext): Promise<void> {
    this.currentContext = ctx;
    await ctx.waitForIdle();
    this.activeSignal = ctx.signal;
    await runLintCommand(this.repairDeps(ctx), this.lintSessionPorts(ctx));
  }

  async onTestCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
    this.currentContext = ctx;
    await ctx.waitForIdle();
    await runTestCommand(this.repairDeps(ctx), args);
  }

  async onRunCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
    this.currentContext = ctx;
    await runRunCommand(this.repairDeps(ctx), args, {
      setEditorText: (text) => ctx.ui.setEditorText(text),
      mode: ctx.mode,
    });
  }

  private async startOneShot(ctx: ExtensionContext): Promise<void> {
    const wantsLint = this.pi.getFlag('lint') === true;
    const wantsTest = this.pi.getFlag('test') === true;
    if (!wantsLint && !wantsTest) return;
    this.oneShot = new OneShotRunner(
      {
        pi: this.pi,
        io: this.io,
        confirm: this.confirmFor(ctx),
        cmdRunIo: this.cmdRunIoFor(ctx),
        git: this.gitFor(ctx),
        linter: this.requireLinter(),
        cwd: ctx.cwd,
        shutdown: () => ctx.shutdown(),
      },
      wantsLint,
      wantsTest,
      this.testCmd,
    );
    await this.oneShot.start();
  }

  private configure(ctx: ExtensionContext): void {
    this.autoLint = this.pi.getFlag('auto-lint') === true && this.pi.getFlag('no-auto-lint') !== true;
    this.autoTest = this.pi.getFlag('auto-test') === true && this.pi.getFlag('no-auto-test') !== true;
    this.yesAlways = this.pi.getFlag('yes-always') === true;
    this.testCmd = this.flagString('test-cmd');
    this.lintCommands = this.parseLintFlags();
    this.linter = new Linter({
      io: this.io,
      root: ctx.cwd,
      pythonPath: process.env.PI_MAINTAINER_PYTHON ?? 'python3',
      loadParser,
      runShell: (command, cwd, signal) => runShellCommand(command, cwd, signal),
      readReplacement: (path) => new TextDecoder('utf-8').decode(readFileSync(path)),
      signal: () => this.activeSignal,
    });
    this.applyLintCommands();
  }

  private parseLintFlags(): LintCommands {
    const flag = this.flagString('lint-cmd');
    const parsed = parseLintCmds(flag === undefined ? [] : flag.split('\n'));
    this.configError = parsed.messages.length > 0;
    const io = this.io;
    for (const message of parsed.messages) {
      if (message.channel === 'error') io.error(message.text);
      else io.output(message.text);
    }
    return parsed.commands ?? EMPTY_COMMANDS;
  }

  private applyLintCommands(): void {
    const linter = this.requireLinter();
    if (this.lintCommands.global !== undefined) linter.setLinter(undefined, this.lintCommands.global);
    for (const [lang, cmd] of this.lintCommands.byLanguage) linter.setLinter(lang, cmd);
  }

  private postEditConfig(): PostEditConfig {
    return {
      autoLint: this.autoLint,
      autoTest: this.autoTest,
      testCmd: this.testCmd,
      maxReflections: MAX_REFLECTIONS,
      editFailed: this.editFailedThisTurn,
    };
  }

  private postEditIo(ctx: ExtensionContext): PostEditIo {
    return {
      lintEdited: (paths) => this.requireLinter().lintEdited(paths),
      runTest: async (command) => {
        const result = await cmdRun(this.cmdRunIoFor(ctx), command, true);
        return { failed: result.exitStatus !== 0, formattedMessage: result.formattedMessage };
      },
      confirm: this.confirmFor(ctx),
      warning: this.io.warning,
    };
  }

  private repairDeps(ctx: ExtensionContext): RepairDeps {
    return {
      pi: this.pi,
      linter: this.requireLinter(),
      io: this.io,
      confirm: this.confirmFor(ctx),
      cmdRunIo: this.cmdRunIoFor(ctx),
      git: this.gitFor(ctx),
      appendOutputEntry: (draft) => this.appendOutput(draft),
      testCmd: this.testCmd,
    };
  }

  private lintSessionPorts(ctx: ExtensionCommandContext): LintSessionPorts {
    return {
      cwd: ctx.cwd,
      branch: ctx.sessionManager.getBranch(),
      waitForIdle: () => ctx.waitForIdle(),
      originalSessionFile: ctx.sessionManager.getSessionFile(),
      newSession: async (run) => {
        const previous = this.currentContext;
        await ctx.newSession({
          withSession: async (replacement) => {
            this.currentContext = replacement;
            try {
              await run({
                sendUserMessage: (content) => replacement.sendUserMessage(content),
                waitForIdle: () => replacement.waitForIdle(),
                switchSession: (sessionFile) => replacement.switchSession(sessionFile),
                confirm: this.confirmFor(replacement),
              });
            } finally {
              this.currentContext = previous;
            }
          },
        });
      },
    };
  }

  private cmdRunIoFor(ctx: ExtensionContext): CmdRunIo {
    return {
      output: this.io.output,
      confirm: this.confirmFor(ctx),
      runShell: (command) => runShellCommand(command, ctx.cwd, ctx.signal),
    };
  }

  private gitFor(ctx: ExtensionContext): GitRunner {
    return {
      exec: async (args) => {
        const options = ctx.signal === undefined ? { cwd: ctx.cwd } : { cwd: ctx.cwd, signal: ctx.signal };
        try {
          const result = await this.pi.exec('git', [...args], options);
          return { code: result.code, stdout: result.stdout };
        } catch {
          return { code: 1, stdout: '' };
        }
      },
    };
  }

  private emitOutput(message: string, type: 'info' | 'warning' | 'error'): void {
    const ctx = this.currentContext;
    if (ctx?.hasUI) {
      ctx.ui.notify(message, type);
      return;
    }
    this.pi.appendEntry('maintainer-output', { message, type });
  }

  private confirmFor(target: ExtensionContext): (question: string) => Promise<boolean> {
    return makeConfirm({ hasUI: target.hasUI, confirm: (question, detail) => target.ui.confirm(question, detail) }, this.yesAlways);
  }

  private appendOutput(draft: CustomMessageDraft): void {
    this.pi.sendMessage(draft);
  }

  private flagString(name: string): string | undefined {
    const value = this.pi.getFlag(name);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private requireLinter(): Linter {
    if (this.linter === undefined) throw new Error('pi-maintainer was not configured for this session');
    return this.linter;
  }
}

function toolCallPath(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('path' in input)) return undefined;
  const candidate: unknown = input.path;
  return typeof candidate === 'string' ? candidate : undefined;
}

function planResult(plan: PostEditPlan): TurnEndEventResult | undefined {
  if (plan.entries.length === 0 && plan.reflection === undefined) return undefined;
  const entries = plan.entries.map((draft) => ({
    type: 'custom_message' as const,
    customType: draft.customType,
    content: draft.content,
    display: draft.display,
  }));
  return plan.reflection !== undefined ? { entries, continue: true } : { entries };
}
