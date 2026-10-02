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

const savedKeys = ['subagents', 'builtInAgents'] as const;

/**
 * Pi's merged settings for the session, which already honour project trust, with the preferences saved by /subagents and the live
 * overrides of updateSubagentSettings layered on top. Pi reads its settings files once, so saved edits need the overlay to apply at once.
 */
export class SettingsStore {
  private override: SettingsUpdate = {};
  private saved: Readonly<Record<string, unknown>> = {};

  constructor(private readonly load: () => object) {}

  read(): { settings: CopilotSettings; warnings: readonly string[]; raw: unknown } {
    const raw = { ...this.load(), ...this.saved };
    const { settings, warnings } = parseCopilotSettings(raw);
    return { settings: merged(settings, this.override), warnings, raw };
  }

  adopt(written: Readonly<Record<string, unknown>>): void {
    this.saved = Object.fromEntries(savedKeys.flatMap((key) => (key in written ? [[key, written[key]]] : [])));
  }

  update(update: SettingsUpdate): void {
    this.override = { ...this.override, ...update, agents: mergeEntries(this.override.agents, update.agents) };
  }
}
