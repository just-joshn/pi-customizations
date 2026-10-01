import { createEventBus } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { SubagentStats, type SubagentStatsDelta, type SubagentStatsSnapshot } from './stats.ts';

const counter = Type.Integer({ minimum: 0 });
const statsEvent = Type.Object({ spawned: counter, completed: counter, failed: counter, killed: counter, max_depth: counter, refused: Type.Object({ depth_limit: counter, concurrency_limit: counter, budget: counter }) });

function difference(current: SubagentStatsSnapshot, previous: SubagentStatsSnapshot): SubagentStatsDelta {
  return {
    spawned: current.spawned - previous.spawned,
    completed: current.completed - previous.completed,
    failed: current.failed - previous.failed,
    killed: current.killed - previous.killed,
    max_depth: current.max_depth,
    refused: {
      depth_limit: current.refused.depth_limit - previous.refused.depth_limit,
      concurrency_limit: current.refused.concurrency_limit - previous.refused.concurrency_limit,
      budget: current.refused.budget - previous.refused.budget,
    },
  };
}

export function childStatsEvents(observe: (change: SubagentStatsDelta) => void): ReturnType<typeof createEventBus> {
  const events = createEventBus();
  let previous = new SubagentStats().snapshot();
  events.on('pstack:subagent-stats', (payload: unknown) => {
    if (!Check(statsEvent, payload)) return;
    const current = structuredClone(payload);
    const change = difference(current, previous);
    previous = current;
    observe(change);
  });
  return events;
}
