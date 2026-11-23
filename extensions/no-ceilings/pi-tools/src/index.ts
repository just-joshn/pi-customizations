import { type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { createSessionManager, type LayerSession } from './core/session.ts';
import type { CatalogEntry } from './tools/catalog.ts';
import { createSearchToolsTool } from './tools/catalog.ts';
import { createDeleteLayerTool } from './tools/delete.ts';
import { createEditLayerTool } from './tools/edit.ts';
import { createGitLayerTool } from './tools/git.ts';
import { createGlobLayerTool } from './tools/glob.ts';
import { createGrepLayerTool } from './tools/grep.ts';
import { createLsLayerTool } from './tools/ls.ts';
import { createApplyPatchLayerTool } from './tools/patch.ts';
import { createReadLayerTool } from './tools/read.ts';
import { createShellLayerTool } from './tools/shell.ts';
import { createSaveResourceLayerTool, createWebFetchLayerTool, createWebSearchLayerTool } from './tools/web.ts';
import { createWriteLayerTool } from './tools/write.ts';

/**
 * The local tool-execution layer. Filesystem reads, searches, and mutations carry permission checks,
 * ignore-file filtering, stale-write detection, and metadata. Execution and auxiliary tools add a
 * working directory, environment overrides, exit codes, git, web egress, and resource saving.
 */
export default function piToolsExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const warnings: string[] = [];
  const sessions = createSessionManager({
    agentDir,
    isTrusted: (ctx) => ctx.isProjectTrusted?.() ?? true,
    onConfigError: (message) => {
      warnings.push(message);
    },
  });
  const session = (ctx: { readonly cwd: string }) => sessions.get(ctx);

  /** Catalog of every tool this layer owns, independent of the session's tool selection. */
  const catalog: CatalogEntry[] = [];

  const gitExec = async (_session: LayerSession, cwd: string, argv: readonly string[], signal: AbortSignal | undefined) => {
    const [command, ...args] = argv;
    const result = await pi.exec(command ?? 'git', args, { cwd, ...(signal === undefined ? {} : { signal }), maxBuffer: 32 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  };

  const tools = [
    createReadLayerTool({ session }),
    createLsLayerTool({ session }),
    createGlobLayerTool({ session }),
    createGrepLayerTool({ session }),
    createWriteLayerTool({ session }),
    createEditLayerTool({ session }),
    createShellLayerTool({ session }),
    createDeleteLayerTool({ session }),
    createApplyPatchLayerTool({ session }),
    createGitLayerTool({ session, exec: gitExec }),
    createWebFetchLayerTool({ session, fetch: globalThis.fetch }),
    createWebSearchLayerTool({ session, fetch: globalThis.fetch }),
    createSaveResourceLayerTool({ session, fetch: globalThis.fetch }),
    createSearchToolsTool({
      entries: () => catalog,
      active: () => pi.getActiveTools(),
      activate: (names) => {
        const active = pi.getActiveTools();
        pi.setActiveTools([...new Set([...active, ...names])]);
      },
    }),
  ];

  for (const tool of tools) {
    catalog.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
    pi.registerTool(tool as never);
  }

  const reportWarnings = (ctx: ExtensionContext): void => {
    if (warnings.length === 0) {
      return;
    }
    ctx.ui.notify(`pi-tools configuration: ${warnings.join(' | ')}`, 'warning');
    warnings.length = 0;
  };

  pi.on('session_start', async (_event, ctx) => {
    await sessions.refresh(ctx, ctx.isProjectTrusted());
    reportWarnings(ctx);
  });

  pi.on('before_agent_start', async (_event, ctx) => {
    const current = await sessions.get(ctx);
    await current.reloadIgnore();
  });

  pi.registerCommand('pi-tools', {
    description: 'Show the pi-tools policy, ignore files, and tool catalog',
    handler: async (_args, ctx) => {
      const current = await sessions.get(ctx);
      const active = new Set(pi.getActiveTools());
      const catalogLine = catalog.map((entry) => `${active.has(entry.name) ? '•' : '○'} ${entry.name}`).join('  ');
      const rules = current.policy.rules.length === 0 ? 'none' : current.policy.rules.map((rule) => `${rule.kind} ${rule.action} ${rule.pattern}`).join(', ');
      const ignoreFiles = current.ignore.files();
      const ignore = ignoreFiles.length === 0 ? 'none' : ignoreFiles.join(', ');
      const lines = [`mode: ${current.policy.mode}`, `workspace roots: ${current.policy.workspaceRoots.join(', ')}`, `rules: ${rules}`, `ignore files: ${ignore}`, `tools: ${catalogLine}`];
      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });
}
