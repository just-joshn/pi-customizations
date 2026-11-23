import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
import { findCustomMode } from './custom-modes.ts';
import { formatDebugLogWidgetLines, readDebugLogPreview } from './debug-logs.ts';
import { isModeColorName, listModeColorAliases, listModeColorChoices, MODE_ICON_CHOICES, normalizeModeColorId } from './mode-colors.ts';
import { canonicalModeName, formatModeLabel, normalizeModeAlias } from './state.ts';
import { CommandArgsSchema, type CustomModeAppearancePatch, type CustomModeSkill, MAX_MODE_ICON_LENGTH, MODE_IDS, MODE_PROMPT_CUSTOM_TYPE, MODE_SPECS, type ModeId, type ModesRuntimeState, ZERO } from './types.ts';
import { promptColorPicker, promptIconPicker, promptModePicker } from './ui-flows.ts';

const OFF_WORDS = new Set(['off', 'exit', 'none', 'disable']);
const COLOR_VERB = 'color';
const ICON_VERB = 'icon';
const SPACE = ' ';

const MODE_VERB_COMPLETIONS: readonly AutocompleteItem[] = [
  { value: 'off', label: 'off', description: 'Leave the active custom mode' },
  { value: 'color', label: 'color', description: "Set the active custom mode's color" },
  { value: 'icon', label: 'icon', description: "Set the active custom mode's icon" },
];

export interface ModeCommandsCallbacks {
  readonly getState: () => ModesRuntimeState;
  readonly switchMode: (nextMode: ModeId, ctx: ExtensionContext) => Promise<void>;
  readonly reviewExistingPlan: (ctx: ExtensionContext) => Promise<void>;
  readonly listCustomModes: () => Promise<readonly CustomModeSkill[]>;
  readonly enterCustomMode: (skill: CustomModeSkill, ctx: ExtensionContext) => Promise<void>;
  readonly exitCustomMode: (ctx: ExtensionContext) => Promise<void>;
  readonly setCustomModeAppearance: (patch: CustomModeAppearancePatch, ctx: ExtensionContext) => Promise<void>;
}

interface ModeCommandArgs {
  readonly verb: string;
  readonly rest: string;
}

function splitModeArgs(raw: string): ModeCommandArgs {
  const spaceIndex = raw.indexOf(SPACE);
  if (spaceIndex < ZERO) {
    return { verb: raw.toLowerCase(), rest: '' };
  }
  return { verb: raw.slice(ZERO, spaceIndex).toLowerCase(), rest: raw.slice(spaceIndex + 1).trim() };
}

async function submitModePrompt(pi: ExtensionAPI, ctx: ExtensionCommandContext, prompt: string): Promise<void> {
  if (ctx.hasUI) {
    pi.sendUserMessage(prompt);
    return;
  }
  // A custom trigger marks Pi busy synchronously, before print mode can finish or submit the next prompt.
  pi.sendMessage({ customType: MODE_PROMPT_CUSTOM_TYPE, content: prompt, display: true }, { triggerTurn: true, deliverAs: 'followUp' });
  await ctx.waitForIdle();
}

function registerToggleModeCommand(pi: ExtensionAPI, callbacks: ModeCommandsCallbacks, mode: 'ask' | 'debug', description: string, enabledMessage: (state: ModesRuntimeState) => string): void {
  const label = formatModeLabel(mode);
  pi.registerCommand(mode, {
    description,
    handler: async (args, ctx) => {
      const prompt = CommandArgsSchema.parse(args).trim();
      if (prompt.length > ZERO) {
        await callbacks.switchMode(mode, ctx);
        await submitModePrompt(pi, ctx, prompt);
        return;
      }
      const isAlreadyActive = callbacks.getState().mode === mode;
      await callbacks.switchMode(isAlreadyActive ? 'agent' : mode, ctx);
      ctx.ui.notify(isAlreadyActive ? `${label} mode disabled.` : enabledMessage(callbacks.getState()), 'info');
    },
  });
}

async function applyModePickerChoice(callbacks: ModeCommandsCallbacks, modes: readonly CustomModeSkill[], ctx: ExtensionContext): Promise<void> {
  const choice = await promptModePicker(ctx, callbacks.getState(), modes);
  if (!choice) {
    return;
  }
  if (choice.kind === 'builtin') {
    await callbacks.switchMode(choice.id, ctx);
    ctx.ui.notify(`Mode switched to ${formatModeLabel(choice.id)}.`, 'info');
    return;
  }
  const skill = modes.find((mode) => mode.id === choice.id);
  if (skill !== undefined) {
    await callbacks.enterCustomMode(skill, ctx);
  }
}

async function applyColorChoice(callbacks: ModeCommandsCallbacks, rawValue: string, ctx: ExtensionContext): Promise<void> {
  const active = callbacks.getState().customMode;
  if (active === undefined) {
    ctx.ui.notify('No custom mode is active. Enter one with /mode <name> first.', 'warning');
    return;
  }
  const choice = rawValue.length > ZERO ? rawValue : await promptColorPicker(ctx, listModeColorChoices(), active.colorId);
  if (choice === undefined) {
    return;
  }
  if (!isModeColorName(choice)) {
    ctx.ui.notify(`Unknown color "${choice}". Use: ${listModeColorAliases().join(', ')}.`, 'warning');
    return;
  }
  await callbacks.setCustomModeAppearance({ color: normalizeModeColorId(choice) }, ctx);
}

async function applyIconChoice(callbacks: ModeCommandsCallbacks, rawValue: string, ctx: ExtensionContext): Promise<void> {
  const active = callbacks.getState().customMode;
  if (active === undefined) {
    ctx.ui.notify('No custom mode is active. Enter one with /mode <name> first.', 'warning');
    return;
  }
  const choice = rawValue.length > ZERO ? rawValue : await promptIconPicker(ctx, MODE_ICON_CHOICES, active.icon);
  if (choice === undefined) {
    return;
  }
  if (choice.length > MAX_MODE_ICON_LENGTH) {
    ctx.ui.notify(`Icon must be ${MAX_MODE_ICON_LENGTH} characters or fewer.`, 'warning');
    return;
  }
  await callbacks.setCustomModeAppearance({ icon: choice }, ctx);
}

async function applyModeCommand(pi: ExtensionAPI, callbacks: ModeCommandsCallbacks, raw: string, ctx: ExtensionCommandContext): Promise<void> {
  const modes = await callbacks.listCustomModes();
  if (raw.length === ZERO) {
    await applyModePickerChoice(callbacks, modes, ctx);
    return;
  }
  const { verb, rest } = splitModeArgs(raw);
  const byFullName = findCustomMode(modes, raw);
  if (rest.length > ZERO && byFullName !== undefined) {
    await callbacks.enterCustomMode(byFullName, ctx);
    return;
  }
  if (verb === COLOR_VERB) {
    await applyColorChoice(callbacks, rest, ctx);
    return;
  }
  if (verb === ICON_VERB) {
    await applyIconChoice(callbacks, rest, ctx);
    return;
  }
  if (OFF_WORDS.has(verb) && rest.length === ZERO) {
    await callbacks.exitCustomMode(ctx);
    return;
  }
  const canonical = canonicalModeName(verb);
  if (canonical !== undefined) {
    await callbacks.switchMode(canonical, ctx);
    if (rest.length > ZERO) {
      await submitModePrompt(pi, ctx, rest);
      return;
    }
    ctx.ui.notify(`Mode switched to ${formatModeLabel(canonical)}.`, 'info');
    return;
  }
  const byVerb = rest.length === ZERO ? byFullName : findCustomMode(modes, verb);
  if (byVerb !== undefined) {
    await callbacks.enterCustomMode(byVerb, ctx);
    if (rest.length > ZERO) {
      await submitModePrompt(pi, ctx, rest);
    }
    return;
  }
  // `chat`, `search`, and `default` are compatibility aliases, so a skill with that name wins.
  const alias = normalizeModeAlias(verb);
  if (alias !== undefined) {
    await callbacks.switchMode(alias, ctx);
    if (rest.length > ZERO) {
      await submitModePrompt(pi, ctx, rest);
      return;
    }
    ctx.ui.notify(`Mode switched to ${formatModeLabel(alias)}.`, 'info');
    return;
  }
  ctx.ui.notify(`Unknown mode "${raw}". Use: agent, plan, debug, ask, off, color, icon, or a skill-backed mode name.`, 'warning');
}

function registerModeCommand(pi: ExtensionAPI, callbacks: ModeCommandsCallbacks): void {
  pi.registerCommand('mode', {
    description: 'Switch execution mode, enter a skill-backed custom mode, or set its icon and color (agent, plan, debug, ask, off, color, icon)',
    getArgumentCompletions: async (argumentPrefix) => {
      const needle = argumentPrefix.trim().toLowerCase();
      const builtin = MODE_IDS.map((mode): AutocompleteItem => ({ value: mode, label: mode, description: MODE_SPECS[mode].description }));
      const custom = (await callbacks.listCustomModes()).map((mode): AutocompleteItem => ({ value: mode.id, label: mode.label, description: mode.description }));
      return [...builtin, ...custom, ...MODE_VERB_COMPLETIONS].filter((item) => item.value.toLowerCase().startsWith(needle));
    },
    handler: async (args, ctx) => {
      await applyModeCommand(pi, callbacks, CommandArgsSchema.parse(args).trim(), ctx);
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
        await submitModePrompt(pi, ctx, prompt);
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
        await submitModePrompt(pi, ctx, prompt);
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
