import { parseArgs } from 'node:util';

import { z } from 'zod';
import type { JsonObject } from './json.ts';
import type { Extractor, Metric } from './metric-types.ts';
import { field, formatFixed, groupBy, maxField, median, metric, numberAt, percentileField, readRecords, requireValue, stringAt, sumOf, sumOfStepField, write } from './stats.ts';

const ARGV_USER_START = 2;
const DEFAULT_RESULTS = 'results.jsonl';
const DEFAULT_WORKLOAD = 'stream';
const CONFIG_ORDER = ['stock', 'theme', 'full'];
const BASELINE = 'stock';
const MEDIAN_P = 50;
const TAIL_P = 95;
const MAGNITUDE_LARGE = 100;
const MAGNITUDE_MEDIUM = 10;
const DIGITS_MEDIUM = 1;
const DIGITS_SMALL = 2;
const USAGE = `usage: report.ts [-h] [results]

Summarize run.py results as Markdown tables, one section per workload.

positional arguments:
  results

options:
  -h, --help  show this help message and exit`;

const cpu = (phase: string): Extractor => sumOf(field(phase, 'cpuUserMs'), field(phase, 'cpuSystemMs'));
const processCpu = (key: string): Extractor => sumOf(field(key, 'user'), field(key, 'sys'));

const STREAM_METRICS: Metric[] = [
  metric('Workload CPU ms (user+sys)', cpu('workload')),
  metric('Idle CPU ms over 10 s', cpu('idle')),
  metric('Workload event-loop delay p50 ms', field('workload', 'eldP50Ms')),
  metric('Workload event-loop delay p99 ms', field('workload', 'eldP99Ms')),
  metric('Idle event-loop delay p50 ms', field('idle', 'eldP50Ms')),
  metric('Idle event-loop delay p99 ms', field('idle', 'eldP99Ms')),
  metric('Echo latency p50 ms', percentileField(['echo', 'latenciesMs'], MEDIAN_P)),
  metric('Echo latency p95 ms', percentileField(['echo', 'latenciesMs'], TAIL_P)),
  metric('Echo misses', field('echo', 'misses')),
  metric('PTY bytes, workload', field('pty', 'workloadBytes')),
  metric('PTY bytes, idle 10 s', field('pty', 'idleBytes')),
  metric('PTY bytes, idle after first 1 s', field('pty', 'idleLateBytes')),
  metric('Clean idle CPU ms over 10 s, no sampler', cpu('cleanIdle')),
  // biome-ignore lint/security/noSecrets: benchmark record field name
  metric('Clean idle involuntary context switches', field('cleanIdle', 'involuntaryContextSwitches')),
  metric('PTY bytes, clean idle 10 s', field('pty', 'cleanIdleBytes')),
  metric('Tool results', field('toolResults')),
  metric('Tool errors', field('toolErrors')),
  metric('Workload wall ms', field('workload', 'wallMs')),
];
const LONG_STEPS = ['startup', 'narrow', 'wide', 'expand', 'collapse', 'storm'];
const LONG_METRICS: Metric[] = [
  metric('Process CPU ms (user+sys), whole run', processCpu('cpuMs')),
  metric('Collapsed echo latency p50 ms', percentileField(['collapsedEcho', 'latenciesMs'], MEDIAN_P)),
  metric('Collapsed echo latency p95 ms', percentileField(['collapsedEcho', 'latenciesMs'], TAIL_P)),
  metric('Collapsed echo latency max ms', maxField(['collapsedEcho', 'latenciesMs'])),
  metric('Collapsed echo misses', field('collapsedEcho', 'misses')),
  metric('Burst of 50 keys, ms to full echo', field('burst', 'ms')),
  metric('Burst PTY bytes', field('burst', 'bytes')),
  metric('Burst echoed', field('burst', 'echoed')),
  metric('Expanded echo latency p50 ms', percentileField(['echo', 'latenciesMs'], MEDIAN_P)),
  metric('Expanded echo latency p95 ms', percentileField(['echo', 'latenciesMs'], TAIL_P)),
  metric('Expanded echo misses', field('echo', 'misses')),
  ...LONG_STEPS.map((step) => metric(`${step} settle ms`, field('steps', step, 'ms'))),
  ...LONG_STEPS.map((step) => metric(`${step} PTY bytes`, field('steps', step, 'bytes'))),
  metric('Exit PTY bytes', field('exitBytes')),
  metric('Steps with output', sumOfStepField('output')),
];
const STARTUP_METRICS: Metric[] = [
  metric('First settled frame ms', field('startup', 'ms')),
  metric('First frame PTY bytes', field('startup', 'bytes')),
  metric('Process CPU ms (user+sys), spawn to exit', processCpu('cpuMs')),
  metric('Exit PTY bytes', field('exitBytes')),
  metric('PI_TIMING main TOTAL ms', field('timingsMs', 'main', 'TOTAL')),
  metric('PI_TIMING createAgentSessionRuntime ms', field('timingsMs', 'main', 'createAgentSessionRuntime')),
  metric('PI_TIMING initTheme ms', field('timingsMs', 'main', 'initTheme')),
  metric('PI_TIMING interactiveMode.init ms', field('timingsMs', 'main', 'interactiveMode.init')),
  metric('PI_TIMING extensions TOTAL ms', field('timingsMs', 'extensions', 'TOTAL')),
  metric('PI_STARTUP_BENCHMARK process CPU ms', processCpu('timingCpuMs')),
];
const WORKLOADS: readonly (readonly [string, Metric[]])[] = [
  ['stream', STREAM_METRICS],
  ['medium', STREAM_METRICS],
  ['long', LONG_METRICS],
  ['mixed', LONG_METRICS],
  ['startup', STARTUP_METRICS],
];

const Args = z.object({ values: z.object({ help: z.boolean().optional() }), positionals: z.array(z.string()).max(1) }).transform(({ values, positionals }) => ({ help: values.help === true, results: positionals[0] ?? DEFAULT_RESULTS }));

const workloadOf = (record: JsonObject): string => (typeof record['workloadName'] === 'string' ? record['workloadName'] : DEFAULT_WORKLOAD);

function digitsFor(values: readonly number[]): number {
  const magnitude = Math.max(...values.map((value) => Math.abs(value)));
  if (values.every((value) => Number.isInteger(value)) || magnitude >= MAGNITUDE_LARGE) return 0;
  return magnitude >= MAGNITUDE_MEDIUM ? DIGITS_MEDIUM : DIGITS_SMALL;
}

/** Median and min..max of the values, with as many digits as their size calls for. */
function cell(values: readonly number[]): string {
  if (values.length === 0) throw new Error('cell of an empty list');
  const digits = digitsFor(values);
  return `${formatFixed(median(values), digits)} (${formatFixed(Math.min(...values), digits)}..${formatFixed(Math.max(...values), digits)})`;
}

const present = (item: Metric, records: readonly JsonObject[]): boolean => records.every((record) => item.extract(record) !== undefined);

const header = (labels: readonly string[]): string[] => [`| Metric | ${labels.join(' | ')} |`, `|---|${'---|'.repeat(labels.length)}`];

function pairedTable(runs: Map<string, JsonObject[]>, configs: readonly string[], metrics: readonly Metric[]): string[] {
  const others = configs.filter((config) => config !== BASELINE);
  const baseline = new Map((runs.get(BASELINE) ?? []).map((record): [number, JsonObject] => [numberAt(record, 'round'), record]));
  const rows = metrics.map((item) => {
    const cells = others.map((config) => {
      const deltas = (runs.get(config) ?? []).flatMap((record) => {
        const base = baseline.get(numberAt(record, 'round'));
        return base === undefined ? [] : [requireValue(item.extract, record) - requireValue(item.extract, base)];
      });
      return `${cell(deltas)}, lower ${deltas.filter((delta) => delta < 0).length}/${deltas.length}`;
    });
    return `| ${item.name} | ${cells.join(' | ')} |`;
  });
  return [`\nPaired by round: config minus ${BASELINE}, median (min..max), and rounds where the config was lower.\n`, ...header(others), ...rows];
}

function table(runs: Map<string, JsonObject[]>, failed: Map<string, number>, metrics: readonly Metric[]): string[] {
  const configs = [...CONFIG_ORDER.filter((config) => runs.has(config)), ...[...runs.keys()].filter((config) => !CONFIG_ORDER.includes(config)).toSorted()];
  const labels = configs.map((config) => {
    const records = runs.get(config) ?? [];
    return `${config} (n=${records.length}, failed=${failed.get(config) ?? 0}, problems=${records.filter((record) => Object.hasOwn(record, 'problems')).length})`;
  });
  const rows = metrics.map((item) => `| ${item.name} | ${configs.map((config) => cell((runs.get(config) ?? []).map((record) => requireValue(item.extract, record)))).join(' | ')} |`);
  const main = ['Median (min..max) per config.\n', ...header(labels), ...rows];
  if (!runs.has(BASELINE) || configs.every((config) => config === BASELINE)) return main;
  return [...main, ...pairedTable(runs, configs, metrics)];
}

function workloadSection(workload: string, metrics: readonly Metric[], records: readonly JsonObject[]): string[] {
  const failedRecords = records.filter((record) => Object.hasOwn(record, 'error'));
  const failed = new Map([...groupBy(failedRecords, (record) => stringAt(record, 'config'))].map(([config, group]): [string, number] => [config, group.length]));
  const runs = groupBy(
    records.filter((record) => !Object.hasOwn(record, 'error')),
    (record) => stringAt(record, 'config'),
  );
  const shown = metrics.filter((item) => present(item, [...runs.values()].flat()));
  return [`### ${workload} workload\n`, ...table(runs, failed, shown), ''];
}

function main(): void {
  const args = Args.parse(parseArgs({ args: process.argv.slice(ARGV_USER_START), options: { help: { type: 'boolean', short: 'h' } }, allowPositionals: true }));
  if (args.help) {
    write([USAGE]);
    return;
  }
  const byWorkload = groupBy(readRecords(args.results), workloadOf);
  write(WORKLOADS.filter(([workload]) => byWorkload.has(workload)).flatMap(([workload, metrics]) => workloadSection(workload, metrics, byWorkload.get(workload) ?? [])));
}

main();
