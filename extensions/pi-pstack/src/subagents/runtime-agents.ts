import type { AgentDefinition } from './definitions.ts';
import { parseJsonAgentSpec } from './json-definitions.ts';

type Spec = Readonly<Record<string, unknown>>;
export type RuntimeAgentRegistration = Readonly<{ plugin: string; name: string; spec: Spec; load?: () => Promise<Spec | undefined> }>;

function asPlugin(definition: AgentDefinition, registration: RuntimeAgentRegistration, warn: (message: string) => void = () => {}): AgentDefinition {
  const { mcpServers, permissionMode, ...rest } = definition;
  for (const [key, present] of [['mcpServers', mcpServers], ['permissionMode', permissionMode]] as const)
    if (present !== undefined) warn(`Plugin agent ${registration.plugin}:${registration.name} sets ${key}, which is ignored for plugin agents.`);
  return { ...rest, source: 'plugin', baseDir: 'plugin', plugin: registration.plugin, filename: registration.name, registeredAtRunTime: true };
}

function lazyDefinition(registration: RuntimeAgentRegistration, load: () => Promise<Spec | undefined>, warn: (message: string) => void): AgentDefinition {
  const agentType = `${registration.plugin}:${registration.name}`;
  const loadDefinition = async () => {
    const loaded = await load();
    if (loaded === undefined) return undefined;
    const { name, ...rest } = loaded;
    return asPlugin(parseJsonAgentSpec(typeof name === 'string' ? `${registration.plugin}:${name}` : agentType, rest, 'plugin', warn), registration, warn);
  };
  const description = typeof registration.spec.description === 'string' ? registration.spec.description : `Agent from ${registration.plugin} plugin`;
  return { ...asPlugin({ agentType, whenToUse: description, systemPrompt: '', source: 'plugin', baseDir: 'plugin' }, registration), loadDefinition };
}

export class RuntimeAgents {
  private registrations: ReadonlyMap<string, RuntimeAgentRegistration> = new Map();

  register(registration: RuntimeAgentRegistration): void {
    this.registrations = new Map([...this.registrations, [`${registration.plugin}:${registration.name}`, registration]]);
  }

  unregister(plugin: string, name: string): void {
    this.registrations = new Map([...this.registrations].filter(([key]) => key !== `${plugin}:${name}`));
  }

  definitions(warn: (message: string) => void): AgentDefinition[] {
    return [...this.registrations.values()].flatMap((registration) => {
      if (registration.load) return [lazyDefinition(registration, registration.load, warn)];
      try {
        return [asPlugin(parseJsonAgentSpec(`${registration.plugin}:${registration.name}`, registration.spec, 'plugin', warn), registration, warn)];
      } catch (error) {
        warn(`Failed to register agent ${registration.plugin}:${registration.name}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    });
  }
}

export function parseRegistration(payload: unknown): RuntimeAgentRegistration | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { plugin, name, spec, load } = payload as Record<string, unknown>;
  if (typeof plugin !== 'string' || !plugin || typeof name !== 'string' || !name || typeof spec !== 'object' || spec === null) return undefined;
  return { plugin, name, spec: spec as Spec, ...(typeof load === 'function' ? { load: load as () => Promise<Spec | undefined> } : {}) };
}
