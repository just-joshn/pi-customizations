export type McpServerSpec = Readonly<{ kind: 'ref'; name: string }> | Readonly<{ kind: 'inline'; name: string; config: Readonly<Record<string, unknown>> }>;

const serverName = /^[A-Za-z0-9_-]+$/;
const transports = new Set(['stdio', 'http', 'streamable-http']);

function inlineSpec(agentType: string, value: object, warn: (message: string) => void): McpServerSpec | undefined {
  const entries = Object.entries(value);
  const [first] = entries;
  if (entries.length !== 1 || !first) {
    warn(`[Agent: ${agentType}] Invalid MCP server spec: expected exactly one key`);
    return undefined;
  }
  const [name, config] = first;
  if (!serverName.test(name)) {
    warn(`[Agent: ${agentType}] Skipping MCP server '${name}' in frontmatter: names may only contain letters, digits, '_' and '-'`);
    return undefined;
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    warn(`[Agent: ${agentType}] Skipping MCP server '${name}' in frontmatter: the configuration must be an object`);
    return undefined;
  }
  const { type, command, url } = config as Record<string, unknown>;
  if (type !== undefined && (typeof type !== 'string' || !transports.has(type))) {
    warn(`[Agent: ${agentType}] Skipping host-only MCP transport '${String(type)}' for '${name}' in frontmatter`);
    return undefined;
  }
  if (typeof command !== 'string' && typeof url !== 'string') {
    warn(`[Agent: ${agentType}] Skipping MCP server '${name}' in frontmatter: it needs a 'command' or a 'url'`);
    return undefined;
  }
  return { kind: 'inline', name, config: config as Record<string, unknown> };
}

export function parseMcpServers(value: unknown, agentType: string, warn: (message: string) => void): readonly McpServerSpec[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warn(`[Agent: ${agentType}] Ignoring mcpServers: expected a list of server names or single-key server configurations`);
    return undefined;
  }
  return value.flatMap((item): McpServerSpec[] => {
    if (typeof item === 'string') return item.trim() ? [{ kind: 'ref', name: item.trim() }] : [];
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) return [inlineSpec(agentType, item, warn)].filter((spec) => spec !== undefined);
    warn(`[Agent: ${agentType}] Invalid MCP server spec: expected a server name or a single-key configuration`);
    return [];
  });
}
