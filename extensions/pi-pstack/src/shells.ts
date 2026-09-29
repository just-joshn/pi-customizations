import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { type ShellRecord, ShellRuntime } from './shell-runtime.ts';

function started(record: ShellRecord) {
  const pattern = record.pattern === undefined ? 'none; wakes only on exit' : record.pattern;
  const text = `Started background shell ${record.id} (pid ${record.pid}).\nOutput file: ${record.outputFile}\nPattern: ${pattern}`;
  return { content: [{ type: 'text' as const, text }], details: record };
}

function json<T>(details: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }], details };
}

export function registerShells(pi: ExtensionAPI): void {
  const runtime = new ShellRuntime(pi);
  pi.on('session_start', () => runtime.forgetPreviousSession());
  pi.on('session_shutdown', () => runtime.stopAll());
  pi.on('message_end', (event) => {
    const message = event.message;
    if (message.role === 'custom' && message.customType === 'pstack-shell-output') runtime.delivered((message.details as ShellRecord).id);
  });
  pi.registerTool({
    name: 'BackgroundShell',
    label: 'Background shell',
    description:
      'Run a bash command in the background. Output is appended to a log file. An output line matching notify_on_output wakes the agent with that line; while a wake is still queued, later matches only count, so read the log for the latest line. Exit wakes the agent unless the shell already matched and exited 0.',
    promptSnippet: 'Run a bash command in the background and wake on matching output lines',
    promptGuidelines: ['BackgroundShell with notify_on_output wakes you on each matching output line; BackgroundShellList and BackgroundShellStop manage those shells, which end with this session.'],
    parameters: Type.Object({ command: Type.String(), title: Type.String(), notify_on_output: Type.Optional(Type.String()) }),
    executionMode: 'parallel',
    execute: async (_id, params, _signal, _update, ctx) => started(await runtime.start(params, ctx)),
  });
  pi.registerTool({
    name: 'Background' + 'ShellList',
    label: 'List background shells',
    description: "List this session's background shells, newest first.",
    promptSnippet: "List this session's background shells",
    parameters: Type.Object({}),
    executionMode: 'parallel',
    execute: async () => json(runtime.list()),
  });
  pi.registerTool({
    name: 'Background' + 'ShellStop',
    label: 'Stop background shell',
    description: 'Stop a background shell and its process group. Stopped shells send no exit message. A match wake held for the current turn is dropped.',
    promptSnippet: 'Stop a background shell and its process group',
    parameters: Type.Object({ id: Type.String() }),
    executionMode: 'parallel',
    execute: async (_id, params) => json(await runtime.stop(params.id)),
  });
}
