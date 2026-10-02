import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type { WorkflowRuntime } from './runtime.ts';
import { publicWorkflow } from './runtime.ts';

const RunInput = Type.Object({ name: Type.String({ description: 'The workflow name to run.' }), arguments: Type.Optional(Type.Unknown({ description: 'Arguments matching the workflow declared schema.' })) }, { additionalProperties: false });
const ManageInput = Type.Object({ action: Type.Union([Type.Literal('list'), Type.Literal('cancel'), Type.Literal('pause'), Type.Literal('resume')]), run_id: Type.Optional(Type.String()) }, { additionalProperties: false });
const ReadInput = Type.Object({ run_id: Type.String() }, { additionalProperties: false });
const RunDetails = Type.Object({ run: Type.Unknown() });
type Ctx = Parameters<ToolDefinition['execute']>[4];

function runtimeTool(name: string, description: string, parameters: typeof RunInput | typeof ManageInput | typeof ReadInput, run: (params: Record<string, unknown>, ctx: Ctx) => Promise<unknown>): ToolDefinition {
  return {
    name,
    label: name,
    description,
    promptSnippet: description,
    parameters,
    outputSchema: RunDetails,
    exposure: 'direct',
    executionMode: 'parallel',
    annotations: { openWorldHint: false },
    execute: async (_id, params, _signal, _update, ctx) => {
      if (!Check(parameters, params)) throw new Error(`Invalid ${name} input.`);
      const result = await run(params as Record<string, unknown>, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { run: result } };
    },
  };
}

export function workflowTools(runtime: WorkflowRuntime): readonly ToolDefinition[] {
  return [
    runtimeTool('run_dynamic_workflow', 'Start a registered workflow after the user approves it. Pre-checks cover the argument shape, name conflicts and the active-run cap.', RunInput, (params, ctx) =>
      runtime.start(params.name as string, params.arguments, ctx, 'tool'),
    ),
    runtimeTool('dynamic_workflows_manage', 'List workflow runs, or cancel, pause or resume one by run id.', ManageInput, async (params, ctx) => {
      if (params.action === 'list') return runtime.runs().map(publicWorkflow);
      const id = String(params.run_id ?? '');
      if (!id) throw new Error(`dynamic_workflows_manage ${String(params.action)} needs a run_id.`);
      if (params.action === 'cancel') return publicWorkflow(await runtime.cancel(id));
      if (params.action === 'pause') return publicWorkflow(await runtime.pause(id));
      return publicWorkflow(await runtime.resume(id, ctx));
    }),
    runtimeTool('read_workflow_run', 'Read one workflow run with its status, consumption, phases and journal.', ReadInput, async (params) => {
      const run = runtime.get(String(params.run_id));
      if (!run) throw new Error(`Unknown workflow run: ${String(params.run_id)}`);
      return { ...publicWorkflow(run), journal: runtime.journal(String(params.run_id)) };
    }),
  ];
}
