export const defaultLastTurnWarning = 'This is your last turn. Stop calling tools and report your findings now.';

export type TurnVerdict = 'continue' | 'warn' | 'stop';

/** Counts the turns of a child that called tools and tells the scheduler when to warn it and when to stop it. */
export class TurnLimit {
  private turns = 0;

  constructor(
    readonly max: number,
    readonly warning: string = defaultLastTurnWarning,
  ) {}

  onTurnEnd(toolCalls: number): TurnVerdict {
    if (toolCalls === 0) return 'continue';
    this.turns += 1;
    if (this.turns >= this.max) return 'stop';
    return this.turns === this.max - 1 ? 'warn' : 'continue';
  }

  note(): string {
    return `Note: this agent stopped at its ${this.max}-turn limit, so the text above may be partial.`;
  }
}
