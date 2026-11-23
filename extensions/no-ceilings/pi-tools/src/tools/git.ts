import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { truncateTail } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { SPILL_DIR } from '../constants.ts';
import { layerError } from '../core/errors.ts';
import { displayPath, resolveToolPath } from '../core/paths.ts';
import { prepareWith } from '../core/repair.ts';
import type { LayerContext } from '../core/session.ts';
import { guardCommand, type LayerSession } from '../core/session.ts';
import { guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

export const gitParameters = Type.Object({
  subcommand: Type.String({ description: 'Git subcommand, for example status, diff, log, show, branch, add, or commit' }),
  args: Type.Optional(Type.Array(Type.String(), { description: 'Arguments passed to git verbatim' })),
  cwd: Type.Optional(Type.String({ description: 'Repository directory (default: current directory)' })),
});

interface GitParams {
  subcommand: string;
  args?: string[];
  cwd?: string;
}

export interface GitDetails {
  readonly subcommand?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly exitCode?: number;
  readonly truncated?: boolean;
  readonly fullOutputPath?: string;
  readonly failure?: ToolFailure;
}

export interface GitToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
  /** Runs the command without a shell. Injected so tests can stub git. */
  readonly exec: GitExec;
}

const SUBCOMMAND_PATTERN = /^[a-z][a-z0-9-]*$/;

export function createGitLayerTool(options: GitToolOptions) {
  return {
    name: 'git',
    label: 'git',
    description:
      'Run a git subcommand through the local git executable. Output is captured with the exit code, truncated to the last 2000 lines or 50KB, and spilled to a file when truncated. Refuses subcommands the permission policy denies.',
    promptSnippet: 'Run git subcommands with captured output and an exit code',
    promptGuidelines: ['Use git for status, diff, log, add, and commit instead of building shell pipelines; pass args as separate strings.'],
    prepareArguments: prepareWith({ aliases: { command: 'subcommand', cwd_path: 'cwd' }, arrays: ['args'], strings: ['subcommand'] }),
    parameters: gitParameters,
    defaultActive: false,
    execute: guarded<GitParams, GitDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx, signal }): Promise<ToolOutcome<GitDetails>> => {
        const session = await options.session(ctx);
        const cwd = params.cwd === undefined ? ctx.cwd : resolveToolPath(params.cwd, ctx.cwd, session.home);
        const subcommand = params.subcommand.trim();
        if (!SUBCOMMAND_PATTERN.test(subcommand)) {
          throw layerError('invalid_arguments', `Invalid git subcommand: ${subcommand}`, { hint: 'Pass a single word such as status, diff, or log.' });
        }
        const args = params.args ?? [];
        const commandLine = ['git', subcommand, ...args].join(' ');
        await guardCommand(session, commandLine, cwd, ctx);

        const result = await options.exec(session, cwd, ['git', subcommand, ...args], signal);
        const combined = [result.stdout, result.stderr].filter((part) => part !== '').join(result.stdout === '' || result.stderr === '' ? '' : '\n');
        const truncation = truncateTail(combined, { maxLines: 2000, maxBytes: 50 * 1024 });
        let fullOutputPath: string | undefined;
        if (truncation.truncated) {
          const directory = path.join(session.cwd, SPILL_DIR);
          await mkdir(directory, { recursive: true });
          fullOutputPath = path.join(directory, `git-${Date.now()}.log`);
          await writeFile(fullOutputPath, combined, 'utf-8');
        }
        const notice = truncation.truncated ? `\n\n[output truncated. Full output: ${fullOutputPath}]` : '';
        const body = truncation.content === '' ? '(no output)' : truncation.content;
        return {
          content: [{ type: 'text', text: `${body}${notice}` }],
          details: {
            subcommand,
            args,
            cwd: displayPath(ctx.cwd, cwd),
            exitCode: result.code,
            ...(truncation.truncated ? { truncated: true } : {}),
            ...(fullOutputPath === undefined ? {} : { fullOutputPath }),
          },
          structuredContent: { subcommand, args, exitCode: result.code, stdout: result.stdout, stderr: result.stderr },
          ...(result.code === 0 ? {} : { isError: true }),
        };
      },
      (params) => params.cwd,
    ),
  };
}

export interface GitExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export type GitExec = (session: LayerSession, cwd: string, argv: readonly string[], signal: AbortSignal | undefined) => Promise<GitExecResult>;
