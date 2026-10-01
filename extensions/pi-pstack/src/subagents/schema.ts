import { isAbsolute } from 'node:path';

import { type Static, Type } from 'typebox';
import { Check, Errors } from 'typebox/value';
import { agentTeamsEnabled, backgroundTasksDisabled, envEnabled, forkGateEnabled, modelForced } from './gates.ts';
import { modelFamilies } from './models.ts';

export type AgentSchemaGates = Readonly<{ headless?: boolean; forceModel?: boolean; addressable?: boolean; coordinator?: 'inherit' | 'explicit' }>;

const coordinatorModelNotes = {
  inherit: ' Unavailable on this session: this parameter is ignored \u2014 do not set it.',
  explicit:
    ' Set this only when EXPLICITLY asked by the user for a specific model, never because the task seems small, simple, or cheap; otherwise omit it so the worker uses the default (the session model, unless a default subagent model is configured).',
};

function modelField(note: string) {
  return Type.Optional(
    Type.Union(
      modelFamilies.map((name) => Type.Literal(name)),
      {
        description: `Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the configured default subagent model. If omitted, uses the agent definition's model, else the default (inherits from the parent unless a default subagent model is configured). Ignored for subagent_type: "fork" \u2014 forks always inherit the parent model.${note}`,
      },
    ),
  );
}

const nameDescription = 'Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running.';

const fields = {
  description: Type.String({ description: 'A short (3-5 word) description of the task' }),
  prompt: Type.String({ description: 'The task for the agent to perform' }),
  subagent_type: Type.Optional(Type.String({ description: 'The type of specialized agent to use for this task' })),
  model: modelField(''),
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
      description: 'Isolation mode. "remote" is accepted from saved agent definitions but is not available in this runtime.',
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: 'Absolute path to run the agent in. Overrides the working directory for all filesystem and shell operations within this agent. Mutually exclusive with isolation: "worktree".' }),
  ),
};

const AgentInputSchema = Type.Object({ ...fields, model: Type.Optional(Type.String()) }, { additionalProperties: false });
export type AgentInput = Static<typeof AgentInputSchema>;

export function agentSchemaGates(env: NodeJS.ProcessEnv): AgentSchemaGates {
  const coordinator = envEnabled(env.CLAUDE_CODE_COORDINATOR_MODE) ? { coordinator: env.CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL ? ('inherit' as const) : ('explicit' as const) } : {};
  return { headless: backgroundTasksDisabled(env) || forkGateEnabled(env), forceModel: modelForced(env), addressable: agentTeamsEnabled(env), ...coordinator };
}

export function buildAgentSchema(gates: AgentSchemaGates = {}) {
  const { run_in_background, team_name, mode } = fields;
  const model = gates.coordinator ? modelField(coordinatorModelNotes[gates.coordinator]) : fields.model;
  const { description, prompt, subagent_type } = fields;
  return Type.Object(
    {
      description,
      prompt,
      subagent_type,
      ...(gates.forceModel ? {} : { model }),
      ...(gates.headless ? {} : { run_in_background }),
      ...(gates.addressable ? { name: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', description: nameDescription })), team_name, mode } : {}),
      isolation: Type.Optional(
        Type.Literal('worktree', {
          description: 'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo.',
        }),
      ),
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
