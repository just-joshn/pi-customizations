import { Type } from 'typebox';
import { modelFamilies } from './models.ts';

export function buildAgentSchema(options: { headless?: boolean; forceModel?: boolean } = {}) {
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
                description:
                  'Optional model override for this agent. Takes precedence over the agent definition\'s model frontmatter. If omitted, uses the agent definition\'s model, or inherits from the parent. Ignored for subagent_type: "fork".',
              },
            ),
          ),
        }),
    ...(options.headless
      ? {}
      : {
          run_in_background: Type.Optional(
            Type.Boolean({ description: 'Agents run in the background by default. Set to false to wait for the result and have it returned directly. You will be notified when a background agent completes.' }),
          ),
        }),
    isolation: Type.Optional(
      Type.Union([Type.Literal('worktree'), Type.Literal('remote')], {
        description: 'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" launches the agent in a remote environment.',
      }),
    ),
  };
  return Type.Object(properties, { additionalProperties: false });
}

export const SendMessageSchema = Type.Object({ to: Type.String({ description: 'Agent ID or name' }), message: Type.String() });
export const ListAgentsSchema = Type.Object({});
