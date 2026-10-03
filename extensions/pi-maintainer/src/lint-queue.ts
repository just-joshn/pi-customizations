/**
 * The per-file lint queue shared by /lint and the one-shot --lint flow. Each
 * advance lints the next file, prints its errors, and asks whether to repair
 * it. The first accepted file's error text is returned, declined files are
 * skipped without a repair, and exhaustion returns undefined.
 *
 * The confirm port arrives per advance because /lint moves into its repair
 * session after the first acceptance, and the confirmation for later files has
 * to come from the replacement session's context.
 */

import type { Linter } from './linter.ts';
import { fixFileQuestion } from './strings.ts';
import type { LinterIo } from './types.ts';

export interface LintRepairQueueDeps {
  readonly linter: Pick<Linter, 'lint'>;
  readonly io: Pick<LinterIo, 'output'>;
  readonly files: readonly string[];
}

export class LintRepairQueue {
  private readonly deps: LintRepairQueueDeps;

  private index = 0;

  constructor(deps: LintRepairQueueDeps) {
    this.deps = deps;
  }

  async next(confirm: (question: string) => Promise<boolean>): Promise<string | undefined> {
    while (this.index < this.deps.files.length) {
      const fname = this.deps.files[this.index];
      this.index += 1;
      if (fname === undefined) continue;
      const errors = await this.deps.linter.lint(fname);
      if (errors === undefined) continue;
      this.deps.io.output(errors);
      if (await confirm(fixFileQuestion(fname))) return errors;
    }
    return undefined;
  }
}
