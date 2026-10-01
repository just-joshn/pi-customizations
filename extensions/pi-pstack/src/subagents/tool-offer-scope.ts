import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type ToolSelection = Pick<ExtensionAPI, 'getActiveTools' | 'setActiveTools'>;
type OfferSnapshot = Readonly<{ prior: readonly string[]; applied: readonly string[] }>;

export class ToolOfferScope {
  private snapshot: OfferSnapshot | undefined;

  constructor(private readonly tools: ToolSelection) {}

  mask(filter: (names: readonly string[]) => readonly string[]): void {
    this.restore();
    const prior = [...this.tools.getActiveTools()];
    this.tools.setActiveTools([...filter(prior)]);
    this.snapshot = { prior, applied: [...this.tools.getActiveTools()] };
  }

  restore(): void {
    const snapshot = this.snapshot;
    this.snapshot = undefined;
    if (!snapshot) return;
    const current = this.tools.getActiveTools();
    const applied = new Set(snapshot.applied);
    if (current.length === snapshot.applied.length && current.every((name) => applied.has(name))) this.tools.setActiveTools([...snapshot.prior]);
  }
}
