import { existsSync, mkdirSync, realpathSync } from 'node:fs';

import { type ExtensionAPI, type ExtensionFactory, isToolCallEventType, type ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { gitSafetyPrelude, hardenReadOnlyGitCommand } from './readonly-git.ts';
import { hasDangerousGitOption, isSafeReadOnlyCommand, matchesNormalizedDenial } from './readonly-policy.ts';
import { DEV_NULL, hasUnquotedLineContinuation, hasUnquotedShellExpansion, shellQuote } from './readonly-shell.ts';
import { READONLY_SUBAGENT_ERROR } from './types.ts';

export { isSafeReadOnlyCommand };

export const READONLY_BLOCKED_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'delete', 'powershell']);
const MCP_TOOL_PREFIX = 'mcp__';
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const SANDBOX_SHELL = '/bin/ksh';
const READONLY_TEMP_ROOT = '/tmp/pi-subagents-readonly';

function readonlyProfileAssignment(): string {
  return `_pi_profile="(version 1)(allow default)(deny file-write*)(allow file-write* (literal \\"${DEV_NULL}\\"))(allow file-write* (subpath \\"$_pi_tmp\\"))"`;
}

function readonlySandboxInvocation(command: string, tempRoot: string): string {
  const template = shellQuote(`${tempRoot}/tmp.XXXXXX`);
  const quoted = shellQuote(command);
  const run = `TMPDIR="$_pi_tmp" ${SANDBOX_EXEC} -p "$_pi_profile" ${SANDBOX_SHELL} -c ${quoted}`;
  return `${gitSafetyPrelude()}_pi_tmp=$(mktemp -d ${template}) || exit 1; ${readonlyProfileAssignment()}; _pi_status=0; ${run} || _pi_status=$?; rm -rf "$_pi_tmp"; exit $_pi_status`;
}

function hasPagerCommand(command: string): boolean {
  return /(?:^|[|;&])\s*(?:less|more|ag|ack)\b/.test(command);
}

function blocksExternalViewer(command: string): boolean {
  return hasPagerCommand(command) || hasUnquotedLineContinuation(command) || hasUnquotedShellExpansion(command) || hasDangerousGitOption(command) || matchesNormalizedDenial(command);
}

function blockedReadonlyCommand(): string {
  return `printf '%s\\n' ${shellQuote('read-only command is blocked')} >&2; exit 1`;
}

/** Wraps a command in a macOS sandbox that denies filesystem writes except /dev/null and that command's temp directory. Git helper neutralization runs on every platform. */
export function sandboxReadOnlyCommand(command: string): string {
  if (blocksExternalViewer(command)) {
    return blockedReadonlyCommand();
  }
  const hardened = hardenReadOnlyGitCommand(command);
  if (process.platform === 'darwin' && existsSync(SANDBOX_EXEC)) {
    mkdirSync(READONLY_TEMP_ROOT, { recursive: true });
    return readonlySandboxInvocation(hardened, realpathSync(READONLY_TEMP_ROOT));
  }
  return `${gitSafetyPrelude()}${hardened}`;
}

export function evaluateReadonlySubagentGuard(event: ToolCallEvent): { block: true; reason: string } | undefined {
  if (READONLY_BLOCKED_TOOLS.has(event.toolName) || event.toolName.startsWith(MCP_TOOL_PREFIX)) {
    return { block: true, reason: READONLY_SUBAGENT_ERROR };
  }
  if (!isToolCallEventType('bash', event)) {
    return undefined;
  }
  if (!isSafeReadOnlyCommand(event.input.command)) {
    return { block: true, reason: READONLY_SUBAGENT_ERROR };
  }
  event.input.command = sandboxReadOnlyCommand(event.input.command);
  return undefined;
}

export function createReadonlySubagentExtension(): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on('tool_call', async (event) => evaluateReadonlySubagentGuard(event));
  };
}
