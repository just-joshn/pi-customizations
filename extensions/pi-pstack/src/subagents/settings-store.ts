import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { type CopilotSettings, parseCopilotSettings, type SubagentSettingsEntry } from './settings.ts';

export type SettingsUpdate = Readonly<{ agents?: Readonly<Record<string, SubagentSettingsEntry>>; disabledSubagents?: readonly string[]; contextManagementTools?: boolean }>;

type Entries = Readonly<Record<string, SubagentSettingsEntry>>;

function mergeEntries(left: Entries | undefined, right: Entries | undefined): Entries {
  const names = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])];
  return Object.fromEntries(names.map((name) => [name, { ...left?.[name], ...right?.[name] }]));
}

function merged(base: CopilotSettings, update: SettingsUpdate): CopilotSettings {
  return {
    ...base,
    subagents: {
      ...base.subagents,
      agents: mergeEntries(base.subagents.agents, update.agents),
      disabledSubagents: update.disabledSubagents ?? base.subagents.disabledSubagents,
      contextManagementTools: update.contextManagementTools ?? base.subagents.contextManagementTools,
    },
  };
}

/** Settings read from the pi settings files at each use, with the live overrides of updateSubagentSettings layered on top. */
export class SettingsStore {
  private override: SettingsUpdate = {};

  constructor(private readonly load: (cwd: string) => unknown = (cwd) => SettingsManager.create(cwd, getAgentDir()).getSettings()) {}

  read(cwd: string): { settings: CopilotSettings; warnings: readonly string[]; raw: unknown } {
    const raw = this.load(cwd);
    const { settings, warnings } = parseCopilotSettings(raw);
    return { settings: merged(settings, this.override), warnings, raw };
  }

  update(update: SettingsUpdate): void {
    this.override = { ...this.override, ...update, agents: mergeEntries(this.override.agents, update.agents) };
  }
}
