import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentDefinition } from './definitions.ts';
import { agentTypeScope } from './tool-specs.ts';

type ChildContext = Readonly<{ id: string; depth: number; definition?: AgentDefinition; appendedPrompt?: string; agentDefinitions?: string }>;

export function saveChildContext(manager: SessionManager, context: ChildContext): void {
  manager.appendCustomEntry('pstack-agent-identity', context.id);
  manager.appendCustomEntry('pstack-agent-depth', context.depth);
  manager.appendCustomEntry('pstack-agent-allowed-types', agentTypeScope(context.definition?.tools) ?? null);
  manager.appendCustomEntry('pstack-append-subagent-system-prompt', context.appendedPrompt ?? null);
  manager.appendCustomEntry('pstack-agent-definition-overrides', context.agentDefinitions ?? null);
}
