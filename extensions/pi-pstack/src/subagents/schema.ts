import { isAbsolute } from 'node:path';

import { type Static, Type } from 'typebox';
import { Check, Errors } from 'typebox/value';
import { agentTeamsEnabled, backgroundTasksDisabled, forkGateEnabled, modelForced } from './gates.ts';
import { modelFamilies } from './models.ts';

export type AgentSchemaGates = Readonly<{ headless?: boolean; forceModel?: boolean; addressable?: boolean }>;

const nameDescription = 'Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running.';

const fields = {
  description: Type.String({ description: 'A short (3-5 word) description of the task' }),
  prompt: Type.String({ description: 'The task for the agent to perform' }),
  subagent_type: Type.Optional(Type.String({ description: 'The type of specialized agent to use for this task' })),
  model: Type.Optional(
    Type.Union(
      modelFamilies.map((name) => Type.Literal(name)),
      {
        description: `Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the configured default subagent model. If omitted, uses the agent definition's model, else the default (inherits from the parent unless a default subagent model is configured). Ignored for subagent_type: "fork" — forks always inherit the parent model.`,
      },
    ),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({
      description: `Agents run in the background by default; you will be notified when one completes. Set to false only when your very next action depends on this agent's result and nothing else could usefully happen while it runs — otherwise leave it in the background so the user can hand you other work.`,
    }),
  ),
  name: Type.Optional(Type.String({ description: nameDescription })),
  team_name: Type.Optional(Type.String({ description: 'Deprecated; ignored. The session has a single implicit team.' })),
  mode: Type.Optional(
    Type.Union(
      ['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan'].map((mode) => Type.Literal(mode)),
      { description: "Deprecated; ignored. Subagents inherit the parent session's permission mode; agent-definition frontmatter may override it." },
    ),
  ),
  isolation: Type.Optional(
    Type.Union([Type.Literal('worktree'), Type.Literal('remote')], {
      description:
        'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" launches the agent in a remote cloud environment (always runs in background; availability is gated).',
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: 'Absolute path to run the agent in. Overrides the working directory for all filesystem and shell operations within this agent. Mutually exclusive with isolation: "worktree".' }),
  ),
};

const AgentInputSchema = Type.Object({ ...fields, model: Type.Optional(Type.String()) }, { additionalProperties: false });
export type AgentInput = Static<typeof AgentInputSchema>;

export function agentSchemaGates(env: NodeJS.ProcessEnv): AgentSchemaGates {
  return { headless: backgroundTasksDisabled(env) || forkGateEnabled(env), forceModel: modelForced(env), addressable: agentTeamsEnabled(env) };
}

export function buildAgentSchema(gates: AgentSchemaGates = {}) {
  const { model, run_in_background, team_name, mode } = fields;
  const { description, prompt, subagent_type, isolation } = fields;
  return Type.Object(
    {
      description,
      prompt,
      subagent_type,
      ...(gates.forceModel ? {} : { model }),
      ...(gates.headless ? {} : { run_in_background }),
      ...(gates.addressable ? { name: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', description: nameDescription })), team_name, mode } : {}),
      isolation,
    },
    { additionalProperties: false },
  );
}

export function parseAgentInput(input: unknown): AgentInput {
  if (!Check(AgentInputSchema, input)) {
    const issues = [...Errors(AgentInputSchema, input)].map((issue) => `${issue.instancePath || '/'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid Agent input: ${issues}`);
  }
  if (input.cwd !== undefined && !isAbsolute(input.cwd)) throw new Error(`cwd must be an absolute path: ${input.cwd}`);
  return input;
}

export const SendMessageSchema = Type.Object({ to: Type.String({ description: 'Agent ID or name' }), message: Type.String() });
export const ListAgentsSchema = Type.Object({});
