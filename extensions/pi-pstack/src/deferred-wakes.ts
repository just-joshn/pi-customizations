import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type Wake = Parameters<ExtensionAPI['sendMessage']>[0];

export class DeferredWakes {
  private held = new Map<string, Wake>();
  private endedCleanly = false;

  constructor(private readonly pi: ExtensionAPI) {
    pi.on('agent_end', (event) => {
      const last = event.messages.findLast((message) => message.role === 'assistant');
      this.endedCleanly = !(last?.role === 'assistant' && last.stopReason === 'aborted');
      if (this.endedCleanly) this.flush();
    });
    pi.on('agent_settled', () => {
      if (this.endedCleanly) this.flush();
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
