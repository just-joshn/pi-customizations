import type { ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent';

export class AgentInvocations {
  private types: ReadonlySet<string> = new Set();

  restore(branch: readonly SessionEntry[]): void {
    this.types = new Set(branch.flatMap((entry) => (entry.type === 'custom' && entry.customType === 'pstack-agent-type-invoked' && typeof entry.data === 'string' ? [entry.data] : [])));
  }

  mark(pi: ExtensionAPI, agentType: string, agentId: string): void {
    const firstInvocation = !this.types.has(agentType);
    if (firstInvocation) {
      this.types = new Set([...this.types, agentType]);
      pi.appendEntry('pstack-agent-type-invoked', agentType);
    }
    pi.events.emit('pstack:agent-type-invoked', { agentType, agentId, firstInvocation });
  }
}
