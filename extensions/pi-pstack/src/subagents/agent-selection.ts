import type { AgentDefinition } from './agent-definition.ts';
import { generalPurposeName } from './builtin-agents.ts';
import type { EventLog } from './events.ts';

export const generalPurposePromptLocked = 'The general-purpose prompt cannot be overridden.';

export type Selected = Readonly<{ definition: AgentDefinition; prompt: string }>;

/** The custom agent that runs as the main agent of the session, if any. */
export class AgentSelection {
  private readonly events: EventLog;
  private current: Selected | undefined;

  constructor(events: EventLog) {
    this.events = events;
  }

  getCurrent(): Selected | undefined {
    return this.current;
  }

  select(definition: AgentDefinition): Selected {
    if (!definition.userInvocable) throw new Error(`Agent '${definition.name}' cannot be selected by the user.`);
    this.current = { definition, prompt: definition.prompt };
    this.events.emit('subagent.selected', { agentName: definition.name, agentDisplayName: definition.displayName, tools: definition.tools.kind === 'all' ? ['*'] : definition.tools.names });
    return this.current;
  }

  deselect(): void {
    if (!this.current) return;
    this.current = undefined;
    this.events.emit('subagent.deselected', {});
  }

  setPrompt(name: string, prompt: string): Selected {
    if (name === generalPurposeName) throw new Error(generalPurposePromptLocked);
    if (this.current?.definition.name !== name) throw new Error(`Agent '${name}' is not the selected agent.`);
    this.current = { ...this.current, prompt };
    return this.current;
  }

  /** A policy refresh that no longer offers the selected agent clears the selection. */
  refresh(offered: readonly AgentDefinition[]): boolean {
    const found = this.current ? offered.find((agent) => agent.name === this.current?.definition.name) : undefined;
    if (this.current && !found) {
      this.deselect();
      return true;
    }
    return false;
  }
}
