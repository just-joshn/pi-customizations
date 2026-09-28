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
    promptSnippet: 'Start or resume a local Pi subagent; background runs return a task ID',
    promptGuidelines: [
      'Task, TaskOutput, TaskMessage, TaskStop implement local delegation. Use exact available provider/model IDs, optionally :thinking. auto and inherit-parent inherit the parent. Unavailable Reference slugs fail with available choices. Follow the source fallback policy and report any model change.',
      'Cloud Task execution is unavailable. Never silently replace a required cloud task with local execution. Readonly workers have restricted tools, not an OS sandbox. Agent-mode workers use installed Pi extensions; their tool availability depends on those extensions.',
      'Task also supports the bundled ci-watcher and thermo-nuclear-code-quality-review personas. ci-watcher inherits the parent model unless the caller supplies a configured Pi model, matching observed Reference plugin behavior. No model is silently substituted. The kit references Reference built-in shell and explore personas whose contracts are not published here; these remain unsupported. Collect the required diff and file contents with available tools before invoking the thermo review persona.',
    ],
    parameters: TaskParameters,
    executionMode: 'parallel',
    execute: (id, params, signal, _update, ctx) => runtime.start(id, params, signal, ctx),
  });
  pi.registerTool({
    name: 'TaskOutput', label: 'Task output', description: 'Read task status and output. block waits for completion.',
    promptSnippet: 'Read a subagent\'s status and output, optionally waiting for it to finish',
    parameters: Type.Object({ task_id: Type.String(), block: Type.Optional(Type.Boolean()) }),
    executionMode: 'parallel',
    execute: (_id, params, signal) => runtime.output(params.task_id, params.block, signal),
  });
  pi.registerTool({
    name: 'TaskStop', label: 'Stop task', description: 'Abort a running child task.',
    promptSnippet: 'Abort a running subagent',
    parameters: Type.Object({ task_id: Type.String() }),
    executionMode: 'parallel',
    execute: (_id, params) => runtime.stop(params.task_id),
  });
  pi.registerTool({
    name: 'TaskMessage', label: 'Message task', description: 'Queue a message to a running child. Resume completed children using Task.resume.',
    promptSnippet: 'Queue steering or follow-up input for a running subagent',
    parameters: Type.Object({ task_id: Type.String(), message: Type.String(), mode: Type.Optional(Type.Union([Type.Literal('steer'), Type.Literal('followUp')])) }),
    executionMode: 'parallel',
    execute: (_id, params) => runtime.message(params.task_id, params.message, params.mode),
  });
}
