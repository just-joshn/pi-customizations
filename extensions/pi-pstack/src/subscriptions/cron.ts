/** A 5-field cron expression (minute hour day-of-month month day-of-week), matched against local time. */
export interface CronSchedule {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
  /** Standard cron: when both day fields are restricted, a time matches when either one does. */
  dayOr: boolean;
}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: readonly string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FIELDS: readonly FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS },
  // 7 is Sunday too, as in Vixie cron.
  { name: 'day-of-week', min: 0, max: 7, names: WEEKDAYS },
];

function value(text: string, spec: FieldSpec): number {
  const named = spec.names?.indexOf(text.toLowerCase()) ?? -1;
  const number = named >= 0 ? named + (spec.name === 'month' ? 1 : 0) : /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(number) || number < spec.min || number > spec.max) throw new Error(`Cron ${spec.name} value "${text}" is outside ${spec.min}-${spec.max}.`);
  return number;
}

function parseField(text: string, spec: FieldSpec): Set<number> {
  const result = new Set<number>();
  for (const part of text.split(',')) {
    const match = /^([^/]+)(?:\/(\d+))?$/.exec(part);
    if (match === null) throw new Error(`Cron ${spec.name} field "${text}" is malformed.`);
    const [, range = '', stepText] = match;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) throw new Error(`Cron ${spec.name} step must be at least 1.`);
    let low: number;
    let high: number;
    if (range === '*') [low, high] = [spec.min, spec.max];
    else if (range.includes('-')) {
      const [from = '', to = ''] = range.split('-');
      [low, high] = [value(from, spec), value(to, spec)];
      if (low > high) throw new Error(`Cron ${spec.name} range "${range}" runs backwards.`);
    } else {
      low = value(range, spec);
      // "5/15" means every 15 starting at 5, through the end of the field.
      high = stepText === undefined ? low : spec.max;
    }
    for (let n = low; n <= high; n += step) result.add(n);
  }
  return result;
}

export function parseCron(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron "${expression}" needs 5 fields (minute hour day-of-month month day-of-week); it has ${parts.length}.`);
  const [minutes, hours, days, months, weekdays] = FIELDS.map((spec, index) => parseField(parts[index] ?? '', spec)) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (weekdays.delete(7)) weekdays.add(0);
  return { minutes, hours, days, months, weekdays, dayOr: !parts[2]?.startsWith('*') && !parts[4]?.startsWith('*') };
}

export function cronMatches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minutes.has(date.getMinutes()) || !schedule.hours.has(date.getHours()) || !schedule.months.has(date.getMonth() + 1)) return false;
  const day = schedule.days.has(date.getDate());
  const weekday = schedule.weekdays.has(date.getDay());
  return schedule.dayOr ? day || weekday : day && weekday;
}
