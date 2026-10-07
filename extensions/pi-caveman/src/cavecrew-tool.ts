import { resolve } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { CREW, crewModel, runCrew } from './cavecrew.ts';

const parameters = Type.Object({
  agent: Type.Union(
    CREW.map((role) => Type.Literal(role)),
    { description: 'investigator: locate code, read-only. builder: surgical 1-2 file edit. reviewer: one-line-per-finding diff review, read-only.' },
  ),
  task: Type.String({ minLength: 1, description: 'Self-contained task for the subagent. It has no access to this conversation.' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the subagent. Defaults to the session cwd.' })),
});

const outputSchema = Type.Object({ role: Type.String(), model: Type.Union([Type.String(), Type.Null()]), turns: Type.Number(), output: Type.String() });

export function registerCavecrew(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'cavecrew',
    label: 'Cavecrew',
    description:
      'Delegate to a cavecrew subagent in an isolated Pi process. It answers in ultracave voice, so its result costs about a third of a prose subagent. ' +
      'investigator: "where is X defined / what calls Y" → path:line table. builder: surgical edit of at most 2 files → diff receipt. reviewer: diff or file review → one line per finding.',
    promptSnippet: 'Delegate locate/edit/review work to compressed cavecrew subagents',
    parameters,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const model = crewModel(params.agent, process.env, ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null);
      onUpdate?.({ content: [{ type: 'text', text: `cavecrew-${params.agent} running…` }], details: undefined });
      const run = await runCrew({ role: params.agent, task: params.task, cwd: params.cwd ? resolve(ctx.cwd, params.cwd) : ctx.cwd, model, signal });
      if (run.exitCode !== 0 || !run.output) {
        throw new Error(`cavecrew-${params.agent} failed (exit ${run.exitCode})${run.stderr ? `: ${run.stderr.trim()}` : ''}`);
      }
      return {
        content: [{ type: 'text', text: run.output }],
        details: undefined,
        structuredContent: { role: run.role, model: run.model, turns: run.turns, output: run.output },
        usage: run.usage,
      };
    },
  });
}
