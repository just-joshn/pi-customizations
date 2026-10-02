import { join } from 'node:path';

import { type ExtensionAPI, type ExtensionCommandContext, getAgentDir, withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { type ShellTask, shellTasks } from '../shells.ts';
import { viewOf } from './agent-records.ts';
import type { SubagentFactory } from './factory.ts';
import type { SubagentScheduler } from './scheduler.ts';
import type { SettingsStore } from './settings-store.ts';
import { parsePreferenceCommand, persistPreference, renderPreferences } from './subagent-preferences.ts';
import { listAgentsText } from './tool-results.ts';
import { publicWorkflow, type WorkflowRuntime } from './workflows/runtime.ts';

export const rubberDuckPrompt = (focus: string) =>
  `Call the task tool now with agent_type "rubber-duck" and mode "sync". Give it the current plan or the work so far, the goal, and what you want challenged${focus ? `: ${focus}` : ''}. Then address its critique before you continue.`;

export const fleetPrompt = (goal: string) =>
  `Fleet mode. Goal: ${goal}\nSplit the goal into independent subtasks and start each one with the task tool in mode "background" in a single turn so they run in parallel, within the concurrency limit. Then read each result with read_agent and combine them. Do not poll.`;

type Parts = Readonly<{ factory: SubagentFactory; scheduler: SubagentScheduler; settings: SettingsStore; workflows: () => WorkflowRuntime }>;

function shellRow(task: ShellTask): string {
  return `id: ${task.id} | kind: shell | status: ${task.status.kind} | command: ${task.command}`;
}

function tasks(pi: ExtensionAPI, parts: Parts, args: string, ctx: ExtensionCommandContext): void {
  const [action, id] = args.trim().split(/\s+/);
  if (action === 'background') {
    const promoted = parts.scheduler.promoteCurrent();
    ctx.ui.notify(promoted ? `Agent ${promoted.id} moved to the background.` : 'No running sync task to move to background.', 'info');
    return;
  }
  if (action === 'cancel' && id) {
    void parts.scheduler.cancel(id).then((node) => ctx.ui.notify(`Agent ${node.id} is ${node.status}.`, 'info'));
    return;
  }
  const visible = parts.scheduler.list().filter((node) => node.status !== 'idle' || action === 'all');
  const agents = visible.length > 0 ? listAgentsText(visible.map((node) => viewOf(node, Date.now()))) : '';
  const shells = shellTasks(pi).map(shellRow).join('\n');
  ctx.ui.notify([agents, shells].filter(Boolean).join('\n') || 'No agents.', 'info');
}

async function subagents(parts: Parts, args: string, ctx: ExtensionCommandContext): Promise<void> {
  const parsed = parsePreferenceCommand(args);
  if ('error' in parsed) {
    ctx.ui.notify(parsed.error, 'warning');
    return;
  }
  if (parsed.kind !== 'show') {
    const file = join(getAgentDir(), 'settings.json');
    try {
      parts.settings.adopt(await withFileMutationQueue(file, async () => persistPreference(file, parsed)));
      ctx.ui.notify('Saved. The change applies to the next subagent.', 'info');
    } catch (error) {
      ctx.ui.notify(`Could not save the preference: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
    return;
  }
  const { settings } = parts.settings.read();
  ctx.ui.notify(renderPreferences(settings, parts.factory.offered(ctx)), 'info');
}

function workflowList(parts: Parts, ctx: ExtensionCommandContext): void {
  const runs = parts.workflows().runs();
  ctx.ui.notify(
    runs.length === 0
      ? 'No workflow runs.'
      : runs
          .map(publicWorkflow)
          .map((run) => `${run.id} ${run.status} attempt ${run.attempt} subagents ${run.consumption.subagents}`)
          .join('\n'),
    'info',
  );
}

export function registerSubagentCommands(pi: ExtensionAPI, parts: Parts): void {
  pi.registerCommand('workflows', { description: 'List dynamic workflow runs and their status', handler: async (_args, ctx) => workflowList(parts, ctx) });
  pi.registerCommand('factories', { description: 'List dynamic workflow runs (internally factories); pause or resume one with dynamic_workflows_manage', handler: async (_args, ctx) => workflowList(parts, ctx) });
  pi.registerCommand('tasks', { description: 'List running subagents, move the current one to the background, or cancel one', handler: async (args, ctx) => tasks(pi, parts, args, ctx) });
  pi.registerCommand('subagents', { description: 'Show or edit the subagent models, effort, tier and disabled agents', handler: async (args, ctx) => subagents(parts, args, ctx) });
  pi.registerCommand('rubber-duck', {
    description: 'Ask the model to get a critique of its plan from the rubber-duck agent',
    handler: async (args, ctx) => {
      if (!parts.factory.offered(ctx).some((agent) => agent.name === 'rubber-duck')) ctx.ui.notify('The rubber-duck agent is not available. Turn it on with /subagents rubber-duck on.', 'warning');
      else pi.sendUserMessage(rubberDuckPrompt(args.trim()));
    },
  });
  pi.registerCommand('fleet', {
    description: 'Split a goal across parallel background subagents',
    handler: async (args, ctx) => {
      if (!args.trim()) ctx.ui.notify('Usage: /fleet <goal>', 'warning');
      else pi.sendUserMessage(fleetPrompt(args.trim()));
    },
  });
}
