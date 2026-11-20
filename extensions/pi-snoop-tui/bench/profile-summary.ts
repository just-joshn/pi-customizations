import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';
import { basename, pySum, sumBy, type Total } from './aggregate.ts';
import { collectSamples, FILE_PREFIX, IDLE_FRAMES, parseProfile, type Sample, windowFor } from './profile-collect.ts';
import { classIndex } from './profile-scan.ts';
import { formatFixed, formatPercent, lastRecord, write } from './stats.ts';

/** Top self-time functions and per-class buckets across .cpuprofile files. */
const ARGV_USER_START = 2;
const DEFAULT_TOP = 15;
const TOP_MATCHED = 10;
const NAME_WIDTH = 60;
const PROFILE_SUFFIX = '.cpuprofile';
const KEY_SEPARATOR = '\u0000';
const INTEGER_ARG = /^\s*[+-]?\d+\s*$/;
const PERCENT_DIGITS = 1;
const MATCH_PERCENT_DIGITS = 2;
const USAGE_INDENT_WIDTH = 26;
const USAGE_INDENT = ' '.repeat(USAGE_INDENT_WIDTH);
const HELP_INDENT_WIDTH = 21;
const HELP_INDENT = ' '.repeat(HELP_INDENT_WIDTH);
const USAGE = `usage: profile-summary.ts [-h] [--top TOP] [--record RECORD] [--phase PHASE]
${USAGE_INDENT}[--callers CALLERS] [--match MATCH]
${USAGE_INDENT}profile_dir

Top self-time functions and per-class buckets across .cpuprofile files.

positional arguments:
  profile_dir

options:
  -h, --help         show this help message and exit
  --top TOP
  --record RECORD    run.py JSONL; its last record's window limits the samples
  --phase PHASE      window in the record: workload, idle, cleanIdle, startup,
${HELP_INDENT}typing, expandedTyping, burst, or a long step name
  --callers CALLERS  print the call chains above samples whose leaf function
${HELP_INDENT}has this name
  --match MATCH      path fragment that marks extension code`;

const Args = z
  .object({
    values: z.object({
      help: z.boolean().optional(),
      top: z.string().regex(INTEGER_ARG).transform(Number).default(DEFAULT_TOP),
      record: z.string().optional(),
      phase: z.string().default('workload'),
      callers: z.string().optional(),
      match: z.string().default('pi-snoop-tui/src/'),
    }),
    positionals: z.array(z.string()).max(1),
  })
  .transform(({ values, positionals }) => ({ ...values, help: values.help === true, record: values.record || undefined, callers: values.callers || undefined, profileDir: positionals[0] }));

type Args = z.infer<typeof Args>;
type Row = Total<Sample>;

const share = (ms: number, busyMs: number, digits = PERCENT_DIGITS): string => formatPercent(ms / busyMs, digits);
const topRows = <T>(rows: readonly Total<T>[], top: number): Total<T>[] => rows.toSorted((a, b) => b.total - a.total).slice(0, top);
const nameOf = (location: string): string => basename(location);

function bucketTable(title: string, rows: readonly Row[], busyMs: number, top: number, labelOf: (row: Row) => string): string[] {
  const lines = topRows(rows, top).map((row) => `| ${formatFixed(row.total, 1)} | ${share(row.total, busyMs)} | \`${labelOf(row)}\` |`);
  return [`\n${title}\n`, '| ms | Share of busy | Name |', '|---:|---:|---|', ...lines];
}

const functionLine = (row: Row, busyMs: number): string => `| ${formatFixed(row.total, 1)} | ${share(row.total, busyMs)} | \`${row.item.name.slice(0, NAME_WIDTH)}\` | \`${nameOf(row.item.location)}\` |`;

function matchedLines(functions: readonly Row[], match: string, busyMs: number): string[] {
  const matched = functions.filter((row) => row.item.location.includes(match));
  const matchedMs = pySum(matched.map((row) => row.total));
  const heading = `\nFrames matching \`${match}\`: ${matched.length} functions, ${formatFixed(matchedMs, 1)} ms self, ${share(matchedMs, busyMs, MATCH_PERCENT_DIGITS)} of busy time`;
  return [heading, ...topRows(matched, TOP_MATCHED).map((row) => `- ${formatFixed(row.total, 1)} ms \`${row.item.name}\` \`${nameOf(row.item.location)}\``)];
}

function reportLines(args: Args, samples: readonly Sample[], functions: readonly Row[], busyMs: number): string[] {
  const group = (keyOf: (sample: Sample) => string) => sumBy(samples, keyOf, (sample) => sample.ms);
  const inclusive = sumBy(
    samples.flatMap((sample) => sample.classes.map((cls) => ({ ...sample, name: cls }))),
    (sample) => sample.name,
    (sample) => sample.ms,
  );
  const callers = sumBy(
    samples.filter((sample) => sample.chain !== undefined),
    (sample) => sample.chain ?? '',
    (sample) => sample.ms,
  );
  const functionRows = topRows(functions, args.top).map((row) => functionLine(row, busyMs));
  return [
    '| Self ms | Share of busy | Function | Location |',
    '|---:|---:|---|---|',
    ...functionRows,
    ...bucketTable(
      'Self time by owner (innermost class on the stack)',
      group((sample) => sample.owner),
      busyMs,
      args.top,
      (row) => row.item.owner,
    ),
    ...bucketTable('Inclusive time by class (each class counted once per sample)', inclusive, busyMs, args.top, (row) => row.item.name),
    ...bucketTable(
      'Self time by file',
      group((sample) => sample.file),
      busyMs,
      args.top,
      (row) => row.item.file,
    ),
    ...(args.callers === undefined ? [] : bucketTable(`Callers of \`${args.callers}\``, callers, busyMs, args.top, (row) => row.item.chain ?? '')),
    ...matchedLines(functions, args.match, busyMs),
  ];
}

function loadProfiles(dir: string) {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(PROFILE_SUFFIX))
    .toSorted();
  return names.map((name) => parseProfile(readFileSync(join(dir, name), 'utf8')));
}

const idleRepr = (): string =>
  `[${[...IDLE_FRAMES]
    .toSorted()
    .map((frame) => `'${frame}'`)
    .join(', ')}]`;

function main(): void {
  const args = Args.parse(
    parseArgs({
      args: process.argv.slice(ARGV_USER_START),
      options: {
        help: { type: 'boolean', short: 'h' },
        top: { type: 'string' },
        record: { type: 'string' },
        phase: { type: 'string' },
        callers: { type: 'string' },
        match: { type: 'string' },
      },
      allowPositionals: true,
    }),
  );
  if (args.help) {
    write([USAGE]);
    return;
  }
  if (args.profileDir === undefined) throw new Error('profile-summary.ts needs a profile_dir');
  const window = args.record === undefined ? undefined : windowFor(lastRecord(args.record), args.phase);
  if (args.record !== undefined && window === undefined) {
    console.error(`phase '${args.phase}' not in record`);
    process.exit(1);
  }
  const profiles = loadProfiles(args.profileDir);
  const urls = [...new Set(profiles.flatMap((profile) => profile.nodes.map((node) => node.callFrame.url)))].filter((url) => url.startsWith(FILE_PREFIX));
  const indexes = new Map(urls.map((url) => [url, classIndex(url.slice(FILE_PREFIX.length))] as const));
  const collected = profiles.map((profile) => collectSamples(profile, window, args.callers, indexes));
  const samples = collected.flatMap((item) => item.samples);
  const total = collected.flatMap((item) => item.windowMs).reduce((sum, ms) => sum + ms, 0);
  const functions = sumBy(
    samples,
    (sample) => `${sample.name}${KEY_SEPARATOR}${sample.location}`,
    (sample) => sample.ms,
  );
  const busyMs = pySum(functions.map((row) => row.total));
  const scope = window === undefined ? 'whole process' : `${args.phase} window ${formatFixed(window[1] - window[0], 0)} us`;
  const header = `${profiles.length} profile(s), ${scope}, ${formatFixed(total, 0)} ms sampled, ${formatFixed(busyMs, 0)} ms excluding ${idleRepr()}\n`;
  write(busyMs === 0 ? [header] : [header, ...reportLines(args, samples, functions, busyMs)]);
}

main();
