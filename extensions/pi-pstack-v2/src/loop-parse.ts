const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const MAX_SLUG_CHARS = 24;
const FALLBACK_PURPOSE = 'task';

export type LoopCommand =
  | { kind: 'usage' }
  | { kind: 'list' }
  | { kind: 'stop'; target: string }
  | { kind: 'fixed'; intervalSeconds: number; intervalLabel: string; prompt: string; purpose: string }
  | { kind: 'dynamic'; prompt: string; purpose: string };

type Unit = { label: string; seconds: number };
const SECOND: Unit = { label: 's', seconds: 1 };
const MINUTE: Unit = { label: 'm', seconds: SECONDS_PER_MINUTE };
const HOUR: Unit = { label: 'h', seconds: SECONDS_PER_HOUR };
const DAY: Unit = { label: 'd', seconds: SECONDS_PER_DAY };

const UNITS: Readonly<Record<string, Unit>> = {
  s: SECOND,
  sec: SECOND,
  secs: SECOND,
  second: SECOND,
  seconds: SECOND,
  m: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  h: HOUR,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  d: DAY,
  day: DAY,
  days: DAY,
};

const UNIT_WORDS = 'seconds|second|secs|sec|s|minutes|minute|mins|min|m|hours|hour|hrs|hr|h|days|day|d';
const LEADING_INTERVAL = new RegExp(`^(?:every\\s+)?(\\d+)\\s*(${UNIT_WORDS})(?:$|\\s+([\\s\\S]*))$`, 'i');
const TRAILING_INTERVAL = new RegExp(`^([\\s\\S]*\\S)\\s+every\\s+(\\d+)\\s*(${UNIT_WORDS})\\s*$`, 'i');

/** A lowercase kebab slug of up to 24 characters that names a loop, or `task` when the prompt has no word. */
export function slugifyPurpose(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, '');
  return slug === '' ? FALLBACK_PURPOSE : slug;
}

/** The line a loop's timer prints, and that its output watcher matches. */
export const sentinelFor = (kind: 'TICK' | 'WAKE', purpose: string): string => `AGENT_LOOP_${kind}_${purpose.toUpperCase().replaceAll('-', '_')}`;

type Interval = { intervalSeconds: number; intervalLabel: string };

function intervalOf(amount: string, word: string): Interval | undefined {
  const unit = UNITS[word.toLowerCase()];
  const count = Number(amount);
  if (!unit || !Number.isSafeInteger(count) || count < 1) return undefined;
  const intervalSeconds = count * unit.seconds;
  if (!Number.isSafeInteger(intervalSeconds)) return undefined;
  return { intervalSeconds, intervalLabel: `${count}${unit.label}` };
}

function fixed(interval: Interval, prompt: string): LoopCommand {
  const text = prompt.trim();
  return text === '' ? { kind: 'usage' } : { kind: 'fixed', ...interval, prompt: text, purpose: slugifyPurpose(text) };
}

function parseInterval(input: string): LoopCommand | undefined {
  const leading = LEADING_INTERVAL.exec(input);
  const lead = leading ? intervalOf(leading[1] ?? '', leading[2] ?? '') : undefined;
  if (lead) return fixed(lead, leading?.[3] ?? '');
  const trailing = TRAILING_INTERVAL.exec(input);
  const trail = trailing ? intervalOf(trailing[2] ?? '', trailing[3] ?? '') : undefined;
  return trail ? fixed(trail, trailing?.[1] ?? '') : undefined;
}

const STOP_COMMAND = /^stop(?:\s+([\s\S]+))?$/i;

/** Parses the argument text of `/loop` into the one thing it asks for. */
export function parseLoopArgs(args: string): LoopCommand {
  const input = args.trim();
  if (input === '') return { kind: 'usage' };
  if (input.toLowerCase() === 'list') return { kind: 'list' };
  const stop = STOP_COMMAND.exec(input);
  if (stop) return { kind: 'stop', target: stop[1]?.trim() || 'all' };
  return parseInterval(input) ?? { kind: 'dynamic', prompt: input, purpose: slugifyPurpose(input) };
}
