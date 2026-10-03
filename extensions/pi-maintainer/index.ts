/**
 * pi-maintainer: automated lint and test repair.
 *
 * After the model edits files, each edited file is checked (tree-sitter scan,
 * Python compile plus fatal-only flake8, or a configured command), failures
 * are shown to the user, and on confirmation the failure text is sent back as
 * the next user turn, capped at three reflections per user message.
 *
 * This file is the registration boundary only. The session state and the flows
 * live in src/session.ts.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MaintainerSession } from './src/session.ts';

export default function maintainerExtension(pi: ExtensionAPI): void {
  registerFlags(pi);
  const session = new MaintainerSession(pi);
  registerLifecycleEvents(pi, session);
  registerMaintainerCommands(pi, session);
}

function registerFlags(pi: ExtensionAPI): void {
  pi.registerFlag('auto-lint', { description: 'Lint every edited file after each model edit', type: 'boolean', default: true });
  pi.registerFlag('no-auto-lint', { description: 'Disable automatic linting of edited files', type: 'boolean', default: false });
  pi.registerFlag('lint-cmd', { description: 'Lint command per language as "lang: cmd" (newline-separated entries); no prefix sets the global command', type: 'string', default: '' });
  pi.registerFlag('lint', { description: 'One-shot lint and fix of the dirty files, then exit', type: 'boolean', default: false });
  pi.registerFlag('auto-test', { description: 'Run the test command after each edit (requires --test-cmd)', type: 'boolean', default: false });
  pi.registerFlag('no-auto-test', { description: 'Disable automatic testing after edits', type: 'boolean', default: false });
  pi.registerFlag('test-cmd', { description: 'Shell command whose non-zero exit means test failure', type: 'string', default: '' });
  pi.registerFlag('test', { description: 'One-shot test run, then exit. Needs --test-cmd', type: 'boolean', default: false });
  pi.registerFlag('yes-always', { description: 'Answer yes to repair confirmations automatically', type: 'boolean', default: false });
}

function registerLifecycleEvents(pi: ExtensionAPI, session: MaintainerSession): void {
  pi.on('session_start', (event, ctx) => session.onSessionStart(event, ctx));
  pi.on('before_agent_start', (event) => session.onBeforeAgentStart(event));
  pi.on('turn_start', () => session.onTurnStart());
  pi.on('tool_call', (event, ctx) => session.onToolCall(event, ctx));
  pi.on('tool_result', (event) => session.onToolResult(event));
  pi.on('turn_end', (event, ctx) => session.onTurnEnd(event, ctx));
  pi.on('agent_settled', () => session.onAgentSettled());
}

function registerMaintainerCommands(pi: ExtensionAPI, session: MaintainerSession): void {
  pi.registerCommand('lint', {
    description: 'Lint and fix in-chat files or all dirty files if none in chat',
    handler: (_args, ctx) => session.onLintCommand(ctx),
  });
  pi.registerCommand('test', {
    description: 'Run a shell command and add the output to the chat on non-zero exit code',
    handler: (args, ctx) => session.onTestCommand(args, ctx),
  });
  pi.registerCommand('run', {
    description: 'Run a shell command and optionally add the output to the chat (alias: !)',
    handler: (args, ctx) => session.onRunCommand(args, ctx),
  });
}
