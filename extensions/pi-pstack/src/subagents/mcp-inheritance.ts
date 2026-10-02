import type { ExtensionAPI, ExtensionFactory, McpServerConfig } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './agent-definition.ts';
import type { McpServerSpec } from './mcp-specs.ts';

export const mcpRefreshFailure = 'Failed to refresh MCP tools before subagent creation';

export type ParentServer = Readonly<{ name: string; config: McpServerConfig }>;

/** Snapshots every server extensions registered in the parent session. Servers in mcp.json reach the child through its own MCP extension. */
export function gatherParentServers(pi: Pick<ExtensionAPI, 'getMcpServers'>): readonly ParentServer[] {
  return pi.getMcpServers().map((server) => ({ name: server.name, config: server.config }));
}

/** The child keeps the parent servers it does not configure itself, which also stops a double registration. */
export function serversForChild(gathered: readonly ParentServer[], definition: Pick<AgentDefinition, 'mcpServers'>): readonly ParentServer[] {
  const own = new Set((definition.mcpServers ?? []).map((spec: McpServerSpec) => spec.name));
  return gathered.filter((server) => !own.has(server.name));
}

/**
 * Registers the inherited servers in the child session. A per-server failure is logged and the rest continue, so
 * creation never fails because one server could not connect. Deferred servers load their tools through tool search.
 */
export function inheritedMcpExtension(servers: readonly ParentServer[], log: (message: string) => void, deferred = false): ExtensionFactory {
  return (pi) => {
    pi.on('session_start', () => {
      for (const server of servers) {
        try {
          pi.registerMcpServer(server.name, deferred ? { ...server.config, exposure: 'deferred' } : server.config);
        } catch (error) {
          log(`${mcpRefreshFailure}: ${server.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
  };
}
