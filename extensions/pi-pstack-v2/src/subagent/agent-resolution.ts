import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type AgentConfig, type AgentScope, discoverAgents } from './agents.ts';
import { FORK_AGENT_CONFIG, FORK_AGENT_NAME } from './fork.ts';
import type { ResolvedAgent } from './types.ts';

export function resolveAgent(defaultCwd: string, scope: AgentScope, name: string, cwd?: string): ResolvedAgent {
  const effectiveCwd = path.resolve(defaultCwd, cwd ?? '.');
  const discovery = discoverAgents(effectiveCwd, scope);
  return {
    agent: name === FORK_AGENT_NAME ? FORK_AGENT_CONFIG : discovery.agents.find((candidate) => candidate.name === name),
    available: discovery.agents,
    cwd: effectiveCwd,
  };
}

/** Project agents that still need approval: those outside the trusted project agents directory. */
function untrustedProjectAgents(ctx: ExtensionContext, selected: ResolvedAgent[], projectAgentsDir: string | null): AgentConfig[] {
  const byPath = new Map(selected.flatMap(({ agent }) => (agent?.source === 'project' ? [[agent.filePath, agent] as const] : [])));
  const trustedDir = ctx.isProjectTrusted() && projectAgentsDir ? fs.realpathSync(projectAgentsDir) : undefined;
  return [...byPath.values()].filter((agent) => !trustedDir || fs.realpathSync(path.dirname(agent.filePath)) !== trustedDir);
}

/** Resolves true when the run may proceed: nothing needs approval, or the user approved. */
export async function projectAgentsApproved(ctx: ExtensionContext, selected: ResolvedAgent[], projectAgentsDir: string | null): Promise<boolean> {
  const requested = untrustedProjectAgents(ctx, selected, projectAgentsDir);
  if (requested.length === 0) return true;
  const sources = requested.map((agent) => `- ${agent.name}: ${agent.filePath}`).join('\n');
  return ctx.ui.confirm('Run project-local agents?', `Sources:\n${sources}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`);
}
