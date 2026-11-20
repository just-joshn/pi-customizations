import { parseArgs } from 'node:util';

import { z } from 'zod';
import type { JsonObject } from './json.ts';
import type { Extractor, Metric } from './metric-types.ts';
import { field, formatFixed, formatPercent, median, metric, numberAt, percentileField, readRecords, requireValue, stringAt, sumOf, write } from './stats.ts';

/** Print the stock comparison summary: medians, paired differences, and both verdicts for each headline metric. */
const ARGV_USER_START = 2;
const MEDIAN_P = 50;
const TAIL_P = 95;
const MAGNITUDE_LARGE = 100;
const MAGNITUDE_MEDIUM = 10;
const DIGITS_MEDIUM = 1;
const DIGITS_SMALL = 2;
const PERCENT_DIGITS = 1;
const DEFAULT_WORKLOAD = 'stream';
const NO_DIFFERENCE = 'no measurable difference';
const USAGE_INDENT_WIDTH = 18;
const USAGE_INDENT = ' '.repeat(USAGE_INDENT_WIDTH);
const HELP_INDENT_WIDTH = 23;
const HELP_INDENT = ' '.repeat(HELP_INDENT_WIDTH);
const USAGE = `usage: summary.ts [-h] [--config CONFIG] [--baseline BASELINE]
${USAGE_INDENT}files [files ...]

Print the stock comparison summary: medians, paired differences, and both
verdicts for each headline metric.

positional arguments:
  files                label=results.jsonl; the label names the scenario, the
${HELP_INDENT}workload comes from the records

options:
  -h, --help           show this help message and exit
  --config CONFIG
  --baseline BASELINE`;
/** Rounds out of n that one side must win for a one-sided sign test at p < 0.07. */
const ROUNDS_LARGE = 15;
const WINS_LARGE = 13;
const ROUNDS_MEDIUM = 9;
const WINS_MEDIUM = 7;
const ROUNDS_SMALL = 7;
const WINS_SMALL = 6;
const ROUNDS_MIN = 5;
const WINS_MIN = 5;
const SIGN_THRESHOLD = new Map([
  [ROUNDS_LARGE, WINS_LARGE],
  [ROUNDS_MEDIUM, WINS_MEDIUM],
  [ROUNDS_SMALL, WINS_SMALL],
  [ROUNDS_MIN, WINS_MIN],
]);

const processCpu = (key: string): Extractor => sumOf(field(key, 'user'), field(key, 'sys'));

const STREAM: Metric[] = [
  metric('Workload CPU ms', sumOf(field('workload', 'cpuUserMs'), field('workload', 'cpuSystemMs'))),
  metric('Echo p50 ms', percentileField(['echo', 'latenciesMs'], MEDIAN_P)),
  metric('Workload PTY bytes', field('pty', 'workloadBytes')),
  metric('Clean idle CPU ms', sumOf(field('cleanIdle', 'cpuUserMs'), field('cleanIdle', 'cpuSystemMs'))),
];
const RESTORED: Metric[] = [
  metric('Whole-run CPU ms', processCpu('cpuMs')),
  metric('Restore (startup settle) ms', field('steps', 'startup', 'ms')),
  metric('Collapsed echo p50 ms', percentileField(['collapsedEcho', 'latenciesMs'], MEDIAN_P)),
  metric('Collapsed echo p95 ms', percentileField(['collapsedEcho', 'latenciesMs'], TAIL_P)),
  metric('Burst of 50 keys ms', field('burst', 'ms')),
  metric('Resize narrow ms', field('steps', 'narrow', 'ms')),
  metric('Resize wide ms', field('steps', 'wide', 'ms')),
  metric('Resize storm ms', field('steps', 'storm', 'ms')),
  metric('Expand ms', field('steps', 'expand', 'ms')),
  metric('Expanded echo p50 ms', percentileField(['echo', 'latenciesMs'], MEDIAN_P)),
  metric('Collapse ms', field('steps', 'collapse', 'ms')),
];
const METRICS = new Map<string, Metric[]>([
  ['startup', [metric('Process CPU ms, spawn to exit', processCpu('cpuMs')), metric('First settled frame ms', field('startup', 'ms'))]],
  ['stream', STREAM],
  ['medium', STREAM],
  ['long', RESTORED],
  ['mixed', RESTORED],
]);

const Args = z
  .object({
    values: z.object({ help: z.boolean().optional(), config: z.string().default('full'), baseline: z.string().default('stock') }),
    positionals: z.array(z.string()),
  })
  .transform(({ values, positionals }) => ({ help: values.help === true, config: values.config, baseline: values.baseline, files: positionals }));

function num(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= MAGNITUDE_LARGE) return formatFixed(value, 0);
  return formatFixed(value, magnitude >= MAGNITUDE_MEDIUM ? DIGITS_MEDIUM : DIGITS_SMALL);
}

const roundsOf = (records: readonly JsonObject[], config: string): Map<number, JsonObject> =>
  new Map(records.filter((record) => stringAt(record, 'config') === config).map((record): [number, JsonObject] => [numberAt(record, 'round'), record]));

function verdicts(deltas: readonly number[], roundCount: number): readonly [string, string] {
  const lower = deltas.filter((delta) => delta < 0).length;
  const higher = deltas.filter((delta) => delta > 0).length;
  const strict = Math.max(...deltas) < 0 ? 'faster' : Math.min(...deltas) > 0 ? 'slower' : NO_DIFFERENCE;
  const need = SIGN_THRESHOLD.get(roundCount);
  if (need === undefined) throw new Error(`no sign-test threshold for ${roundCount} rounds`);
  const sign = lower >= need ? 'faster' : higher >= need ? 'slower' : NO_DIFFERENCE;
  return [strict, sign];
}

interface Sides {
  readonly baseline: Map<number, JsonObject>;
  readonly config: Map<number, JsonObject>;
}

function metricRow(label: string, item: Metric, sides: Sides, names: { readonly baseline: string; readonly config: string }): string {
  const rounds = [...sides.baseline.keys()].filter((round) => sides.config.has(round)).toSorted((a, b) => a - b);
  const pick = (side: Map<number, JsonObject>): number[] => rounds.map((round) => requireValue(item.extract, side.get(round) ?? {}));
  const base = pick(sides.baseline);
  const other = pick(sides.config);
  if (rounds.length === 0) throw new Error(`no rounds shared by ${names.baseline} and ${names.config}`);
  const deltas = other.map((value, index) => value - (base[index] ?? 0));
  const lower = deltas.filter((delta) => delta < 0).length;
  const [strict, sign] = verdicts(deltas, rounds.length);
  const baseMedian = median(base);
  if (baseMedian === 0) throw new Error('division by zero: the baseline median is 0');
  const change = formatPercent(median(other) / baseMedian - 1, PERCENT_DIGITS, true);
  const paired = `${num(median(deltas))} (${num(Math.min(...deltas))}..${num(Math.max(...deltas))})`;
  return `| ${label} | ${item.name} | ${num(baseMedian)} | ${num(median(other))} | ${paired} | ${lower}/${rounds.length} | ${change} | ${strict} | ${sign} |`;
}

function specRows(spec: string, names: { readonly baseline: string; readonly config: string }): string[] {
  const separator = spec.indexOf('=');
  if (separator < 0) throw new Error(`expected label=results.jsonl, got ${spec}`);
  const records = readRecords(spec.slice(separator + 1));
  const first = records[0];
  if (first === undefined) throw new Error(`${spec.slice(separator + 1)} has no records`);
  const workload = typeof first['workloadName'] === 'string' ? first['workloadName'] : DEFAULT_WORKLOAD;
  const metrics = METRICS.get(workload);
  if (metrics === undefined) throw new Error(`unknown workload ${workload}`);
  const sides = { baseline: roundsOf(records, names.baseline), config: roundsOf(records, names.config) };
  return metrics.map((item) => metricRow(spec.slice(0, separator), item, sides, names));
}

function main(): void {
  const args = Args.parse(parseArgs({ args: process.argv.slice(ARGV_USER_START), options: { help: { type: 'boolean', short: 'h' }, config: { type: 'string' }, baseline: { type: 'string' } }, allowPositionals: true }));
  if (args.help) {
    write([USAGE]);
    return;
  }
  if (args.files.length === 0) throw new Error('summary.ts needs at least one label=results.jsonl');
  const { baseline, config } = args;
  const header = [
    `| Scenario | Metric | ${baseline} median | ${config} median | ${config}-${baseline} paired median (min..max) | rounds ${config} lower | change of medians | verdict (a) strict | verdict (b) sign test |`,
    '|---|---|---|---|---|---|---|---|---|',
  ];
  write([...header, ...args.files.flatMap((spec) => specRows(spec, { baseline, config }))]);
}

main();
