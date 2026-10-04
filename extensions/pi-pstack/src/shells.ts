import type { JsonValue } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { asShellHandoff, type ShellRole, shellHandoff, shellHandoffEvent, shellRole } from './shell-ownership.ts';
import { type ShellRecord, ShellRuntime, type ShellStatus, shellDirs } from './shell-runtime.ts';
import { stopPendingEvent } from './subagents/stop-pending.ts';

const ShellStatusSchema = Type.Union([
  Type.Object({ kind: Type.Literal('running') }),
  Type.Object({ kind: Type.Literal('exited'), code: Type.Union([Type.Number(), Type.Null()]), signal: Type.Union([Type.String(), Type.Null()]) }),
  Type.Object({ kind: Type.Literal('stopped') }),
]);

const ShellRecordSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  command: Type.String(),
  pid: Type.Number(),
  cwd: Type.String(),
  outputFile: Type.String(),
  pattern: Type.Optional(Type.String()),
  startedAt: Type.String(),
  status: ShellStatusSchema,
  matches: Type.Number(),
  backgroundEndsWithFinalResponse: Type.Optional(
    Type.Literal(true, {
      description: 'True when this background command is owned by a synchronous subagent and is therefore terminated when that agent gives its final response; absent when the command survives (main loop, async subagents)',
    }),
  ),
});

function started(record: ShellRecord) {
  const pattern = record.pattern === undefined ? 'none; wakes only on exit' : record.pattern;
  const text = `Started background shell ${record.id} (pid ${record.pid}).\nOutput file: ${record.outputFile}\nPattern: ${pattern}`;
  return { content: [{ type: 'text' as const, text }], details: record, structuredContent: record as unknown as JsonValue };
}

function json<T>(details: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }], details, structuredContent: details as unknown as JsonValue };
}

export type ShellTask = Readonly<{ id: string; status: ShellStatus; command: string }>;

const shellRuntimes = new WeakMap<ExtensionAPI, ShellRuntime>();

/** The shell tasks owned by this extension instance, for the /tasks listing. */
export function shellTasks(pi: ExtensionAPI): readonly ShellTask[] {
  return (shellRuntimes.get(pi)?.list() ?? []).map((shell) => ({ id: shell.id, status: shell.status, command: shell.command }));
}

function handOff(pi: ExtensionAPI, runtime: ShellRuntime): boolean {
  if (!runtime.running()) return false;
  const handoff = shellHandoff(runtime);
  pi.events.emit(shellHandoffEvent, handoff);
  return handoff.claimed();
}

function registerOwnership(pi: ExtensionAPI, runtime: ShellRuntime): void {
  let role: ShellRole = { child: false, endsWithFinalResponse: false };
  let stopRequested = false;
  pi.on('session_start', (_event, ctx) => {
    runtime.forgetPreviousSession();
    runtime.useContext(ctx);
    role = shellRole(ctx.sessionManager.getBranch());
    runtime.markEndsWithFinalResponse(role.endsWithFinalResponse);
  });
  pi.events.on(stopPendingEvent, () => {
    stopRequested = true;
  });
  pi.events.on(shellHandoffEvent, (payload) => {
    const handoff = asShellHandoff(payload);
    if (handoff && handoff.shells !== runtime && handoff.claim()) runtime.adopt(handoff.shells);
  });
  pi.on('session_shutdown', async (_event, ctx) => {
    const survives = role.child && !role.endsWithFinalResponse && !stopRequested;
    if (survives && handOff(pi, runtime)) return;
    try {
      await runtime.stopAll();
    } finally {
      await shellDirs.removeAll(ctx.sessionManager);
    }
  });
}

const shellNamespace = {
  name: 'pstack_shells',
  description: 'Session-owned background shell processes.',
  instructions: 'Read the returned log path for complete output. Output notifications may be coalesced. Stop a shell to terminate its process group. These processes end with the owning session.',
} as const;

export function registerShells(pi: ExtensionAPI): void {
  const runtime = new ShellRuntime(pi);
  shellRuntimes.set(pi, runtime);
  registerOwnership(pi, runtime);
  pi.on('message_end', (event) => {
    if (event.message.role === 'custom' && event.message.customType === 'pstack-shell-output') runtime.delivered((event.message.details as ShellRecord).id);
  });
  pi.registerTool({
    name: 'BackgroundShell',
    namespace: shellNamespace,
    label: 'Background shell',
    description:
      'Run a bash command in the background. Output is appended to a log file. An output line matching notify_on_output wakes the agent with that line; while a wake is still queued, later matches only count, so read the log for the latest line. Exit wakes the agent unless the shell already matched and exited 0.',
    promptSnippet: 'Run a bash command in the background and wake on matching output lines',
    promptGuidelines: ['BackgroundShell with notify_on_output wakes you on each matching output line; BackgroundShellList and BackgroundShellStop manage those shells, which end with this session.'],
    parameters: Type.Object({ command: Type.String(), title: Type.String(), notify_on_output: Type.Optional(Type.String()) }),
    outputSchema: ShellRecordSchema,
    exposure: 'direct',
    annotations: { openWorldHint: true },
    executionMode: 'sequential',
    execute: async (_id, params, _signal, _update, ctx) => started(await runtime.start(params, ctx)),
  });
  pi.registerTool({
    name: 'Background' + 'ShellList',
    namespace: shellNamespace,
    label: 'List background shells',
    description: "List this session's background shells, newest first.",
    promptSnippet: "List this session's background shells",
    parameters: Type.Object({}),
    outputSchema: Type.Array(ShellRecordSchema),
    exposure: 'direct',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    executionMode: 'parallel',
    execute: async () => json(runtime.list()),
  });
  pi.registerTool({
    name: 'Background' + 'ShellStop',
    namespace: shellNamespace,
    label: 'Stop background shell',
    description: 'Stop a background shell and its process group. Stopped shells send no exit message. A match wake held for the current turn is dropped.',
    promptSnippet: 'Stop a background shell and its process group',
    parameters: Type.Object({ id: Type.String() }),
    outputSchema: ShellRecordSchema,
    exposure: 'direct',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    executionMode: 'sequential',
    execute: async (_id, params) => json(await runtime.stop(params.id)),
  });
}
