import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';

const Status = Type.Union([Type.Literal('running'), Type.Literal('idle'), Type.Literal('completed'), Type.Literal('failed'), Type.Literal('cancelled')]);
const Mode = Type.Union([Type.Literal('sync'), Type.Literal('background')]);
const Source = Type.Union([
  Type.Literal('explicit_override'),
  Type.Literal('configured_required'),
  Type.Literal('configured_preference'),
  Type.Literal('complementary_default'),
  Type.Literal('session_inheritance'),
  Type.Literal('agent_definition_default'),
  Type.Literal('runtime_policy'),
]);
const TaskSource = Type.Union([Type.Literal('task_argument'), Type.Literal('subagent_configuration'), Type.Literal('custom_agent_definition'), Type.Literal('unset')]);
const Count = Type.Number({ minimum: 0 });
const UsageSchema = Type.Object({
  input: Count,
  output: Count,
  cacheRead: Count,
  cacheWrite: Count,
  totalTokens: Count,
  cost: Type.Object({ input: Count, output: Count, cacheRead: Count, cacheWrite: Count, total: Count }),
});

export const agentEntryType = 'reference-assistant-agent';

export const AgentNodeSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  registryId: Type.String({ minLength: 1 }),
  parentRegistryId: Type.Optional(Type.String()),
  toolCallId: Type.String(),
  agentType: Type.String(),
  agentDisplayName: Type.String(),
  agentDescription: Type.String(),
  description: Type.String(),
  prompt: Type.String(),
  mode: Mode,
  status: Status,
  depth: Type.Integer({ minimum: 1 }),
  turns: Type.Array(Type.String()),
  startedAt: Type.Number({ minimum: 0 }),
  endedAt: Type.Optional(Type.Number({ minimum: 0 })),
  model: Type.String(),
  modelSource: Source,
  taskModelSource: TaskSource,
  contextTier: Type.String(),
  effort: Type.Optional(Type.String()),
  firstDispatchedModel: Type.String(),
  configuredModel: Type.Optional(Type.String()),
  requestedModel: Type.Optional(Type.String()),
  overrideReason: Type.Optional(Type.String()),
  totalToolCalls: Type.Integer({ minimum: 0 }),
  totalTokens: Type.Number({ minimum: 0 }),
  usage: Type.Optional(UsageSchema),
  error: Type.Optional(Type.String()),
  cancelled: Type.Optional(Type.Literal(true)),
  retired: Type.Optional(Type.Literal(true)),
  sessionFile: Type.String(),
  cwd: Type.String(),
  workflowRunId: Type.Optional(Type.String()),
  intent: Type.Optional(Type.String()),
});

export type AgentNode = Static<typeof AgentNodeSchema>;
export type Branch = ReadonlyArray<{ type: string; customType?: string; data?: unknown }>;

export function restoreNodes(entries: Branch, entryType: string = agentEntryType): ReadonlyMap<string, AgentNode> {
  const nodes = entries.flatMap((entry) => (entry.type === 'custom' && entry.customType === entryType && Check(AgentNodeSchema, entry.data) ? [[entry.data.id, structuredClone(entry.data)] as const] : []));
  return new Map(nodes);
}

export type RepairOutcome = Readonly<{ nodes: ReadonlyMap<string, AgentNode>; closed: readonly string[]; dangling: readonly string[] }>;

export function repairInterrupted(nodes: ReadonlyMap<string, AgentNode>, now: number): RepairOutcome {
  const closed: string[] = [];
  const dangling: string[] = [];
  const repaired = [...nodes].map(([id, node]): [string, AgentNode] => {
    if (node.status === 'running') {
      closed.push(id);
      return [id, { ...node, status: 'cancelled', cancelled: true, endedAt: now, error: 'Parent session ended before the agent finished.' }];
    }
    if (node.status === 'idle' && node.retired !== true) {
      dangling.push(id);
      return [id, { ...node, retired: true }];
    }
    return [id, node];
  });
  return { nodes: new Map(repaired), closed, dangling };
}
