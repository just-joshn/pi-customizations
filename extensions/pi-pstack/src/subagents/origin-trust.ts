import type { AgentDefinition } from './definitions.ts';

export type Authority = Readonly<{ allowed: true }> | Readonly<{ allowed: false; reason: string }>;

export function executableAuthority(definition: AgentDefinition, projectTrusted: boolean): Authority {
  switch (definition.source) {
    case 'built-in':
    case 'userSettings':
    case 'flagSettings':
    case 'policySettings':
      return { allowed: true };
    case 'projectSettings':
      return projectTrusted ? { allowed: true } : { allowed: false, reason: `the ${definition.fromAdditionalDirectory ? 'additional directory' : 'project folder'} is not trusted` };
    case 'plugin':
      return { allowed: false, reason: 'plugin agents cannot declare hooks or MCP servers' };
  }
}

export function hasExecutableConfig(definition: AgentDefinition): boolean {
  return definition.hooks !== undefined || definition.mcpServers !== undefined;
}

export function authorizeDefinition(definition: AgentDefinition, projectTrusted: boolean, log: (message: string) => void): AgentDefinition {
  if (!hasExecutableConfig(definition)) return definition;
  const authority = executableAuthority(definition, projectTrusted);
  if (authority.allowed) return definition;
  const { hooks: _hooks, mcpServers: _servers, ...rest } = definition;
  log(`[Agent: ${definition.agentType}] Skipping frontmatter hooks and MCP servers: ${authority.reason}`);
  return rest;
}
