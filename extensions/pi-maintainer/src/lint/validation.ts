import { isAbsolute, join } from 'node:path';

import { ConfirmGroup } from '../core/confirm.ts';
import type { Host } from '../core/host.ts';
import type { ShellForwardOutcome, Validation } from '../feature.ts';
import { lintFile } from './linter.ts';
import { formatRunOutput } from './run-output.ts';
import { runShellCommand } from './shell.ts';

export interface CreateValidationOptions {
  readonly host: Host;
  readonly root: string;
  readonly autoLint: boolean;
  readonly autoTest: boolean;
  readonly lintCmds: ReadonlyMap<string | null, string>;
  readonly testCmd: string | null;
  readonly encoding?: string;
}

function absPath(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

/** `Validation` over Host.exec: lint, suggested shell, and the automatic test command. */
export function createValidation(options: CreateValidationOptions): Validation {
  const { host, root, autoLint, autoTest, lintCmds, testCmd } = options;

  return {
    async lintEdited(paths, signal) {
      if (!autoLint) return { kind: 'not-run' };
      signal?.throwIfAborted();
      let report = '';
      let sawClean = false;
      let sawUnsupported = false;
      let unavailableReason: string | null = null;
      for (const path of paths) {
        if (!path) continue;
        signal?.throwIfAborted();
        const outcome = await lintFile(
          absPath(root, path),
          { host, root, lintCmds, ...(options.encoding !== undefined ? { encoding: options.encoding } : {}) },
          signal,
        );
        switch (outcome.kind) {
          case 'failed':
            report += '\n';
            report += outcome.report;
            report += '\n';
            break;
          case 'clean':
            sawClean = true;
            break;
          case 'unsupported':
            sawUnsupported = true;
            break;
          case 'unreadable':
          case 'unavailable':
            unavailableReason = outcome.reason;
            break;
        }
      }
      if (report) {
        host.warning(report);
        return { kind: 'failed', report };
      }
      if (unavailableReason) return { kind: 'unavailable', reason: unavailableReason };
      if (sawClean) return { kind: 'passed' };
      if (sawUnsupported) return { kind: 'not-run' };
      return { kind: 'passed' };
    },

    async testEdited(signal) {
      if (!autoTest) return { kind: 'not-run' };
      if (!testCmd) return { kind: 'not-run' };
      signal?.throwIfAborted();
      const { code, output } = await runShellCommand(host, testCmd, root, signal);
      if (code === 0) return { kind: 'passed' };
      const report = [
        `I ran this test command, which failed:\n\n${testCmd}\n\n`,
        output ? `Command output:\n\n${output}` : 'Command output was empty.',
      ].join('');
      host.output(output);
      return { kind: 'failed', report };
    },

    async runTestCommand(command, signal) {
      signal?.throwIfAborted();
      const { code, output } = await runShellCommand(host, command, root, signal);
      if (output) host.output(output);
      if (code === 0) return { kind: 'passed' };
      return { kind: 'failed', report: formatRunOutput(command, output) };
    },

    async runSuggestedShell(commands, signal) {
      signal?.throwIfAborted();
      const group = new ConfirmGroup(commands);
      let accumulated = '';
      for (const block of commands) {
        signal?.throwIfAborted();
        const lines = block.trim().split(/\r?\n/);
        const commandCount = lines.filter((line) => {
          const trimmed = line.trim();
          return trimmed && !trimmed.startsWith('#');
        }).length;
        const question = commandCount === 1 ? 'Run shell command?' : 'Run shell commands?';
        const approved = await host.confirm({
          question,
          subject: lines.join('\n'),
          explicitYesRequired: true,
          group,
          allowNever: true,
        });
        if (!approved) continue;

        for (const line of lines) {
          const command = line.trim();
          if (!command || command.startsWith('#')) continue;
          host.output('');
          host.output(`Running ${command}`);
          const { output } = await runShellCommand(host, command, root, signal);
          if (output) accumulated += `Output from ${command}\n${output}\n`;
        }
      }

      if (accumulated.trim()) {
        const add = await host.confirm({ question: 'Add command output to the chat?', allowNever: true });
        if (add) {
          const numLines = accumulated.trim().split(/\r?\n/).length;
          const linePlural = numLines === 1 ? 'line' : 'lines';
          host.output(`Added ${numLines} ${linePlural} of output to the chat.`);
          return { kind: 'ran', output: accumulated };
        }
      }
      return { kind: 'ran' } satisfies ShellForwardOutcome;
    },
  };
}
