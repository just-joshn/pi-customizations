import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type Wake = Parameters<ExtensionAPI['sendMessage']>[0];

/**
 * Pi cannot withdraw one queued follow-up after a blocking read consumes its result.
 * Hold undelivered wakes until a clean boundary so blocking reads can suppress them.
 */
export class DeferredWakes {
  private held = new Map<string, Wake>();
  private aborted = false;

  constructor(private readonly pi: ExtensionAPI) {
    pi.on('agent_end', (event) => {
      const last = event.messages.findLast((message) => message.role === 'assistant');
      this.aborted = last?.role === 'assistant' && (last.stopReason === 'aborted' || last.stopReason === 'error');
    });
    pi.on('agent_before_settle', (event) => {
      if (event.outcome === 'completed' && !this.aborted) this.flush();
    });
    pi.on('agent_settled', () => {
      if (!this.aborted) this.flush();
    });
  }

  send(key: string, parentIdle: boolean, message: Wake): void {
    if (parentIdle) this.deliver(message);
    else this.held = new Map([...this.held, [key, message]]);
  }

  drop(key: string): void {
    this.held = new Map([...this.held].filter(([heldKey]) => heldKey !== key));
  }

  clear(): void {
    this.held = new Map();
  }

  private flush(): void {
    const held = [...this.held.values()];
    this.held = new Map();
    for (const message of held) this.deliver(message);
  }

  private deliver(message: Wake): void {
    this.pi.sendMessage(message, { triggerTurn: true, deliverAs: 'followUp' });
  }
}
