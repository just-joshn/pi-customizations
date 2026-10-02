export type LimitType = 'concurrent' | 'depth';
export type LimiterConfig = Readonly<{ maxConcurrent: number; maxDepth: number }>;
export type AcquireRequest = Readonly<{ kind: 'spawn'; depth: number }> | Readonly<{ kind: 'resume' }>;
export type AcquireResult = Readonly<{ ok: true; release: () => void }> | Readonly<{ ok: false; limit: LimitType; message: string }>;
export type LimiterInfo = Readonly<{ maxConcurrent: number; maxDepth: number; active: number }>;

export const concurrentSpawnMessage = (limit: number): string => `Maximum concurrent agent limit of ${limit} reached. Wait for existing agents to complete before spawning new ones.`;
export const concurrentResumeMessage = (limit: number): string => `Cannot resume agent \u2014 all ${limit} concurrent agent slots are in use. Try again after an active agent completes.`;
export const depthMessage = (limit: number): string => `Maximum sub-agent depth of ${limit} reached. Complete this task without spawning further sub-agents.`;

export class SubagentLimiter {
  private leases: ReadonlySet<symbol> = new Set();

  constructor(private readonly config: LimiterConfig) {}

  info(): LimiterInfo {
    return { ...this.config, active: this.leases.size };
  }

  tryAcquire(request: AcquireRequest): AcquireResult {
    if (request.kind === 'spawn' && request.depth >= this.config.maxDepth) return { ok: false, limit: 'depth', message: depthMessage(this.config.maxDepth) };
    if (this.leases.size >= this.config.maxConcurrent) {
      const message = request.kind === 'spawn' ? concurrentSpawnMessage(this.config.maxConcurrent) : concurrentResumeMessage(this.config.maxConcurrent);
      return { ok: false, limit: 'concurrent', message };
    }
    const lease = Symbol('subagent-slot');
    this.leases = new Set([...this.leases, lease]);
    return { ok: true, release: () => this.drop(lease) };
  }

  private drop(lease: symbol): void {
    this.leases = new Set([...this.leases].filter((held) => held !== lease));
  }
}
