import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { TaskParameters } from './worker-records.ts';
import { WorkerRuntime } from './worker-runtime.ts';

export { restoreTaskRecords, taskSummary } from './worker-records.ts';

export function registerWorkers(pi: ExtensionAPI): void {
  const runtime = new WorkerRuntime(pi);
  runtime.registerLifecycle();
  pi.registerTool({
    name: 'Task', label: 'Task', description: 'Start or resume a Pi subagent. Background runs return an ID and deliver completion. Cloud execution is unavailable. Readonly limits tools; it is not an OS sandbox. Models must resolve to configured Pi providers.',
    parameters: TaskParameters,
    executionMode: 'parallel',
    execute: (id, params, signal, _update, ctx) => runtime.start(id, params, signal, ctx),
  });
  pi.registerTool({
    name: 'TaskOutput', label: 'Task output', description: 'Read task status and output. block waits for completion.',
    parameters: Type.Object({ task_id: Type.String(), block: Type.Optional(Type.Boolean()) }),
    executionMode: 'parallel',
    execute: (_id, params, signal) => runtime.output(params.task_id, params.block, signal),
  });
  pi.registerTool({
    name: 'TaskStop', label: 'Stop task', description: 'Abort a running child task.',
    parameters: Type.Object({ task_id: Type.String() }),
    executionMode: 'parallel',
    execute: (_id, params) => runtime.stop(params.task_id),
  });
  pi.registerTool({
    name: 'TaskMessage', label: 'Message task', description: 'Queue a message to a running child. Resume completed children using Task.resume.',
    parameters: Type.Object({ task_id: Type.String(), message: Type.String(), mode: Type.Optional(Type.Union([Type.Literal('steer'), Type.Literal('followUp')])) }),
    executionMode: 'parallel',
    execute: (_id, params) => runtime.message(params.task_id, params.message, params.mode),
  });
}
