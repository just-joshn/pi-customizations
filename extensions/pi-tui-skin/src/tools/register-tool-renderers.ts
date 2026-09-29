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
 * `PI_TUI_SKIN_TOOL_OVERRIDES` names them. `read`, `bash`, `edit`, and `write`
 * are Pi's default active set and register unconditionally.
 */

import type { ExtensionAPI, Theme, ToolDefinition, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import type { TSchema } from 'typebox';
import type { Builtins } from './builtins.ts';
import { getBuiltin, getBuiltins } from './builtins.ts';
import { renderEditCall, renderEditResult } from './render-edit.ts';
import { renderFindCall, renderFindResult } from './render-find.ts';
import { renderGrepCall, renderGrepResult } from './render-grep.ts';
import { renderLsCall, renderLsResult } from './render-ls.ts';
import { renderReadCall, renderReadResult } from './render-read.ts';
import type { ToolResultLike, ToolRowContext } from './render-shell.ts';
import { renderBashCall, renderBashResult, renderPowerShellCall, renderPowerShellResult } from './render-shell.ts';
import { renderWriteCall, renderWriteResult } from './render-write.ts';

export const TOOL_OVERRIDES_ENV = 'PI_TUI_SKIN_TOOL_OVERRIDES';

type OptInTool = 'grep' | 'find' | 'ls' | 'powershell';

const OPT_IN_TOOLS: readonly OptInTool[] = ['grep', 'find', 'ls', 'powershell'];

function isOptInTool(value: string): value is OptInTool {
  return OPT_IN_TOOLS.some((name) => name === value);
}

/** Names from `PI_TUI_SKIN_TOOL_OVERRIDES`: comma-separated, trimmed, known names only. */
export function parseToolOverrides(value: string | undefined): Set<OptInTool> {
  const enabled = new Set<OptInTool>();
  for (const entry of (value ?? '').split(',')) {
    const name = entry.trim();
    if (isOptInTool(name)) enabled.add(name);
  }
  return enabled;
}

type ToolRenderers = {
  readonly renderCall: (args: unknown, theme: Theme, context: ToolRowContext) => Component;
  readonly renderResult: (result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext) => Component;
};

type ToolRegistration = {
  /** Set only for tools Pi leaves inactive until the environment names them. */
  readonly optIn?: OptInTool;
  readonly register: (pi: ExtensionAPI, template: Builtins) => void;
};

/**
 * The order here is the registration order, which is the order the tools appear
 * in Pi. Each entry names its own loader, so both the definition it spreads and
 * the delegate it executes stay concrete to that one tool.
 */
const TOOL_REGISTRATIONS: readonly ToolRegistration[] = [
  { register: (pi, template) => registerOverride(pi, template.read, (cwd) => getBuiltin(cwd, 'read'), { renderCall: renderReadCall, renderResult: renderReadResult }) },
  { register: (pi, template) => registerOverride(pi, template.bash, (cwd) => getBuiltin(cwd, 'bash'), { renderCall: renderBashCall, renderResult: renderBashResult }) },
  { optIn: 'powershell', register: (pi, template) => registerOverride(pi, template.powershell, (cwd) => getBuiltin(cwd, 'powershell'), { renderCall: renderPowerShellCall, renderResult: renderPowerShellResult }) },
  { register: (pi, template) => registerOverride(pi, template.edit, (cwd) => getBuiltin(cwd, 'edit'), { renderCall: renderEditCall, renderResult: renderEditResult }) },
  { register: (pi, template) => registerOverride(pi, template.write, (cwd) => getBuiltin(cwd, 'write'), { renderCall: renderWriteCall, renderResult: renderWriteResult }) },
  { optIn: 'grep', register: (pi, template) => registerOverride(pi, template.grep, (cwd) => getBuiltin(cwd, 'grep'), { renderCall: renderGrepCall, renderResult: renderGrepResult }) },
  { optIn: 'find', register: (pi, template) => registerOverride(pi, template.find, (cwd) => getBuiltin(cwd, 'find'), { renderCall: renderFindCall, renderResult: renderFindResult }) },
  { optIn: 'ls', register: (pi, template) => registerOverride(pi, template.ls, (cwd) => getBuiltin(cwd, 'ls'), { renderCall: renderLsCall, renderResult: renderLsResult }) },
];

function registerOverride<TParams extends TSchema, TDetails, TState>(
  pi: ExtensionAPI,
  definition: ToolDefinition<TParams, TDetails, TState>,
  load: (cwd: string) => ToolDefinition<TParams, TDetails, TState>,
  renderers: ToolRenderers,
): void {
  pi.registerTool({
    ...definition,
    renderShell: 'self',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return load(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall: renderers.renderCall,
    renderResult: renderers.renderResult,
  });
}

export function registerToolRenderers(pi: ExtensionAPI): void {
  const template = getBuiltins(process.cwd());
  const overrides = parseToolOverrides(process.env[TOOL_OVERRIDES_ENV]);
  for (const registration of TOOL_REGISTRATIONS) {
    if (registration.optIn !== undefined && !overrides.has(registration.optIn)) continue;
    registration.register(pi, template);
  }
}
