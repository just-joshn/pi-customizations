import { stat } from 'node:fs/promises';

import { createBashToolDefinition, createLocalBashOperations } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { SHELL_STARTUP_ENV } from '../core/command.ts';
import { layerError } from '../core/errors.ts';
import { displayPath, resolveToolPath } from '../core/paths.ts';
import { prepareWith } from '../core/repair.ts';
import type { LayerContext } from '../core/session.ts';
import { guardCommand, type LayerSession } from '../core/session.ts';
import { emitUpdate, guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

export const shellParameters = Type.Object({
  command: Type.String({ description: 'Shell command to execute' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the command (default: current directory)' })),
  env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'Environment variables to add or override for this command. The process environment is inherited.' })),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (optional, no default). 0 or a negative value disables the timer.' })),
});

interface ShellParams {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface ShellDetails {
  readonly command?: string;
  readonly cwd?: string;
  readonly exitCode?: number;
  readonly truncation?: unknown;
  readonly fullOutputPath?: string;
  readonly failure?: ToolFailure;
}

export interface ShellToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
}

export function createShellLayerTool(options: ShellToolOptions) {
  const local = createLocalBashOperations();

  return {
    name: 'bash',
    label: 'bash',
    description:
      'Execute a bash command. Stdout and stderr are captured together, the exit code is reported, output is truncated to the last 2000 lines or 50KB with the full output spilled to a file, and progress streams while the command runs. Pass cwd instead of cd and timeout for long commands. Refuses commands the permission policy denies.',
    promptSnippet: 'Run shell commands with a working directory, env overrides, timeout, and streaming output',
    promptGuidelines: ['Use bash for tests, builds, linters, and git when the dedicated tools do not fit. Pass cwd instead of cd, and timeout for long commands.'],
    prepareArguments: prepareWith({ strings: ['command'], numbers: ['timeout'] }),
    parameters: shellParameters,
    execute: guarded<ShellParams, ShellDetails>(
      (failure) => ({ failure }),
      async ({ toolCallId, params, ctx, signal, onUpdate }): Promise<ToolOutcome<ShellDetails>> => {
        const session = await options.session(ctx);

        const cwd = params.cwd === undefined ? ctx.cwd : resolveToolPath(params.cwd, ctx.cwd, session.home);
        const info = await stat(cwd).catch(() => undefined);
        if (info === undefined || !info.isDirectory()) {
          throw layerError('error', `Working directory does not exist: ${displayPath(ctx.cwd, cwd)}\nThe command did not run.`, { path: cwd });
        }

        await guardCommand(session, params.command, cwd, ctx);
        const timeoutSeconds = params.timeout === undefined ? undefined : Math.max(0, params.timeout);
        const overrides = { ...(params.env ?? {}) };
        for (const key of SHELL_STARTUP_ENV) {
          delete overrides[key];
        }
        const env: NodeJS.ProcessEnv = { ...process.env, ...overrides, PWD: cwd };
        const definition = createBashToolDefinition(ctx.cwd, {
          operations: {
            exec: (command, _cwd, execOptions) => local.exec(command, cwd, { ...execOptions, env }),
          },
        });
        const result = await definition.execute(
          toolCallId,
          { command: params.command, ...(timeoutSeconds !== undefined && timeoutSeconds > 0 ? { timeout: timeoutSeconds } : {}) },
          signal,
          (update) => {
            emitUpdate(onUpdate, textOf(update.content), {
              command: params.command,
              cwd,
              ...(update.details?.truncation === undefined ? {} : { truncation: update.details.truncation }),
              ...(update.details?.fullOutputPath === undefined ? {} : { fullOutputPath: update.details.fullOutputPath }),
            });
          },
          ctx as never,
        );

        const structured = result.structuredContent as { exit_code?: number } | undefined;
        const exitCode = structured?.exit_code;
        return {
          content: result.content,
          details: {
            command: params.command,
            cwd,
            ...(exitCode === undefined ? {} : { exitCode }),
            ...(result.details?.truncation === undefined ? {} : { truncation: result.details.truncation }),
            ...(result.details?.fullOutputPath === undefined ? {} : { fullOutputPath: result.details.fullOutputPath }),
          },
          ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
          ...(result.isError === undefined ? {} : { isError: result.isError }),
        };
      },
      (params) => params.cwd,
    ),
  };
}

function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
  const text = content.find((block) => block.type === 'text')?.text;
  return text === undefined || text === '' ? 'Running…' : text;
}
