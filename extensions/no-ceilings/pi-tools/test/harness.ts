import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { PiToolsConfig } from '../src/core/config.ts';
import { runBinary } from '../src/core/proc.ts';
import { createSessionManager } from '../src/core/session.ts';
import { createSearchToolsTool } from '../src/tools/catalog.ts';
import { createDeleteLayerTool } from '../src/tools/delete.ts';
import { createEditLayerTool } from '../src/tools/edit.ts';
import { createGitLayerTool } from '../src/tools/git.ts';
import { createGlobLayerTool } from '../src/tools/glob.ts';
import { createGrepLayerTool } from '../src/tools/grep.ts';
import { createLsLayerTool } from '../src/tools/ls.ts';
import { createApplyPatchLayerTool } from '../src/tools/patch.ts';
import { createReadLayerTool } from '../src/tools/read.ts';
import { createShellLayerTool } from '../src/tools/shell.ts';
import { createSaveResourceLayerTool, createWebFetchLayerTool, createWebSearchLayerTool } from '../src/tools/web.ts';
import { createWriteLayerTool } from '../src/tools/write.ts';

export type ToolName = 'read' | 'ls' | 'find' | 'grep' | 'write' | 'edit' | 'bash' | 'delete' | 'apply_patch' | 'git' | 'web_fetch' | 'web_search' | 'save_resource' | 'search_tools';

export interface Confirmation {
  readonly title: string;
  readonly message: string;
  readonly answer: boolean;
}

export interface HarnessOptions {
  /** Project configuration written to `.pi/pi-tools.json`. */
  readonly config?: PiToolsConfig;
  /** Extra environment variables for the session. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Answer for every approval prompt. Defaults to true when `hasUI`, false otherwise. */
  readonly confirm?: boolean;
  readonly hasUI?: boolean;
  /** Persistent project trust flag; defaults to true. */
  readonly projectTrusted?: boolean;
  /** Network stub for the web tools. */
  readonly fetch?: typeof globalThis.fetch;
}

export interface Harness {
  readonly root: string;
  readonly workspace: string;
  readonly agentDir: string;
  /** Confirmation prompts recorded so far. */
  readonly confirmations: Confirmation[];
  readonly updates: unknown[];
  call(name: ToolName, params: unknown, options?: { toolCallId?: string; signal?: AbortSignal; hasUI?: boolean }): Promise<AgentToolResult<never>>;
  /** Access a tool definition for schema or metadata assertions. */
  tool(name: ToolName): ToolLike;
  /** Every tool definition this harness built, for schema and validation tests. */
  tools(): readonly ToolLike[];
  file(relative: string): string;
  write(relative: string, content: string): Promise<string>;
  cleanup(): Promise<void>;
}

export interface ToolLike {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly defaultActive?: boolean;
  readonly prepareArguments?: (raw: unknown) => unknown;
  execute: (toolCallId: string, params: never, signal: AbortSignal | undefined, onUpdate: ((update: never) => void) | undefined, ctx: never) => Promise<AgentToolResult<never>>;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'pi-tools-test-'));
  const workspace = path.join(root, 'workspace');
  const agentDir = path.join(root, 'agent');
  await mkdir(workspace, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  if (options.config !== undefined) {
    await mkdir(path.join(workspace, '.pi'), { recursive: true });
    await writeFile(path.join(workspace, '.pi', 'pi-tools.json'), JSON.stringify(options.config, null, 2), 'utf-8');
  }

  const env: Record<string, string | undefined> = { ...process.env, ...options.env };
  const sessions = createSessionManager({
    agentDir,
    home: root,
    env,
    isTrusted: (ctx) => ctx.isProjectTrusted?.() ?? true,
    onConfigError: () => undefined,
  });
  const session = (ctx: { readonly cwd: string; readonly isProjectTrusted?: () => boolean }) => sessions.get(ctx);

  const definitions: readonly ToolLike[] = [
    createReadLayerTool({ session }) as unknown as ToolLike,
    createLsLayerTool({ session }) as unknown as ToolLike,
    createGlobLayerTool({ session }) as unknown as ToolLike,
    createGrepLayerTool({ session }) as unknown as ToolLike,
    createWriteLayerTool({ session }) as unknown as ToolLike,
    createEditLayerTool({ session }) as unknown as ToolLike,
    createShellLayerTool({ session }) as unknown as ToolLike,
    createDeleteLayerTool({ session }) as unknown as ToolLike,
    createApplyPatchLayerTool({ session }) as unknown as ToolLike,
    createGitLayerTool({
      session,
      exec: async (_session, cwd, argv, signal) => {
        const result = await runBinary(argv[0] ?? 'git', argv.slice(1), { cwd, ...(signal === undefined ? {} : { signal }) });
        return { stdout: result.stdout, stderr: result.stderr, code: result.code };
      },
    }) as unknown as ToolLike,
    createWebFetchLayerTool({ session, fetch: options.fetch ?? globalThis.fetch }) as unknown as ToolLike,
    createWebSearchLayerTool({ session, fetch: options.fetch ?? globalThis.fetch }) as unknown as ToolLike,
    createSaveResourceLayerTool({ session, fetch: options.fetch ?? globalThis.fetch }) as unknown as ToolLike,
    createSearchToolsTool({ entries: () => [], active: () => [], activate: () => undefined }) as unknown as ToolLike,
  ];
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));

  const confirmations: Confirmation[] = [];
  const updates: unknown[] = [];

  const call: Harness['call'] = async (name, params, callOptions = {}) => {
    const definition = byName.get(name);
    if (!definition) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const hasUI = callOptions.hasUI ?? options.hasUI ?? false;
    const answer = options.confirm ?? true;
    const ctx = {
      cwd: workspace,
      hasUI,
      isProjectTrusted: () => options.projectTrusted ?? true,
      sessionManager: {
        getSessionId: () => 'pi-tools-test-session',
        getSessionFile: () => undefined,
      },
      ...(hasUI
        ? {
            ui: {
              async confirm(title: string, message: string): Promise<boolean> {
                confirmations.push({ title, message, answer });
                return answer;
              },
            },
          }
        : {}),
    };
    const prepared = definition.prepareArguments === undefined ? params : definition.prepareArguments(params);
    return definition.execute(
      callOptions.toolCallId ?? 'call-1',
      prepared as never,
      callOptions.signal,
      ((update: unknown) => {
        updates.push(update);
      }) as never,
      ctx as never,
    );
  };

  return {
    root,
    workspace,
    agentDir,
    confirmations,
    updates,
    call,
    tool(name) {
      const definition = byName.get(name);
      if (!definition) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return definition;
    },
    tools() {
      return definitions;
    },
    file(relative) {
      return path.join(workspace, relative);
    },
    async write(relative, content) {
      const target = path.join(workspace, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf-8');
      return target;
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** First text block of a tool result. */
export function textOf(result: AgentToolResult<unknown>): string {
  const block = result.content[0];
  return block !== undefined && block.type === 'text' ? block.text : '';
}
