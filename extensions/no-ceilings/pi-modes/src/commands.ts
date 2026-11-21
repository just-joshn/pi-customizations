import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { formatDebugLogWidgetLines, readDebugLogPreview } from './debug-logs.ts';
import { formatModeLabel, normalizeModeAlias } from './state.ts';
import { CommandArgsSchema, type ModeId, type ModesRuntimeState, ZERO } from './types.ts';
import { promptModePicker } from './ui-flows.ts';

export interface ModeCommandsCallbacks {
  readonly getState: () => ModesRuntimeState;
  readonly switchMode: (nextMode: ModeId, ctx: ExtensionContext) => Promise<void>;
  readonly reviewExistingPlan: (ctx: ExtensionContext) => Promise<void>;
}

function registerToggleModeCommand(pi: ExtensionAPI, callbacks: ModeCommandsCallbacks, mode: 'ask' | 'debug', description: string, enabledMessage: (state: ModesRuntimeState) => string): void {
  const label = formatModeLabel(mode);
  pi.registerCommand(mode, {
    description,
    handler: async (args, ctx) => {
      const prompt = CommandArgsSchema.parse(args).trim();
      if (prompt.length > ZERO) {
        await callbacks.switchMode(mode, ctx);
        pi.sendUserMessage(prompt);
        return;
      }
      const isAlreadyActive = callbacks.getState().mode === mode;
      await callbacks.switchMode(isAlreadyActive ? 'agent' : mode, ctx);
      ctx.ui.notify(isAlreadyActive ? `${label} mode disabled.` : enabledMessage(callbacks.getState()), 'info');
    },
  });
}

function registerModeCommand(pi: ExtensionAPI, callbacks: ModeCommandsCallbacks): void {
  pi.registerCommand('mode', {
    description: 'Switch execution mode (agent, plan, debug, ask) or open picker',
    handler: async (args, ctx) => {
      const raw = CommandArgsSchema.parse(args).trim();
      const target = raw.length > ZERO ? normalizeModeAlias(raw) : await promptModePicker(ctx, callbacks.getState().mode);
      if (!target && raw.length > ZERO) {
        ctx.ui.notify(`Unknown mode "${raw}". Use: agent, plan, debug, ask.`, 'warning');
        return;
      }
      if (!target) {
        return;
      }
      await callbacks.switchMode(target, ctx);
      ctx.ui.notify(`Mode switched to ${formatModeLabel(target)}.`, 'info');
    },
  });
}

function registerAgentAndPlanCommands(pi: ExtensionAPI, callbacks: ModeCommandsCallbacks): void {
  pi.registerCommand('agent', {
    description: 'Switch to Agent mode (full agent execution) or submit a prompt in Agent mode',
    handler: async (args, ctx) => {
      const prompt = CommandArgsSchema.parse(args).trim();
      await callbacks.switchMode('agent', ctx);
      if (prompt.length > ZERO) {
        pi.sendUserMessage(prompt);
        return;
      }
      ctx.ui.notify('Agent mode enabled. Full tool access active.', 'info');
    },
  });

  pi.registerCommand('plan', {
    description: 'Enter Plan mode (read-only planning), submit a planning prompt, or review existing plan',
    handler: async (args, ctx) => {
      const prompt = CommandArgsSchema.parse(args).trim();
      await callbacks.switchMode('plan', ctx);
      if (prompt.length > ZERO) {
        pi.sendUserMessage(prompt);
        return;
      }
      if (callbacks.getState().currentPlanUri) {
        await callbacks.reviewExistingPlan(ctx);
        return;
      }
      ctx.ui.notify('Plan mode enabled. Built-in write tools disabled.', 'info');
    },
  });
}

export function registerModeCommands(pi: ExtensionAPI, callbacks: ModeCommandsCallbacks): void {
  registerModeCommand(pi, callbacks);
  registerAgentAndPlanCommands(pi, callbacks);
  registerToggleModeCommand(pi, callbacks, 'ask', 'Toggle Ask mode (read-only Q&A) or submit a question in Ask mode', () => 'Ask mode enabled (read-only).');
  registerToggleModeCommand(pi, callbacks, 'debug', 'Toggle Debug mode (NDJSON runtime debugging) or submit a prompt in Debug mode', (state) => {
    const endpoint = state.debugConfig?.serverEndpoint;
    return endpoint ? `Debug mode enabled (${endpoint}).` : 'Debug mode enabled.';
  });

  pi.registerCommand('logs', {
    description: 'Show the current Debug NDJSON log file path and recent entries',
    handler: async (args, ctx) => {
      CommandArgsSchema.parse(args);
      const preview = readDebugLogPreview(ctx.cwd, ctx.sessionManager.getSessionId());
      ctx.ui.notify(formatDebugLogWidgetLines(preview).join('\n'), 'info');
    },
  });
}
