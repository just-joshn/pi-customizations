import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { TaskParameters, TaskRecordSchema } from './worker-records.ts';
import { WorkerRuntime } from './worker-runtime.ts';

export { restoreTaskRecords, taskSummary } from './worker-records.ts';

function registerTaskTool(pi: ExtensionAPI, runtime: WorkerRuntime): void {
  pi.registerTool({
    name: 'Task',
    label: 'Task',
    description: 'Start or resume a Pi subagent. Background runs return an ID and deliver completion. environment cloud runs in its own git worktree. Readonly limits tools; it is not an OS sandbox. Models must resolve to configured Pi providers.',
    promptSnippet: 'Start or resume a local Pi subagent; background runs return a task ID',
    promptGuidelines: [
      'Task, TaskOutput, TaskMessage, TaskStop implement local delegation. Use exact available provider/model IDs, optionally :thinking. auto and inherit-parent inherit the parent. A slug with no configured provider fails and lists the available choices. Follow the source fallback policy and report any model change.',
      'environment cloud gives the worker its own detached git worktree under the session directory at pstack-cloud/<task-id>, checked out at cloud_base_branch (local branch, else origin/<branch>) or the parent HEAD. Uncommitted parent changes are not in it, so commit or push what the worker needs. The worktree stays after the task ends, so its branch and commits survive. environment local, the default, shares the parent checkout. Readonly workers have restricted tools, not an OS sandbox. Agent-mode workers use installed Pi extensions.',
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

export function registerWorkers(pi: ExtensionAPI): void {
  const runtime = new WorkerRuntime(pi);
  runtime.registerLifecycle();
  registerTaskTool(pi, runtime);
  registerControlTools(pi, runtime);
}
