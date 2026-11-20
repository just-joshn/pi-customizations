import { type monitorEventLoopDelay, performance } from 'node:perf_hooks';

export interface PhaseMetrics {
  readonly wallMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly eldP50Ms: number;
  readonly eldP99Ms: number;
  readonly eldMaxMs: number;
}
export interface CleanIdleMetrics {
  readonly wallMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly voluntaryContextSwitches: number;
  readonly involuntaryContextSwitches: number;
}
export interface Snapshot {
  readonly at: number;
  readonly epochMs: number;
  readonly hrtimeUs: number;
  readonly cpu: NodeJS.CpuUsage;
}
const NS_PER_US = 1000n;
const US_PER_MS = 1000;
const NS_PER_MS = 1e6;
const MEDIAN_PERCENTILE = 50;
const TAIL_PERCENTILE = 99;

export function snapshot(): Snapshot {
  const at = performance.now();
  return { at, epochMs: performance.timeOrigin + performance.now(), hrtimeUs: Number(process.hrtime.bigint() / NS_PER_US), cpu: process.cpuUsage() };
}

export function cleanIdlePhase(from: Snapshot, fromUsage: NodeJS.ResourceUsage, to: Snapshot, toUsage: NodeJS.ResourceUsage): CleanIdleMetrics {
  return {
    wallMs: to.at - from.at,
    cpuUserMs: (to.cpu.user - from.cpu.user) / US_PER_MS,
    cpuSystemMs: (to.cpu.system - from.cpu.system) / US_PER_MS,
    voluntaryContextSwitches: toUsage.voluntaryContextSwitches - fromUsage.voluntaryContextSwitches,
    involuntaryContextSwitches: toUsage.involuntaryContextSwitches - fromUsage.involuntaryContextSwitches,
  };
}

export function phase(from: Snapshot, to: Snapshot, histogram: ReturnType<typeof monitorEventLoopDelay>): PhaseMetrics {
  const ms = (ns: number) => ns / NS_PER_MS;
  return {
    wallMs: to.at - from.at,
    cpuUserMs: (to.cpu.user - from.cpu.user) / US_PER_MS,
    cpuSystemMs: (to.cpu.system - from.cpu.system) / US_PER_MS,
    eldP50Ms: ms(histogram.percentile(MEDIAN_PERCENTILE)),
    eldP99Ms: ms(histogram.percentile(TAIL_PERCENTILE)),
    eldMaxMs: ms(histogram.max),
  };
}
