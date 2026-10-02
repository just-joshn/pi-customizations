import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { featureEnabled } from '../feature-flags.ts';
import type { SidekickSpec, TriggerName } from './spec.ts';

export const triggerLimitMessage = 'Sidekick trigger limit reached';
export type LaunchFacts = Readonly<Record<string, boolean>>;
export type SidekickState = 'running' | 'idle';

export type SidekickPorts = Readonly<{
  launch: (spec: SidekickSpec, text: string, ctx: ExtensionContext) => Promise<string>;
  send: (agentId: string, text: string, ctx: ExtensionContext) => Promise<void>;
  cancel: (agentId: string) => Promise<void>;
  state: (agentId: string) => SidekickState | undefined;
  facts: () => Promise<LaunchFacts>;
  deliver: (spec: SidekickSpec, message: string, truncated: boolean) => void;
  log: (message: string) => void;
}>;

export function sidekickEnabled(spec: SidekickSpec, env: NodeJS.ProcessEnv, facts: LaunchFacts): boolean {
  const flagged = env.COPILOT_DEBUG_ENABLE_SIDEKICKS === '1' || env.COPILOT_DEBUG_ENABLE_SIDEKICKS === 'true' || featureEnabled(env, spec.featureFlag) || env[spec.featureFlag] === '1' || env[spec.featureFlag] === 'true';
  return flagged && spec.launchConditions.every((condition) => facts[condition] === true);
}

/** Event driven helpers with their own task store: each trigger starts, reuses or restarts one agent per sidekick. */
export class SidekickManager {
  private readonly counts = new Map<string, number>();
  private readonly agents = new Map<string, string>();
  private readonly owners = new Map<string, SidekickSpec>();
  private sends = new Map<string, number>();
  private warned: ReadonlySet<string> = new Set();

  constructor(
    private readonly specs: readonly SidekickSpec[],
    private readonly env: NodeJS.ProcessEnv,
    private readonly ports: SidekickPorts,
  ) {}

  async enabled(): Promise<readonly SidekickSpec[]> {
    const facts = await this.ports.facts();
    return this.specs.filter((spec) => sidekickEnabled(spec, this.env, facts));
  }

  hasActiveWork(): boolean {
    return [...this.agents.values()].some((id) => this.ports.state(id) === 'running');
  }

  async trigger(name: TriggerName, text: string, ctx: ExtensionContext): Promise<void> {
    if (name === 'user.message') this.sends = new Map();
    for (const spec of await this.enabled()) {
      const limit = spec.triggers[name];
      if (limit === undefined) continue;
      if (name === 'user.message' && spec.cancelOnNewTurn) await this.cancel(spec);
      const key = `${spec.name}:${name}`;
      const used = (this.counts.get(key) ?? 0) + 1;
      if (used > limit) {
        this.limitReached(key);
        continue;
      }
      this.counts.set(key, used);
      await this.run(spec, text, ctx);
    }
  }

  private limitReached(key: string): void {
    if (this.warned.has(key)) return;
    this.warned = new Set([...this.warned, key]);
    this.ports.log(`${triggerLimitMessage}: ${key}`);
  }

  private async run(spec: SidekickSpec, text: string, ctx: ExtensionContext): Promise<void> {
    const existing = this.agents.get(spec.name);
    const state = existing ? this.ports.state(existing) : undefined;
    if (existing && state !== undefined && spec.behavior === 'persistent') {
      await this.ports.send(existing, text, ctx);
      return;
    }
    if (existing && state !== undefined) await this.cancel(spec);
    const id = await this.ports.launch(spec, text, ctx);
    this.agents.set(spec.name, id);
    this.owners.set(id, spec);
  }

  private async cancel(spec: SidekickSpec): Promise<void> {
    const id = this.agents.get(spec.name);
    if (!id) return;
    this.agents.delete(spec.name);
    await this.ports.cancel(id);
  }

  async cancelAll(): Promise<void> {
    const ids = [...this.agents.values()];
    this.agents.clear();
    const outcomes = await Promise.allSettled(ids.map((id) => this.ports.cancel(id)));
    for (const outcome of outcomes) if (outcome.status === 'rejected') this.ports.log(`Sidekick cancel failed: ${String(outcome.reason)}`);
  }

  /** A message a sidekick sent with send_inbox: dropped past maxSendsPerTurn, forwarded in full under the inline limit and cut above it. */
  inbox(agentId: string, message: string): boolean {
    const spec = this.owners.get(agentId);
    if (!spec) return false;
    const sent = this.sends.get(spec.name) ?? 0;
    if (sent >= spec.maxSendsPerTurn) return false;
    this.sends = new Map([...this.sends, [spec.name, sent + 1]]);
    const truncated = message.length > spec.inlineForwardMaxChars;
    this.ports.deliver(spec, truncated ? message.slice(0, spec.inlineForwardMaxChars) : message, truncated);
    return true;
  }
}
