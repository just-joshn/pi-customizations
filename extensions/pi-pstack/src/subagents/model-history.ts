import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

export class ModelHistory {
  private models: readonly string[];

  constructor(initial: readonly string[] = []) {
    this.models = initial.filter((model, index) => index === 0 || model !== initial[index - 1]);
  }

  record(reference: string): void {
    if (this.models.at(-1) !== reference) this.models = [...this.models, reference];
  }

  extensionFactory(): ExtensionFactory {
    return (pi) => {
      pi.on('model_select', (event) => {
        this.record(`${event.model.provider}/${event.model.id}`);
      });
    };
  }

  snapshot(): string[] {
    return [...this.models];
  }
}
