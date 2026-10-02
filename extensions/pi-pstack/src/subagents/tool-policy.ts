import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './agent-definition.ts';
import { planTools } from './tool-mapping.ts';

export const toolPolicyMessage = 'is not one of the tools this agent was given';

export type ToolPolicyInput = Readonly<{ definition: Pick<AgentDefinition, 'tools'>; parentTools: readonly string[]; contextManagement: boolean }>;

/**
 * An agent with a named tool list keeps exactly those tools. Tools that register after the child starts, such as MCP tools, are
 * deactivated before each run, and a call that still reaches one is refused.
 */
export function toolPolicyExtension(input: ToolPolicyInput): ExtensionFactory {
  return (pi) => {
    if (input.definition.tools.kind === 'all') return;
    const allowed = () => planTools({ ...input, available: pi.getAllTools().map((tool) => tool.name) }).effective;
    pi.on('before_agent_start', () => {
      pi.setActiveTools([...allowed()]);
    });
    pi.on('tool_call', (event) => (allowed().includes(event.toolName) ? undefined : { block: true, reason: `${event.toolName} ${toolPolicyMessage}` }));
  };
}
