const cancelledMessage = 'The workflow was cancelled.';

/** The concurrent subagents a workflow run may hold. A waiter wakes when a holder releases, not on a timer. */
export class Slots {
  private held = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number | undefined) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
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
    }
    if (signal.aborted) throw new Error(cancelledMessage);
    this.held += 1;
    return () => {
      this.held -= 1;
      this.waiting.shift()?.();
    };
  }
}
