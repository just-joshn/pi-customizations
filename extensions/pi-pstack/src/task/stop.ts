import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { subagentDir } from '../paths.ts';
import { agentStatus } from './status.ts';
import { type ChildHandle, KILL_GRACE_MS, signalGroup, validateAgentId } from './runner.ts';

// A subagent starts a moment before its owner writes its pid into the run lock.
const LOCK_AFTER_START_MS = 3_000;
const POLL_MS = 100;

function processStart(pid: number): number | undefined {
  try {
    const started = Date.parse(execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    return Number.isNaN(started) ? undefined : started;
  } catch {
    return undefined;
  }
}

/**
 * Whether the run lock's pid is the subagent process: one this user may signal that started just before the lock named
 * it. That refuses a lock naming its owner while the owner prepares the launch, and a pid reused after a crash.
 */
function isLockedChild(lockPath: string, pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const started = processStart(pid);
  const named = statSync(lockPath).mtimeMs;
  return started !== undefined && started <= named && started >= named - LOCK_AFTER_START_MS;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function exited(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  return !alive(pid);
}

/** Stops the subagent another Pi process runs: SIGTERM to its process group, then SIGKILL after the grace period. */
async function stopElsewhere(agentId: string, lockPath: string, pid: number): Promise<string> {
  if (!isLockedChild(lockPath, pid))
    return `Agent ${agentId}'s run lock names pid ${pid}, which is not a subagent process this user can stop (its owner may still be starting it, or the lock is stale). Nothing was signalled; check again with agent_status.`;
  signalGroup(pid, 'SIGTERM');
  if (await exited(pid, KILL_GRACE_MS)) return `Stopped agent ${agentId}: another Pi process ran it (pid ${pid}), so it got SIGTERM and has exited. That process reports the stop as the agent's result.`;
  signalGroup(pid, 'SIGKILL');
  const gone = await exited(pid, KILL_GRACE_MS);
  return `Agent ${agentId} (pid ${pid}, run by another Pi process) ignored SIGTERM, so it got SIGKILL${gone ? ' and has exited' : ' and has not exited yet'}.`;
}

export interface StopAgentOptions {
  /** A child this process runs, if any. */
  running: (agentId: string) => { handle: ChildHandle } | undefined;
  depth: number;
}

const DESCRIPTION =
  'Stop a running subagent: abort its run and end its process. Its result (the completion notification of a background agent, or the waiting Task result of a foreground one) reports the stop. An agent that is not running is left alone. Resume a stopped agent with Task resume.';

export function registerStopAgent(pi: ExtensionAPI, options: StopAgentOptions): void {
  pi.registerTool({
    name: 'stop_agent',
    label: 'Stop agent',
    description: DESCRIPTION,
    promptSnippet: 'Stop a running subagent by agent ID',
    parameters: Type.Object({ agent_id: Type.String({ description: 'Agent ID from an earlier Task call in this workspace.' }) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    // Nesting stops at the subagent of a subagent, which has no subagents to stop.
    defaultActive: options.depth < 2,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const agentId = validateAgentId(params.agent_id);
      const owned = options.running(agentId);
      if (owned !== undefined) {
        owned.handle.stop();
        await owned.handle.done;
        return { content: [{ type: 'text', text: `Stopped agent ${agentId}: its run was aborted and its process has exited. Its result reports the stop; resume it with Task resume.` }], details: { agentId, stopped: true } };
      }
      const dir = subagentDir(ctx.cwd);
      const status = agentStatus(dir, agentId);
      if (status.state === 'missing') throw new Error(`Unknown agent ID ${agentId}. stop_agent needs an agent ID returned by an earlier Task call in this workspace.`);
      if (status.state === 'idle' || status.pid === undefined) return { content: [{ type: 'text', text: `Agent ${agentId} is not running, so there is nothing to stop.` }], details: { agentId, stopped: false } };
      const text = await stopElsewhere(agentId, join(dir, `${agentId}.lock`), status.pid);
      return { content: [{ type: 'text', text }], details: { agentId, stopped: !alive(status.pid), pid: status.pid } };
    },
  });
}
