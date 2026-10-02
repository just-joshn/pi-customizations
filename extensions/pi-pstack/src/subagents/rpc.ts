import { randomUUID } from 'node:crypto';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, type TSchema, Type } from 'typebox';
import { Check } from 'typebox/value';
import type { AgentDefinition } from './agent-definition.ts';
import { type AgentNode, AgentNodeSchema } from './agent-node.ts';
import type { AgentSelection } from './agent-selection.ts';
import type { SubagentFactory } from './factory.ts';
import type { SubagentScheduler } from './scheduler.ts';
import { EffortSchema, PolicySchema, TierSchema } from './settings.ts';
import type { SettingsStore } from './settings-store.ts';
import type { TaskRegistry } from './task-registry.ts';
import type { WorkflowRuntime } from './workflows/runtime.ts';

export const rpcChannel = 'reference-assistant:rpc';
export const rpcResultChannel = 'reference-assistant:rpc-result';
export const noPromotableMessage = 'No running sync task to move to background.';

const Id = Type.Object({ id: Type.String({ minLength: 1 }) });
const StartAgent = Type.Object({ agentType: Type.String(), prompt: Type.String(), name: Type.String(), description: Type.Optional(Type.String()), model: Type.Optional(Type.String()) });
const Cancel = Type.Object({ id: Type.String({ minLength: 1 }), includeIdle: Type.Optional(Type.Boolean()) });
const SendMessage = Type.Object({ id: Type.String({ minLength: 1 }), message: Type.String() });
const Wait = Type.Object({ timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })) });
const Settings = Type.Object({
  agents: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Object({ model: Type.Optional(Type.String()), modelPolicy: Type.Optional(PolicySchema), effortLevel: Type.Optional(EffortSchema), contextTier: Type.Optional(TierSchema), autoInvoke: Type.Optional(Type.Boolean()) }),
    ),
  ),
  disabledSubagents: Type.Optional(Type.Array(Type.String())),
  contextManagementTools: Type.Optional(Type.Boolean()),
});
const Goal = Type.Object({ goal: Type.String({ minLength: 1 }) });
const Name = Type.Object({ name: Type.String({ minLength: 1 }) });
const SetPrompt = Type.Object({ name: Type.String({ minLength: 1 }), prompt: Type.String() });
const WorkflowStart = Type.Object({ name: Type.String({ minLength: 1 }), arguments: Type.Optional(Type.Unknown()) });
const WorkflowLog = Type.Object({ id: Type.String({ minLength: 1 }), message: Type.String() });
const WorkflowAgentCall = Type.Object({ id: Type.String({ minLength: 1 }), prompt: Type.String(), options: Type.Optional(Type.Unknown()) });
const JournalPut = Type.Object({ id: Type.String({ minLength: 1 }), key: Type.String({ minLength: 1 }), value: Type.Unknown() });
const Request = Type.Object({ id: Type.String(), method: Type.String(), params: Type.Optional(Type.Unknown()) });
const Update = Type.Object({ id: Type.String({ minLength: 1 }), fields: Type.Partial(Type.Omit(AgentNodeSchema, ['id', 'status']), { additionalProperties: false }) });

export function publicTask(node: AgentNode, taskStoreId?: string) {
  return {
    id: node.id,
    taskStoreId: taskStoreId ?? node.id, // The registry keys agent tasks by agent id.
    kind: 'agent' as const, // Pi owns shell and client tasks, so this surface only projects agent tasks.
    status: node.status,
    agentType: node.agentType,
    name: node.agentDisplayName,
    description: node.description,
    mode: node.mode,
    canPromoteToBackground: node.mode === 'sync' && node.status === 'running',
    startedAt: node.startedAt,
    ...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
    turns: node.turns.length,
    ...(node.parentRegistryId !== undefined ? { parentId: node.parentRegistryId } : {}),
  };
}

function parse<T extends TSchema>(method: string, schema: T, params: unknown): Static<T> {
  if (Check(schema, params)) return params;
  throw new Error(`Invalid ${method} parameters.`);
}

function promotableTask(scheduler: SubagentScheduler) {
  const node = scheduler.currentPromotable();
  return node ? publicTask(node) : null;
}

function registerTask(registry: TaskRegistry, method: string, params: unknown) {
  const node = parse(method, AgentNodeSchema, params);
  registry.register(node);
  return publicTask(node);
}

function updateTask(registry: TaskRegistry, method: string, params: unknown) {
  const input = parse(method, Update, params);
  return publicTask(registry.patch(input.id, input.fields));
}

const workflowSummary = (run: NonNullable<ReturnType<WorkflowRuntime['get']>>) => ({
  id: run.id,
  name: run.name,
  status: run.status,
  attempt: run.attempt,
  consumption: run.consumption,
  phases: run.phases,
  ...(run.checkpoint !== undefined ? { checkpoint: run.checkpoint } : {}),
  ...(run.failure !== undefined ? { failure: run.failure } : {}),
});

type Parts = Readonly<{
  factory: SubagentFactory;
  scheduler: SubagentScheduler;
  settings: SettingsStore;
  registry: TaskRegistry;
  selection: AgentSelection;
  workflows: () => WorkflowRuntime;
  context: () => ExtensionContext | undefined;
  toolNames: () => readonly string[];
  startFleet: (goal: string) => void;
  reload: () => void;
}>;

const agentSummary = (agent: AgentDefinition) => ({ name: agent.name, displayName: agent.displayName, description: agent.description, source: agent.source });

/** The session.tasks, session.tools, session.agent and session.workflow surface of the report, served over the extension event bus. */
export class SubagentRpc {
  constructor(private readonly parts: Parts) {}

  private ctx(): ExtensionContext {
    const ctx = this.parts.context();
    if (!ctx) throw new Error('The session has not started.');
    return ctx;
  }

  async call(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'session.tasks.startAgent': {
        const input = parse(method, StartAgent, params);
        const call = { agent_type: input.agentType, name: input.name, description: input.description ?? input.name, prompt: input.prompt, mode: 'background' as const, ...(input.model !== undefined ? { model: input.model } : {}) };
        const { node } = await this.parts.factory.create(call, `rpc-${randomUUID()}`, undefined, this.ctx());
        return { agentId: node.id };
      }
      case 'session.tasks.register':
        return registerTask(this.parts.registry, method, params);
      case 'session.tasks.update':
        return updateTask(this.parts.registry, method, params);
      case 'session.tasks.list':
      case 'session.tasks.refresh':
        return this.parts.scheduler.list().map((node) => publicTask(node));
      case 'session.tasks.cancel': {
        const input = parse(method, Cancel, params);
        return input.id === '*' ? (await this.parts.scheduler.cancelAll(input.includeIdle ?? false)).map((node) => publicTask(node)) : publicTask(await this.parts.scheduler.cancel(input.id));
      }
      case 'session.tasks.remove':
        return publicTask(await this.parts.scheduler.remove(parse(method, Id, params).id));
      case 'session.tasks.sendMessage': {
        const input = parse(method, SendMessage, params);
        return publicTask(await this.parts.scheduler.write(input.id, input.message, this.ctx()));
      }
      case 'session.tasks.getCurrentPromotable':
        return promotableTask(this.parts.scheduler);
      case 'session.tasks.promoteCurrentToBackground': {
        const promoted = this.parts.scheduler.promoteCurrent();
        return promoted ? publicTask(promoted) : { message: noPromotableMessage };
      }
      case 'session.tasks.promoteToBackground':
        return publicTask(this.parts.registry.promote(parse(method, Id, params).id));
      case 'session.tasks.getProgress': {
        const node = this.parts.scheduler.get(parse(method, Id, params).id);
        return { intent: node.intent ?? null, toolCalls: node.totalToolCalls, tokens: node.totalTokens };
      }
      case 'session.tasks.waitForPending':
        return { drained: await this.parts.scheduler.waitForWork(parse(method, Wait, params).timeoutMs ?? 30_000) };
      case 'session.tools.updateSubagentSettings':
        this.parts.settings.update(parse(method, Settings, params));
        return {};
      case 'session.tools.initializeAndValidate':
        return { tools: this.parts.toolNames() };
      default:
        return this.agent(method, params);
    }
  }

  private agent(method: string, params: unknown): unknown {
    const { selection, factory } = this.parts;
    switch (method) {
      case 'session.fleet.start':
        this.parts.startFleet(parse(method, Goal, params).goal);
        return {};
      case 'session.agent.list':
        return factory.offered(this.ctx()).map(agentSummary);
      case 'session.agent.select': {
        const name = parse(method, Name, params).name;
        const found = factory.offered(this.ctx()).find((candidate) => candidate.name === name);
        if (!found) throw new Error(`Unknown agent: ${name}`);
        selection.select(found);
        return agentSummary(found);
      }
      case 'session.agent.deselect':
        selection.deselect();
        return {};
      case 'session.agent.getCurrent': {
        const current = selection.getCurrent();
        return current ? agentSummary(current.definition) : null;
      }
      case 'session.agent.reload':
        this.parts.reload();
        return {};
      case 'session.agent.setPrompt': {
        const input = parse(method, SetPrompt, params);
        selection.setPrompt(input.name, input.prompt);
        return {};
      }
      default:
        return this.workflow(method, params);
    }
  }

  private workflow(method: string, params: unknown): Promise<unknown> {
    const runtime = this.parts.workflows();
    const runId = () => parse(method, Id, params).id;
    const run = () => {
      const found = runtime.get(runId());
      if (!found) throw new Error(`Unknown workflow run: ${runId()}`);
      return found;
    };
    switch (method) {
      case 'session.workflow.run': {
        const input = parse(method, WorkflowStart, params);
        return runtime.start(input.name, input.arguments, this.ctx(), 'rpc').then(workflowSummary);
      }
      case 'session.workflow.resume':
        return runtime.resume(runId(), this.ctx()).then(workflowSummary);
      case 'session.workflow.getRun':
        return Promise.resolve(runtime.get(runId()) ? workflowSummary(runtime.get(runId()) as NonNullable<ReturnType<WorkflowRuntime['get']>>) : null);
      case 'session.workflow.listRuns':
        return Promise.resolve(runtime.runs().map(workflowSummary));
      case 'session.workflow.getRunDetail':
        return Promise.resolve({ ...workflowSummary(run()), journal: runtime.journal(runId()) });
      case 'session.workflow.getRunProgress':
        return Promise.resolve(runtime.progress(runId()) ?? null);
      case 'session.workflow.cancel':
        return runtime.cancel(runId()).then(workflowSummary);
      case 'session.workflow.pause':
        return runtime.pause(runId()).then(workflowSummary);
      case 'session.workflow.log': {
        const input = parse(method, WorkflowLog, params);
        runtime.appendLog(input.id, input.message);
        return Promise.resolve({});
      }
      case 'session.workflow.agent': {
        const input = parse(method, WorkflowAgentCall, params);
        return runtime.runAgent(input.id, input.prompt, {}, this.ctx());
      }
      case 'session.workflow.journal.get':
        return Promise.resolve(runtime.journal(runId()));
      case 'session.workflow.journal.put': {
        const input = parse(method, JournalPut, params);
        runtime.putJournal(input.id, input.key, input.value);
        return Promise.resolve({});
      }
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }
}

export function serveRpc(pi: ExtensionAPI, rpc: SubagentRpc): void {
  pi.events.on(rpcChannel, async (payload) => {
    if (!Check(Request, payload)) return;
    try {
      pi.events.emit(rpcResultChannel, { id: payload.id, ok: true, result: await rpc.call(payload.method, payload.params) });
    } catch (error) {
      pi.events.emit(rpcResultChannel, { id: payload.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
