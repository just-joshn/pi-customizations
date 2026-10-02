import type { ExtensionAPI, ExtensionFactory, McpServerConfig } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './agent-definition.ts';
import type { McpServerSpec } from './mcp-specs.ts';

export const mcpRefreshFailure = 'Failed to refresh MCP tools before subagent creation';
const settleMs = 25;

export type ParentServer = Readonly<{ name: string; config: McpServerConfig }>;

/** Waits for the MCP catalog to go quiet and snapshots every server the parent session runs, owned or inherited. */
export async function gatherParentServers(pi: ExtensionAPI, options: { settledMs?: number } = {}): Promise<readonly ParentServer[]> {
  let latest = pi.getMcpServers().map((server) => ({ name: server.name, config: server.config }));
  let changed = false;
  const off = pi.on('mcp_servers_change', (event) => {
    changed = true;
    latest = event.servers.map((server) => ({ name: server.name, config: server.config }));
  });
  const deadline = Date.now() + (options.settledMs ?? settleMs);
  do {
    changed = false;
    await new Promise<void>((resolve) => setTimeout(resolve, options.settledMs ?? settleMs));
  } while (changed && Date.now() < deadline);
  off();
  return latest;
}

/** The child keeps the parent servers it does not configure itself, which also stops a double registration. */
export function serversForChild(gathered: readonly ParentServer[], definition: Pick<AgentDefinition, 'mcpServers'>): readonly ParentServer[] {
  const own = new Set((definition.mcpServers ?? []).map((spec: McpServerSpec) => spec.name));
  return gathered.filter((server) => !own.has(server.name));
}

/**
 * Registers the inherited servers in the child session. A per-server failure is logged and the rest continue, so
 * creation never fails because one server could not connect.
 */
export function inheritedMcpExtension(servers: readonly ParentServer[], log: (message: string) => void): ExtensionFactory {
  return (pi) => {
    pi.on('session_start', () => {
      for (const server of servers) {
        try {
          pi.registerMcpServer(server.name, server.config);
        } catch (error) {
          log(`${mcpRefreshFailure}: ${server.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
  };
}
