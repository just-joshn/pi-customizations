import Type from 'typebox';
import { Check } from 'typebox/value';

export const TimerSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  prompt: Type.String({ minLength: 1 }),
  delaySeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 31536000 })),
  cron: Type.Optional(Type.String({ minLength: 1 })),
  timezone: Type.Optional(Type.String({ minLength: 1 })),
  runImmediately: Type.Optional(Type.Boolean()),
});

function field(text, minimum, maximum) {
  const values = text.split(',').flatMap((part) => {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`Invalid cron field: ${text}`);
    const step = Number(match[2] ?? 1);
    const bounds = match[1] === '*' ? [minimum, maximum] : match[1].split('-').map(Number);
    const [start, end = match[2] ? maximum : start] = bounds;
    if (!Number.isInteger(step) || step < 1 || start < minimum || end > maximum || start > end) throw new Error(`Invalid cron range: ${text}`);
    return Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, index) => start + index * step);
  });
  return { values: [...new Set(values)], wildcard: text.startsWith('*') };
}

function cronFields(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron requires five fields: minute hour day month weekday.');
  return parts.map((part, index) => field(part, [0, 0, 1, 1, 0][index], [59, 23, 31, 12, 7][index]));
}

export function parseTimer(input) {
  if (!Check(TimerSchema, input) || !input.name.trim() || !input.prompt.trim()) throw new Error('Invalid timer: name and prompt are required.');
  if ((input.delaySeconds !== undefined) === (input.cron !== undefined)) throw new Error('Provide exactly one of delaySeconds or cron.');
  if (input.delaySeconds !== undefined && !Number.isFinite(input.delaySeconds)) throw new Error('Timer delay must be finite.');
  if (input.timezone && !input.cron) throw new Error('Timezone applies only to cron schedules.');
  if (input.cron) cronFields(input.cron);
  new Intl.DateTimeFormat('en-US', { timeZone: input.timezone ?? 'UTC' });
  return { ...input };
}

function matchesDay(fields, day, weekday) {
  const dom = fields[2].values.includes(day);
  const dow = fields[4].values.some((value) => value % 7 === weekday);
  return fields[2].wildcard || fields[4].wildcard ? dom && dow : dom || dow;
}

export function nextOccurrence(timer, after) {
  if (!Number.isFinite(after)) throw new Error('Invalid timer clock.');
  if (timer.delaySeconds !== undefined) return after + timer.delaySeconds * 1000;
  const fields = cronFields(timer.cron ?? '');
  const format = new Intl.DateTimeFormat('en-US', { timeZone: timer.timezone ?? 'UTC', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const limit = after + 8 * 366 * 86400000;
  for (let time = Math.floor(after / 60000) * 60000 + 60000; time <= limit;) {
    const parts = Object.fromEntries(format.formatToParts(time).map((part) => [part.type, part.value]));
    const minute = Number(parts.minute);
    const calendar = fields[3].values.includes(Number(parts.month)) && matchesDay(fields, Number(parts.day), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday));
    if (calendar && fields[1].values.includes(Number(parts.hour)) && fields[0].values.includes(minute)) return time;
    time += (!calendar || !fields[1].values.includes(Number(parts.hour)) ? 60 - minute : 1) * 60000;
  }
  throw new Error('Cron schedule has no occurrence within eight years.');
}
