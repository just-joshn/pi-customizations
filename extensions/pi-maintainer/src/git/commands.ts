import type { CommandEnv, CommandSpec } from '../core/command.ts';
import { parseQuotedFilenames } from '../edit/quoted-filenames.ts';

/**
 * `/git` runs argv `git` with `GIT_EDITOR=true`, inherits process cwd (not the repo root),
 * and prints combined stdout+stderr without adding it to chat.
 * Aider uses `shell=True`; Pi uses argv via Host.exec/isolatedExec so shell metacharacters are not evaluated.
 */
async function runRawGit(argsText: string, env: CommandEnv): Promise<void> {
  const args = parseQuotedFilenames(argsText);
  try {
    const outcome = await env.host.exec({ command: 'git', args, cwd: process.cwd(), env: { GIT_EDITOR: 'true' } });
    env.host.output(`${outcome.stdout}${outcome.stderr}`);
  } catch (err) {
    env.host.error(`Error running /git command: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Slash commands owned by the git SAR (`/git`, `/commit`, `/diff`). */
export const gitCommands: readonly CommandSpec[] = [
  {
    name: 'git',
    description: 'Run a git command (output excluded from chat)',
    async run(args, env) {
      await runRawGit(args, env);
    },
  },
  {
    name: 'commit',
    description: 'Commit edits to the repo made outside the chat (commit message optional)',
    async run(args, env) {
      if (env.git.repoRoot() === null) {
        env.host.error('No git repository found.');
        return;
      }
      const message = args.trim() ? args.trim() : null;
      const result = await env.git.commitDirty(message);
      if (result.kind === 'failed') env.host.error(`Unable to complete commit: ${result.error}`);
    },
  },
  {
    name: 'diff',
    description: 'Display the diffs of changes since last message',
    async run(_args, env) {
      if (env.git.repoRoot() === null) {
        env.host.error('No git repository found.');
        return;
      }
      const result = await env.git.diffForDisplay();
      if (result.kind === 'disabled') {
        env.host.error('No git repository found.');
        return;
      }
      if (result.kind === 'error') {
        env.host.error(result.message);
        return;
      }
      if (result.kind === 'warning') {
        env.host.warning(result.message);
        return;
      }
      env.host.output(`Diff since ${result.baseline.slice(0, 7)}...`);
      env.host.output(result.text);
    },
  },
];
