import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import type { AgentDefinition } from './agent-definition.ts';
import { agentDirectories, type LocationInputs } from './agent-locations.ts';
import { markdownAgentFiles } from './agent-sources.ts';
import { parseCustomAgent } from './custom-agents.ts';

export type Discovered = Readonly<{ agents: readonly AgentDefinition[]; diagnostics: readonly string[] }>;
export type OrganizationAgents = (cwd: string) => readonly AgentDefinition[];

export function discoverCustomAgents(inputs: LocationInputs & { organization?: OrganizationAgents }): Discovered {
  const diagnostics: string[] = [];
  const found = agentDirectories({ home: homedir(), ...inputs }).flatMap(({ dir, source }) =>
    markdownAgentFiles(dir, diagnostics).flatMap((path) => {
      const parsed = parseCustomAgent(readFileSync(path, 'utf8'), { source, path });
      diagnostics.push(...parsed.warnings, ...(parsed.error ? [parsed.error] : []));
      return parsed.agent ? [parsed.agent] : [];
    }),
  );
  return { agents: [...(inputs.organization?.(inputs.cwd) ?? []), ...found], diagnostics };
}

export class DiscoveryCache {
  private cached: ReadonlyMap<string, Discovered> = new Map();

  get(inputs: LocationInputs & { organization?: OrganizationAgents }): Discovered {
    const hit = this.cached.get(inputs.cwd);
    if (hit) return hit;
    const found = discoverCustomAgents(inputs);
    this.cached = new Map([...this.cached, [inputs.cwd, found]]);
    return found;
  }

  clear(): void {
    this.cached = new Map();
  }
}
