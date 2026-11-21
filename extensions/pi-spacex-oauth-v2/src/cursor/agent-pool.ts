import type { SDKAgent } from '@cursor/sdk';
import { createCell, withEntry, withoutKeys } from '../cell.ts';
import { CURSOR_CONFIG } from './config.ts';

/** Agents between runs, keyed by the conversation Cursor holds for them. Map order is recency. */
const idleAgents = createCell(new Map<string, SDKAgent>());

/** Parks `agent` under `key`. An agent it replaces or pushes past the pool size is closed, because nothing else can reach it. */
export function keepIdle(key: string, agent: SDKAgent): void {
  const pool = idleAgents.read();
  const replaced = pool.get(key);
  const entries = [...withEntry(pool, key, agent)];
  const excess = Math.max(0, entries.length - CURSOR_CONFIG.maxIdleAgents);
  idleAgents.write(new Map(entries.slice(excess)));
  const evicted = entries.slice(0, excess).map(([, old]) => old);
  for (const dropped of replaced && replaced !== agent ? [replaced, ...evicted] : evicted) dropped.close();
}

/** Hands the idle agent for `key` to the caller, who now owns closing it. */
export function takeIdle(key: string): SDKAgent | undefined {
  const agent = idleAgents.read().get(key);
  idleAgents.write(withoutKeys(idleAgents.read(), [key]));
  return agent;
}

/** Closes every idle agent, for when the session that parked them is over. */
export function closeIdleAgents(): void {
  const agents = [...idleAgents.read().values()];
  idleAgents.write(new Map());
  for (const agent of agents) agent.close();
}
