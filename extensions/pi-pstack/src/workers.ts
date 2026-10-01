import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { discoverTasks, selectTask } from './task-discovery.ts';
import { TaskParameters, TaskRecordSchema, taskSummary } from './worker-records.ts';
import { WorkerRuntime } from './worker-runtime.ts';

export { restoreTaskRecords, taskSummary } from './worker-records.ts';

function registerTaskTool(pi: ExtensionAPI, runtime: WorkerRuntime): void {
  pi.registerTool({
    name: 'Task',
    label: 'Task',
    description:
      'Start or resume a Pi subagent. Background runs return an ID and deliver completion. environment cloud requires a configured isolated VM executor. Readonly limits tools; it is not an OS sandbox. Models must resolve to configured Pi providers.',
    promptSnippet: 'Start or resume a local Pi subagent; background runs return a task ID',
    promptGuidelines: [
      'Task, TaskOutput, TaskMessage, TaskStop implement Pi delegation. Use exact available provider/model IDs, optionally :thinking. auto and inherit-parent inherit the parent. A slug with no configured provider fails and lists the available choices. Follow the source fallback policy and report any model change.',
      'environment cloud starts a detached Pi root in a configured separate VM at cloud_base_branch (local branch, else origin/<branch>) or the committed parent HEAD. remote_executor selects a configured VM; no local fallback is permitted. Each VM admits one active job. Placement receipts identify the actual machine, virtualization, boot, checkout SHA and session. Resume preserves that placement. Uncommitted parent changes are not in it, so commit or push what the worker needs. The worktree stays after the task ends, so its branch and commits survive. environment local, the default, shares the parent checkout. Readonly workers have restricted tools, not an OS sandbox. Remote workers use guest-installed Pi extensions and guest credentials.',
      'Task also supports the bundled ci-watcher and thermo-nuclear-code-quality-review personas. ci-watcher inherits the parent model unless the caller supplies a configured Pi model, matching observed Cursor plugin behavior. No model is silently substituted. The shell and explore personas are native. Collect the required diff and file contents with available tools before invoking the thermo review persona.',
    ],
    parameters: TaskParameters,
    outputSchema: TaskRecordSchema,
    exposure: 'direct',
    annotations: { openWorldHint: true },
    executionMode: 'parallel',
    execute: (id, params, signal, _update, ctx) => runtime.start(id, params, signal, ctx),
  });
}

function registerControlTools(pi: ExtensionAPI, runtime: WorkerRuntime): void {
  pi.registerTool({
    name: 'TaskOutput',
    label: 'Task output',
    description: 'Read task status and output. block waits for completion.',
    promptSnippet: "Read a subagent's status and output, optionally waiting for it to finish",
    parameters: Type.Object({ task_id: Type.String(), block: Type.Optional(Type.Boolean()) }),
    outputSchema: TaskRecordSchema,
    exposure: 'direct',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    executionMode: 'parallel',
    execute: (_id, params, signal) => runtime.output(params.task_id, params.block, signal),
  });
  pi.registerTool({
    name: 'TaskStop',
    label: 'Stop task',
    description: 'Abort a running child task.',
    promptSnippet: 'Abort a running subagent',
    parameters: Type.Object({ task_id: Type.String() }),
    outputSchema: TaskRecordSchema,
    exposure: 'direct',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    executionMode: 'parallel',
    execute: (_id, params) => runtime.stop(params.task_id),
  });
  pi.registerTool({
    name: 'TaskMessage',
    label: 'Message task',
    description: 'Queue a message to a running child. Resume completed children using Task.resume.',
    promptSnippet: 'Queue steering or follow-up input for a running subagent',
    parameters: Type.Object({ task_id: Type.String(), message: Type.String(), mode: Type.Optional(Type.String({ enum: ['steer', 'followUp'] })) }),
    outputSchema: Type.Object({ task_id: Type.String() }),
    exposure: 'direct',
    annotations: { openWorldHint: false },
    executionMode: 'parallel',
    execute: (_id, params) => runtime.message(params.task_id, params.message, params.mode as 'steer' | 'followUp' | undefined),
  });
}

function registerTaskList(pi: ExtensionAPI, runtime: WorkerRuntime): void {
  pi.registerTool({
    name: 'TaskList',
    label: 'List tasks',
    description: 'List tasks recorded in the current Pi parent branch, with durable session and remote placement pointers.',
    parameters: Type.Object({ repository: Type.Optional(Type.Boolean()), branch: Type.Optional(Type.String({ minLength: 1 })) }),
    outputSchema: Type.Object({ tasks: Type.Array(TaskRecordSchema) }),
    exposure: 'direct',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    execute: async (_id, params, _signal, _update, ctx) => {
      if (!params.repository) {
        if (params.branch) throw new Error('Branch discovery requires repository: true.');
        return runtime.list();
      }
      const receipts = await discoverTasks(ctx.cwd, params.branch);
      return { content: [{ type: 'text', text: JSON.stringify({ tasks: receipts.map((item) => ({ ...JSON.parse(taskSummary(item.record)), branch: item.branch, observed: 'launch receipt; TaskAttach reconciles live status' })) }) }], details: { tasks: receipts.map((item) => item.record) } };
    },
  });
}

function registerTaskAttach(pi: ExtensionAPI, runtime: WorkerRuntime): void {
  pi.registerTool({
    name: 'TaskAttach', label: 'Attach remote task',
    description: 'Explicitly attach one previously launched remote task in this repository by task_id or unambiguous branch. Reconciles status without sending a prompt.',
    parameters: Type.Object({ task_id: Type.Optional(Type.String({ minLength: 1 })), branch: Type.Optional(Type.String({ minLength: 1 })) }),
    outputSchema: TaskRecordSchema, exposure: 'direct', annotations: { openWorldHint: true },
    execute: async (_id, params, _signal, _update, ctx) => runtime.attach((await selectTask(ctx.cwd, params)).record, ctx),
  });
}

export function registerWorkers(pi: ExtensionAPI): void {
  const runtime = new WorkerRuntime(pi);
  runtime.registerLifecycle();
  registerTaskTool(pi, runtime);
  registerControlTools(pi, runtime);
  registerTaskList(pi, runtime);
  registerTaskAttach(pi, runtime);
}
