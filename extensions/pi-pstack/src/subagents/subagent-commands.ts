import { join } from 'node:path';

import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { viewOf } from './agent-records.ts';
import type { SubagentFactory } from './factory.ts';
import type { SubagentScheduler } from './scheduler.ts';
import type { SettingsStore } from './settings-store.ts';
import { parsePreferenceCommand, persistPreference, renderPreferences } from './subagent-preferences.ts';
import { listAgentsText } from './tool-results.ts';

export const rubberDuckPrompt = (focus: string) =>
  `Call the task tool now with agent_type "rubber-duck" and mode "sync". Give it the current plan or the work so far, the goal, and what you want challenged${focus ? `: ${focus}` : ''}. Then address its critique before you continue.`;

export const fleetPrompt = (goal: string) =>
  `Fleet mode. Goal: ${goal}\nSplit the goal into independent subtasks and start each one with the task tool in mode "background" in a single turn so they run in parallel, within the concurrency limit. Then read each result with read_agent and combine them. Do not poll.`;

type Parts = Readonly<{ factory: SubagentFactory; scheduler: SubagentScheduler; settings: SettingsStore }>;

function tasks(parts: Parts, args: string, ctx: ExtensionCommandContext): void {
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
  ctx.ui.notify(listAgentsText(visible.map((node) => viewOf(node, Date.now()))), 'info');
}

function subagents(parts: Parts, args: string, ctx: ExtensionCommandContext): void {
  const parsed = parsePreferenceCommand(args);
  if ('error' in parsed) {
    ctx.ui.notify(parsed.error, 'warning');
    return;
  }
  if (parsed.kind !== 'show') {
    persistPreference(join(getAgentDir(), 'settings.json'), parsed);
    ctx.ui.notify('Saved. The change applies to the next subagent.', 'info');
    return;
  }
  const { settings } = parts.settings.read(ctx.cwd);
  ctx.ui.notify(renderPreferences(settings, parts.factory.offered(ctx)), 'info');
}

export function registerSubagentCommands(pi: ExtensionAPI, parts: Parts): void {
  pi.registerCommand('tasks', { description: 'List running subagents, move the current one to the background, or cancel one', handler: async (args, ctx) => tasks(parts, args, ctx) });
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
