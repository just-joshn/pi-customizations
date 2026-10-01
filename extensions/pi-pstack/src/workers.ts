import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { registerTaskPanel } from './subagents/task-panel.ts';
import { registerAgentTools } from './subagents/tools.ts';
import { TaskParameters, TaskRecordSchema } from './worker-records.ts';
import { type TaskToolDetails, WorkerRuntime } from './worker-runtime.ts';

export { restoreTaskRecords, taskSummary } from './worker-records.ts';

function registerTaskTool(pi: ExtensionAPI, runtime: WorkerRuntime): void {
  pi.registerTool<typeof TaskParameters, TaskToolDetails>({
    name: 'Task',
    label: 'Task',
    description: 'Start or resume a Pi subagent. Background runs return an ID and deliver completion. Cloud execution is unavailable. Readonly limits tools; it is not an OS sandbox. Models must resolve to configured Pi providers.',
    promptSnippet: 'Start or resume a local Pi subagent; background runs return a task ID',
    promptGuidelines: [
      'Task, TaskOutput, TaskMessage, TaskStop implement local delegation. Use exact available provider/model IDs, optionally :thinking. auto and inherit-parent inherit the parent. Unavailable Cursor slugs fail with available choices. Follow the source fallback policy and report any model change.',
      'Cloud Task execution is unavailable. Never silently replace a required cloud task with local execution. Readonly workers have restricted tools, not an OS sandbox. Agent-mode workers use installed Pi extensions; their tool availability depends on those extensions.',
      'Task also supports the bundled ci-watcher and thermo-nuclear-code-quality-review personas. ci-watcher inherits the parent model unless the caller supplies a configured Pi model, matching observed Cursor plugin behavior. No model is silently substituted. The kit references Cursor built-in shell and explore personas whose contracts are not published here; these remain unsupported. Collect the required diff and file contents with available tools before invoking the thermo review persona.',
    ],
    parameters: TaskParameters,
    outputSchema: TaskRecordSchema,
    exposure: 'direct',
    annotations: { openWorldHint: true },
    executionMode: 'parallel',
    execute: (id, params, signal, onUpdate, ctx) => runtime.start(id, params, signal, ctx, onUpdate),
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
  const stopParameters = Type.Object({ task_id: Type.String() });
  pi.registerTool<typeof stopParameters, Awaited<ReturnType<WorkerRuntime['stop']>>['details']>({
    name: 'TaskStop',
    label: 'Stop task',
    description: 'Abort a running child task by ID or name. Unknown tasks return a failure result.',
    promptSnippet: 'Abort a running subagent',
    parameters: stopParameters,
    outputSchema: Type.Union([
      Type.Intersect([TaskRecordSchema, Type.Object({ message: Type.String(), task_id: Type.String(), task_type: Type.Literal('local_agent'), command: Type.String() })]),
      Type.Object({ status: Type.Literal('failed'), task_id: Type.String(), message: Type.String() }),
    ]),
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
  registerAgentTools(pi, runtime);
  registerTaskPanel(pi, runtime);
}
