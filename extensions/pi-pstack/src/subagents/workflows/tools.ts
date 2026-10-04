import { type AgentToolResult, defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { publicWorkflow, type WorkflowRuntime } from './runtime.ts';

const RunInput = Type.Object({ name: Type.String({ description: 'The workflow name to run.' }), arguments: Type.Optional(Type.Unknown({ description: 'Arguments matching the workflow declared schema.' })) }, { additionalProperties: false });
const ManageInput = Type.Object({ action: Type.Union([Type.Literal('list'), Type.Literal('cancel'), Type.Literal('pause'), Type.Literal('resume')]), run_id: Type.Optional(Type.String()) }, { additionalProperties: false });
const ReadInput = Type.Object({ run_id: Type.String() }, { additionalProperties: false });
const RunDetails = Type.Object({ run: Type.Unknown() });
type Details = Static<typeof RunDetails>;
type Json = NonNullable<AgentToolResult['structuredContent']>;

function resultOf(value: unknown): AgentToolResult<Details> {
  const text = JSON.stringify(value) ?? 'null';
  const run: Json = JSON.parse(text);
  return { content: [{ type: 'text', text }], details: { run }, structuredContent: { run } };
}

const shared = {
  outputSchema: RunDetails,
  exposure: 'direct',
  executionMode: 'sequential',
  annotations: { openWorldHint: false },
  namespace: {
    name: 'pstack_workflows',
    description: 'Approved dynamic workflow execution and inspection.',
    instructions: 'Start registered workflows only after approval. Read a run by its id. Manage existing runs to cancel, pause, or resume them without starting a duplicate.',
  },
} as const;

export function workflowTools(runtime: WorkflowRuntime): readonly ToolDefinition[] {
  const start = defineTool({
    ...shared,
    exposure: 'model-only',
    annotations: { openWorldHint: true },
    name: 'run_dynamic_workflow',
    label: 'run_dynamic_workflow',
    description: 'Start a registered workflow after the user approves it. Pre-checks cover the argument shape, name conflicts and the active-run cap.',
    promptSnippet: 'Start a registered dynamic workflow',
    parameters: RunInput,
    execute: async (_id, params, _signal, _update, ctx) => resultOf(publicWorkflow(await runtime.start(params.name, params.arguments, ctx, 'tool'))),
  });
  const manage = defineTool({
    ...shared,
    exposure: 'model-only',
    annotations: { openWorldHint: true },
    name: 'dynamic_workflows_manage',
    label: 'dynamic_workflows_manage',
    description: 'List workflow runs, or cancel, pause or resume one by run id.',
    promptSnippet: 'List, cancel, pause or resume dynamic workflow runs',
    parameters: ManageInput,
    execute: async (_id, params, _signal, _update, ctx) => {
      if (params.action === 'list') return resultOf(runtime.runs().map(publicWorkflow));
      if (!params.run_id) throw new Error(`dynamic_workflows_manage ${params.action} needs a run_id.`);
      if (params.action === 'cancel') return resultOf(publicWorkflow(await runtime.cancel(params.run_id)));
      if (params.action === 'pause') return resultOf(publicWorkflow(await runtime.pause(params.run_id)));
      return resultOf(publicWorkflow(await runtime.resume(params.run_id, ctx)));
    },
  });
  const read = defineTool({
    ...shared,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    executionMode: 'parallel',
    name: 'read_workflow_run',
    label: 'read_workflow_run',
    description: 'Read one workflow run with its status, consumption, phases and journal.',
    promptSnippet: 'Read a dynamic workflow run',
    parameters: ReadInput,
    execute: async (_id, params) => {
      const run = runtime.get(params.run_id);
      if (!run) throw new Error(`Unknown workflow run: ${params.run_id}`);
      return resultOf({ ...publicWorkflow(run), journal: runtime.journal(params.run_id) });
    },
  });
  return [start, manage, read];
}
