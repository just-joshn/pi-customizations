import { delimiter, resolve } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { additionalAgentDirs, projectAgentDirs } from './agent-sources.ts';
import { clearAgentCache, type Discovery, discoverAgents } from './definitions.ts';
import { parseJsonAgents } from './json-definitions.ts';
import { installedPluginPackages, packageAgents } from './plugin-agents.ts';
import { pstackSetting } from './pstack-settings.ts';
import { parseRegistration, RuntimeAgents } from './runtime-agents.ts';

function settingsDirectories(cwd: string): string[] {
  const configured = pstackSetting(cwd, 'additionalDirectories');
  return Array.isArray(configured) ? configured.filter((dir): dir is string => typeof dir === 'string') : [];
}

export class DefinitionCatalog {
  private readonly runtimeAgents = new RuntimeAgents();
  private readonly reported = new WeakSet<Discovery>();

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly env: NodeJS.ProcessEnv,
    private readonly flags: () => string | undefined,
  ) {
    pi.events.on('pstack:register-agent', (payload) => this.register(payload));
    pi.events.on('pstack:unregister-agent', (payload) => {
      const { plugin, name } = (payload ?? {}) as { plugin?: unknown; name?: unknown };
      if (typeof plugin !== 'string' || typeof name !== 'string') return;
      this.runtimeAgents.unregister(plugin, name);
      clearAgentCache();
    });
    pi.on('session_start', () => clearAgentCache());
    pi.on('resources_discover', () => clearAgentCache());
  }

  private log(message: string): void {
    this.pi.events.emit('pstack:subagent-log', message);
  }

  private register(payload: unknown): void {
    const registration = parseRegistration(payload);
    if (!registration) {
      this.log('Ignored pstack:register-agent: expected { plugin, name, spec } with non-empty plugin and name');
      return;
    }
    this.runtimeAgents.register(registration);
    clearAgentCache();
  }

  private additionalRoots(cwd: string): string[] {
    const flag = this.pi.getFlag('add-dir');
    const fromFlag = typeof flag === 'string' ? flag.split(delimiter).filter(Boolean) : [];
    return [...fromFlag, ...settingsDirectories(cwd)].map((dir) => resolve(cwd, dir));
  }

  discover(ctx: ExtensionContext): Discovery {
    const flags = this.flags();
    const flagAgents = typeof flags === 'string' ? parseJsonAgents(flags, ctx.cwd, (message) => this.log(message)) : [];
    const found = discoverAgents({
      root: ctx.cwd,
      env: this.env,
      flagAgents,
      additionalDirs: additionalAgentDirs(this.additionalRoots(ctx.cwd), projectAgentDirs(ctx.cwd)),
      pluginAgents: (warnings) => [...installedPluginPackages(ctx.cwd).flatMap((pkg) => packageAgents(pkg, warnings)), ...this.runtimeAgents.definitions((message) => warnings.push(message))],
    });
    if (!this.reported.has(found)) {
      this.reported.add(found);
      for (const message of [...found.logs, ...found.warnings]) this.log(message);
      for (const agent of found.activeAgents) if (agent.color) this.pi.events.emit('pstack:subagent-color', { agentType: agent.agentType, color: agent.color });
    }
    return found;
  }
}
