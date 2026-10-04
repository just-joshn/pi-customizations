const cancelledMessage = 'The workflow was cancelled.';
const closedMessage = 'Factory subagent limiter is closed';

/** The concurrent subagents a workflow run may hold. A waiter wakes when a holder releases, not on a timer. */
export class Slots {
  private readonly limit: number | undefined;
  private held = 0;
  private closed = false;
  private readonly waiting: (() => void)[] = [];

  constructor(limit: number | undefined) {
    this.limit = limit;
  }

  /** Closing wakes every waiter; admission and waiters after that fail instead of hanging. */
  close(): void {
    this.closed = true;
    for (const wake of this.waiting.splice(0)) wake();
  }

  async acquire(signal: AbortSignal): Promise<() => void> {
    if (this.closed) throw new Error(closedMessage);
    while (this.limit !== undefined && this.held >= this.limit) {
      if (signal.aborted) throw new Error(cancelledMessage);
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal.removeEventListener('abort', leave);
          resolve();
        };
        const leave = () => {
          const index = this.waiting.indexOf(wake);
          if (index >= 0) this.waiting.splice(index, 1);
          resolve();
        };
        this.waiting.push(wake);
        signal.addEventListener('abort', leave, { once: true });
      });
      if (this.closed) throw new Error(closedMessage);
    }
    if (signal.aborted) throw new Error(cancelledMessage);
    this.held += 1;
    return () => {
      this.held -= 1;
      this.waiting.shift()?.();
    };
  }
}
