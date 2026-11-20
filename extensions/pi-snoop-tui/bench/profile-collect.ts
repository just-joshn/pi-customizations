import { z } from 'zod';
import { basename } from './aggregate.ts';
import type { Json, JsonObject } from './json.ts';
import { type ClassIndex, ownerClass } from './profile-scan.ts';
import { at, isObject, numberAt } from './stats.ts';

export const FILE_PREFIX = 'file://';
export const IDLE_FRAMES = new Set(['(idle)', '(program)', '(garbage collector)']);
const SLASH = '/';
const NODE_PREFIX = 'node:';
const NATIVE_LABEL = '(native)';
const ANONYMOUS = '(anonymous)';
const SNOOP_DIR = 'pi-snoop-tui/';
const SNOOP_LABEL = 'snoop:';
const NO_CLASS = '(no class)';
const CHAIN_SEPARATOR = ' < ';
const US_PER_MS = 1000;
const MAX_CHAIN = 8;
const PROVIDER_WINDOWS = new Map([
  // biome-ignore lint/security/noSecrets: benchmark record field names
  ['workload', ['agentStartHrtimeUs', 'agentEndHrtimeUs']],
  // biome-ignore lint/security/noSecrets: benchmark record field names
  ['idle', ['agentEndHrtimeUs', 'idleEndHrtimeUs']],
  // biome-ignore lint/security/noSecrets: benchmark record field names
  ['cleanIdle', ['idleEndHrtimeUs', 'cleanIdleEndHrtimeUs']],
]);
const NESTED_PHASES = new Map([
  ['typing', 'collapsedEcho'],
  ['expandedTyping', 'echo'],
  ['burst', 'burst'],
  ['startup', 'startup'],
]);

const CallFrame = z.object({ functionName: z.string(), url: z.string(), lineNumber: z.number(), columnNumber: z.number() });
const Profile = z.object({
  nodes: z.array(z.object({ id: z.number(), callFrame: CallFrame, children: z.array(z.number()).optional() })),
  startTime: z.number(),
  samples: z.array(z.number()),
  timeDeltas: z.array(z.number()),
});
const WindowUs = z.tuple([z.number(), z.number()]).rest(z.number());

export type Profile = z.infer<typeof Profile>;
export type Window = readonly [number, number];

/** One non-idle sample inside the window, with everything the report tables group by. */
export interface Sample {
  readonly ms: number;
  readonly name: string;
  readonly location: string;
  readonly file: string;
  readonly owner: string;
  readonly classes: readonly string[];
  readonly chain: string | undefined;
}

export interface Collected {
  readonly windowMs: readonly number[];
  readonly samples: readonly Sample[];
}

export const parseProfile = (text: string): Profile => Profile.parse(JSON.parse(text));

export function fileLabel(url: string): string {
  if (url === '') return NATIVE_LABEL;
  if (url.includes(SNOOP_DIR)) return `${SNOOP_LABEL}${url.slice(url.indexOf(SNOOP_DIR) + SNOOP_DIR.length)}`;
  if (url.startsWith(NODE_PREFIX) || !url.includes(SLASH)) return url;
  return basename(url);
}

const hasContent = (value: Json | undefined): value is JsonObject => isObject(value) && Object.keys(value).length > 0;

/** The sample window of a phase in a run record, or undefined when the record has no such phase. */
export function windowFor(record: JsonObject, phase: string): Window | undefined {
  const provider = PROVIDER_WINDOWS.get(phase);
  const [startKey, endKey] = provider ?? [];
  if (startKey !== undefined && endKey !== undefined) return [numberAt(record, startKey), numberAt(record, endKey)];
  const nested = NESTED_PHASES.get(phase);
  const source = [nested === undefined ? undefined : at(record, [nested]), phase === 'startup' ? at(record, ['steps', 'startup']) : undefined, at(record, ['steps', phase])].find(hasContent);
  if (source === undefined) return undefined;
  const [start, end] = WindowUs.parse(at(source, ['windowUs']));
  return [start, end];
}

function* timedSamples(profile: Profile): Generator<{ readonly id: number; readonly delta: number; readonly at: number }> {
  let time = profile.startTime;
  const count = Math.min(profile.samples.length, profile.timeDeltas.length);
  for (let index = 0; index < count; index += 1) {
    const delta = profile.timeDeltas[index] ?? 0;
    time += delta;
    yield { id: profile.samples[index] ?? 0, delta, at: time };
  }
}

type Frame = Profile['nodes'][number]['callFrame'];

/** Per-sample rows for one profile, limited to the window when there is one. */
export function collectSamples(profile: Profile, window: Window | undefined, callersOf: string | undefined, indexes: ReadonlyMap<string, ClassIndex>): Collected {
  const frames = new Map(profile.nodes.map((node): [number, Frame] => [node.id, node.callFrame]));
  const parents = new Map(profile.nodes.flatMap((node) => (node.children ?? []).map((child): [number, number] => [child, node.id])));
  const frameOf = (id: number): Frame => {
    const frame = frames.get(id);
    if (frame === undefined) throw new Error(`profile refers to unknown node ${id}`);
    return frame;
  };
  const ownerOf = (frame: Frame): string | undefined => {
    const index = indexes.get(frame.url);
    return index === undefined ? undefined : ownerClass(index, frame.lineNumber, frame.columnNumber);
  };
  const ancestors = function* (id: number): Generator<number> {
    for (let cursor = parents.get(id); cursor !== undefined; cursor = parents.get(cursor)) yield cursor;
  };
  const chainOf = (id: number): string =>
    [...ancestors(id)]
      .slice(0, MAX_CHAIN)
      .map((ancestor) => {
        const caller = frameOf(ancestor);
        return `${caller.functionName || ANONYMOUS}@${fileLabel(caller.url)}:${caller.lineNumber + 1}`;
      })
      .join(CHAIN_SEPARATOR);
  const inWindow = [...timedSamples(profile)].filter((sample) => window === undefined || (window[0] <= sample.at && sample.at <= window[1]));
  const samples = inWindow.flatMap(({ id, delta }): Sample[] => {
    const frame = frameOf(id);
    const name = frame.functionName || ANONYMOUS;
    if (IDLE_FRAMES.has(name)) return [];
    const classes = [id, ...ancestors(id)].map((nodeId) => ownerOf(frameOf(nodeId))).filter((owner): owner is string => owner !== undefined && owner !== '');
    const location = frame.url ? `${frame.url.startsWith(FILE_PREFIX) ? frame.url.slice(FILE_PREFIX.length) : frame.url}:${frame.lineNumber + 1}` : '';
    const owner = classes[0] ?? `${NO_CLASS} ${fileLabel(frame.url)}`;
    return [{ ms: delta / US_PER_MS, name, location, file: fileLabel(frame.url), owner, classes: [...new Set(classes)], chain: callersOf !== undefined && name === callersOf ? chainOf(id) : undefined }];
  });
  return { windowMs: inWindow.map((sample) => sample.delta / US_PER_MS), samples };
}
