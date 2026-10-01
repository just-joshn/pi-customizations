import { Type } from 'typebox';
import { modelFamilies } from './models.ts';

export function buildAgentSchema(options: { headless?: boolean; forceModel?: boolean; addressable?: boolean } = {}) {
  const properties = {
    description: Type.String({ description: 'A short (3-5 word) description of the task' }),
    prompt: Type.String({ description: 'The task for the agent to perform' }),
    subagent_type: Type.Optional(Type.String({ description: 'The type of specialized agent to use for this task' })),
    ...(options.forceModel
      ? {}
      : {
          model: Type.Optional(
            Type.Union(
              modelFamilies.map((name) => Type.Literal(name)),
              {
                description: `Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the configured default subagent model. If omitted, uses the agent definition's model, else the default (inherits from the parent unless a default subagent model is configured). Ignored for subagent_type: "fork" \u2014 forks always inherit the parent model.`,
              },
            ),
          ),
        }),
    ...(options.headless
      ? {}
      : {
          run_in_background: Type.Optional(
            Type.Boolean({
              description: `Agents run in the background by default; you will be notified when one completes. Set to false only when your very next action depends on this agent's result and nothing else could usefully happen while it runs \u2014 otherwise leave it in the background so the user can hand you other work.`,
            }),
          ),
        }),
    ...(options.addressable
      ? {
          name: Type.Optional(Type.String({ description: 'An addressable name for this agent. Use SendMessage with this name to continue it.' })),
          team_name: Type.Optional(Type.String({ description: 'Deprecated and ignored. The session has one implicit team.' })),
          mode: Type.Optional(Type.Union(['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan'].map((mode) => Type.Literal(mode)), { description: 'Deprecated and ignored. Permission mode comes from the agent definition and runtime.' })),
        }
      : {}),
    isolation: Type.Optional(
      Type.Union([Type.Literal('worktree'), Type.Literal('remote')], {
        description:
          'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" requests remote isolation. Pi has no remote runtime and falls back to a git worktree, or local execution outside Git. Requested and effective isolation are reported separately.',
      }),
    ),
  };
  return Type.Object(properties, { additionalProperties: false });
}

export const SendMessageSchema = Type.Object({ to: Type.String({ description: 'Agent ID or name' }), message: Type.String() });
export const ListAgentsSchema = Type.Object({});
