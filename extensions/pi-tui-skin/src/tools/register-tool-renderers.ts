import type { ExtensionAPI, ToolRenderers } from '@earendil-works/pi-coding-agent';
import { renderEditCall, renderEditResult } from './render-edit.ts';
import { renderFindCall, renderFindResult } from './render-find.ts';
import { renderGrepCall, renderGrepResult } from './render-grep.ts';
import { renderLsCall, renderLsResult } from './render-ls.ts';
import { renderReadCall, renderReadResult } from './render-read.ts';
import { renderBashCall, renderBashResult, renderPowerShellCall, renderPowerShellResult } from './render-shell.ts';
import { renderWriteCall, renderWriteResult } from './render-write.ts';

const renderers: ReadonlyMap<string, ToolRenderers> = new Map([
  ['read', { renderShell: 'self', renderCall: renderReadCall, renderResult: renderReadResult }],
  ['bash', { renderShell: 'self', renderCall: renderBashCall, renderResult: renderBashResult }],
  ['powershell', { renderShell: 'self', renderCall: renderPowerShellCall, renderResult: renderPowerShellResult }],
  ['edit', { renderShell: 'self', renderCall: renderEditCall, renderResult: renderEditResult }],
  ['write', { renderShell: 'self', renderCall: renderWriteCall, renderResult: renderWriteResult }],
  ['grep', { renderShell: 'self', renderCall: renderGrepCall, renderResult: renderGrepResult }],
  ['find', { renderShell: 'self', renderCall: renderFindCall, renderResult: renderFindResult }],
  ['ls', { renderShell: 'self', renderCall: renderLsCall, renderResult: renderLsResult }],
]);

export function registerToolRenderers(pi: ExtensionAPI): void {
  pi.registerToolRenderer((name, next) => renderers.get(name) ?? next());
}
