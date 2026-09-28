/**
 * Same-name built-in tool registration.
 *
 * Pi registers the built-ins before extensions load, so a `pi.registerTool()`
 * with the same name replaces the original definition entirely. Each
 * registration spreads the official definition first, then overrides only the
 * presentation fields and `execute`.
 *
 * Pi activates every tool an extension registers, even one the user never
 * selected, so `grep`, `find`, `ls`, and `powershell` register only when
 * `PI_CURSOR_UI_TOOL_OVERRIDES` names them. `read`, `bash`, `edit`, and `write`
 * are Pi's default active set and register unconditionally.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getBuiltin, getBuiltins } from './builtins.ts';
import { renderEditCall, renderEditResult } from './render-edit.ts';
import { renderFindCall, renderFindResult } from './render-find.ts';
import { renderGrepCall, renderGrepResult } from './render-grep.ts';
import { renderLsCall, renderLsResult } from './render-ls.ts';
import { renderReadCall, renderReadResult } from './render-read.ts';
import { renderBashCall, renderBashResult, renderPowerShellCall, renderPowerShellResult } from './render-shell.ts';
import { renderWriteCall, renderWriteResult } from './render-write.ts';

export const TOOL_OVERRIDES_ENV = 'PI_CURSOR_UI_TOOL_OVERRIDES';

type OptInTool = 'grep' | 'find' | 'ls' | 'powershell';

const OPT_IN_TOOLS: readonly OptInTool[] = ['grep', 'find', 'ls', 'powershell'];

function isOptInTool(value: string): value is OptInTool {
  return OPT_IN_TOOLS.some((name) => name === value);
}

/** Names from `PI_CURSOR_UI_TOOL_OVERRIDES`: comma-separated, trimmed, known names only. */
export function parseToolOverrides(value: string | undefined): Set<OptInTool> {
  const enabled = new Set<OptInTool>();
  for (const entry of (value ?? '').split(',')) {
    const name = entry.trim();
    if (isOptInTool(name)) enabled.add(name);
  }
  return enabled;
}

export function registerToolRenderers(pi: ExtensionAPI): void {
  const template = getBuiltins(process.cwd());
  const overrides = parseToolOverrides(process.env[TOOL_OVERRIDES_ENV]);

  pi.registerTool({
    ...template.read,
    renderShell: 'self',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltin(ctx.cwd, 'read').execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall: (args, theme, context) => renderReadCall(args, theme, context),
    renderResult: (result, options, theme, context) => renderReadResult(result, options, theme, context),
  });

  pi.registerTool({
    ...template.bash,
    renderShell: 'self',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltin(ctx.cwd, 'bash').execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall: (args, theme, context) => renderBashCall(args, theme, context),
    renderResult: (result, options, theme, context) => renderBashResult(result, options, theme, context),
  });

  if (overrides.has('powershell')) {
    pi.registerTool({
      ...template.powershell,
      renderShell: 'self',
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        return getBuiltin(ctx.cwd, 'powershell').execute(toolCallId, params, signal, onUpdate, ctx);
      },
      renderCall: (args, theme, context) => renderPowerShellCall(args, theme, context),
      renderResult: (result, options, theme, context) => renderPowerShellResult(result, options, theme, context),
    });
  }

  pi.registerTool({
    ...template.edit,
    renderShell: 'self',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltin(ctx.cwd, 'edit').execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall: (args, theme, context) => renderEditCall(args, theme, context),
    renderResult: (result, options, theme, context) => renderEditResult(result, options, theme, context),
  });

  pi.registerTool({
    ...template.write,
    renderShell: 'self',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltin(ctx.cwd, 'write').execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall: (args, theme, context) => renderWriteCall(args, theme, context),
    renderResult: (result, options, theme, context) => renderWriteResult(result, options, theme, context),
  });

  if (overrides.has('grep')) {
    pi.registerTool({
      ...template.grep,
      renderShell: 'self',
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        return getBuiltin(ctx.cwd, 'grep').execute(toolCallId, params, signal, onUpdate, ctx);
      },
      renderCall: (args, theme, context) => renderGrepCall(args, theme, context),
      renderResult: (result, options, theme, context) => renderGrepResult(result, options, theme, context),
    });
  }

  if (overrides.has('find')) {
    pi.registerTool({
      ...template.find,
      renderShell: 'self',
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        return getBuiltin(ctx.cwd, 'find').execute(toolCallId, params, signal, onUpdate, ctx);
      },
      renderCall: (args, theme, context) => renderFindCall(args, theme, context),
      renderResult: (result, options, theme, context) => renderFindResult(result, options, theme, context),
    });
  }

  if (overrides.has('ls')) {
    pi.registerTool({
      ...template.ls,
      renderShell: 'self',
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        return getBuiltin(ctx.cwd, 'ls').execute(toolCallId, params, signal, onUpdate, ctx);
      },
      renderCall: (args, theme, context) => renderLsCall(args, theme, context),
      renderResult: (result, options, theme, context) => renderLsResult(result, options, theme, context),
    });
  }
}
