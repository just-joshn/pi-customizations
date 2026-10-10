import type { ConfigEntry } from './config-files.ts';
import { type Assignment, readConfig, readEnvironment, readFlags, type SourceReading } from './sources.ts';
import type { AnyOptionSpec, OptionSpec, RawValue, ResolvedSettings } from './spec.ts';

export interface ConfigSource {
  readonly path: string;
  readonly entries: readonly ConfigEntry[];
}

export interface SettingsSources {
  /** Pi's `getFlag` for the registered extension flags. */
  readonly getFlag: (name: string) => boolean | string | undefined;
  /** The process environment with `.env` values applied over it. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly environmentPrefix: string;
  /** Config files, lowest precedence first: home, Git root, cwd, then `--config`. */
  readonly configs: readonly ConfigSource[];
}

export interface Resolution {
  readonly settings: ResolvedSettings;
  readonly problems: readonly string[];
}

interface Level {
  readonly source: string;
  readonly reading: SourceReading;
}

type Winner = { readonly raw: RawValue; readonly source: string };

/** Every assignment a level makes to one option, collapsed the way argparse applies them in order. */
function levelValue(spec: AnyOptionSpec, assignments: readonly Assignment[]): RawValue | null {
  const own = assignments.filter((assignment) => assignment.spec === spec);
  if (spec.kind !== 'list') return own.at(-1)?.raw ?? null;
  const items = own.flatMap((assignment) => (assignment.raw.kind === 'items' ? assignment.raw.items : assignment.raw.kind === 'text' ? [assignment.raw.text] : []));
  return own.length === 0 ? null : { kind: 'items', items };
}

/** The highest-precedence level that sets the option with a value the option accepts. */
function winner(spec: AnyOptionSpec, levels: readonly Level[]): { readonly won: Winner | null; readonly problems: readonly string[] } {
  const problems: string[] = [];
  for (const level of levels.toReversed()) {
    const raw = levelValue(spec, level.reading.assignments);
    if (raw === null) continue;
    const decoded = spec.decode(raw);
    if (decoded.ok) return { won: { raw, source: level.source }, problems };
    problems.push(`${level.source}: ${decoded.error}`);
  }
  return { won: null, problems };
}

/**
 * configargparse precedence for every option: Pi flag, then `PI_MAINTAINER_<NAME>`, then the
 * config files with later files winning, then Aider's default. Invalid values are reported and
 * skipped where Aider would exit.
 */
export function resolveSettings(specs: readonly AnyOptionSpec[], sources: SettingsSources): Resolution {
  const levels: Level[] = [
    ...sources.configs.map((config) => ({ source: config.path, reading: readConfig(specs, config.entries, config.path) })),
    { source: 'env', reading: readEnvironment(specs, sources.environment, sources.environmentPrefix) },
    { source: 'cli', reading: readFlags(specs, sources.getFlag) },
  ];
  const results = specs.map((spec) => [spec, winner(spec, levels)] as const);
  const winners = new Map(results.map(([spec, result]) => [spec, result.won] as const));
  const problems = [...levels.flatMap((level) => level.reading.problems), ...results.flatMap(([, result]) => result.problems)];
  const settings: ResolvedSettings = {
    value<T>(option: OptionSpec<T>): T {
      const won = winners.get(option);
      if (won === undefined) throw new Error(`option --${option.name} is not registered`);
      if (won === null) return option.defaultValue;
      const decoded = option.decode(won.raw);
      return decoded.ok ? decoded.value : option.defaultValue;
    },
    source(option) {
      return winners.get(option)?.source ?? 'default';
    },
  };
  return { settings, problems };
}
