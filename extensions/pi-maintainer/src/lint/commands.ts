import { chatFilesOf } from '../core/branch.ts';
import { absRootPath, inchatRelativeFiles } from '../core/chat-files.ts';
import type { CommandEnv, CommandSpec } from '../core/command.ts';
import { parseQuotedFilenames } from '../edit/quoted-filenames.ts';
import { lintFile } from './linter.ts';
import { listDirtyRelativeFiles, selectLintRelativeFiles } from './select-files.ts';

async function runLint(args: string, env: CommandEnv): Promise<void> {
  if (env.git.repoRoot() === null) {
    env.host.error('No git repository found.');
    return;
  }
  const root = env.snapshot.root;
  const explicit = parseQuotedFilenames(args);
  const chatFiles = inchatRelativeFiles(root, chatFilesOf(env.snapshot));
  const dirtyFiles = explicit.length || chatFiles.length ? [] : await listDirtyRelativeFiles(env.host, root);
  const selected = selectLintRelativeFiles({ explicit, chatFiles, dirtyFiles });
  if (!selected.length) {
    env.host.warning('No dirty files to lint.');
    return;
  }
  for (const rel of selected) {
    const abs = absRootPath(root, rel);
    try {
      const errors = await lintFile(abs, { host: env.host, root, lintCmds: env.lintCmds });
      if (errors) env.host.output(errors);
    } catch (error) {
      env.host.error(`Unable to lint ${abs}`);
      env.host.output(error instanceof Error ? error.message : String(error));
    }
  }
}

async function runTest(args: string, env: CommandEnv): Promise<void> {
  const command = args.trim() || env.testCmd;
  if (!command) return;
  const outcome = await env.lint.runTestCommand(command);
  if (outcome.kind !== 'failed') return;
  const numLines = outcome.report.trim().split(/\r?\n/).length;
  const linePlural = numLines === 1 ? 'line' : 'lines';
  env.host.output(`Added ${numLines} ${linePlural} of output to the chat.`);
  await env.sendUserMessage(outcome.report);
}

/** Slash commands owned by the lint SAR (`/lint`, `/test`). */
export const lintCommands: readonly CommandSpec[] = [
  {
    name: 'lint',
    description: 'Lint and fix in-chat files or all dirty files if none in chat',
    run: runLint,
  },
  {
    name: 'test',
    description: 'Run a shell command and add the output to the chat on non-zero exit code',
    run: runTest,
  },
];
