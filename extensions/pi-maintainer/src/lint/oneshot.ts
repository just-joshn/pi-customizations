/** Startup `--lint` / `--test` oneshot result (`aider/main.py:1053-1073`). */
export type OneshotResult = { readonly kind: 'skipped' } | { readonly kind: 'exit'; readonly status: number };

export interface OneshotTestCommandResult {
  readonly childFailed: boolean;
  /** Repair text Aider would return from cmd_test; ignored for model fixing unless placeholder is set. */
  readonly repairText: string | null;
}

/**
 * Startup oneshot lint/test: run explicit workflows, require `--test-cmd` when `--test` is set,
 * ignore returned test repair text for model fixing unless `placeholder` is populated, then exit.
 * Child test failure is not the process exit status (`aider/main.py:1053-1073,1272-1274`).
 */
export async function runLintTestOneshot(input: {
  readonly lint: boolean;
  readonly test: boolean;
  readonly testCmd: string | null;
  readonly runLintWorkflow: () => Promise<void>;
  readonly runTestCommand: (command: string) => Promise<OneshotTestCommandResult>;
  readonly error: (message: string) => void;
  readonly placeholder: string | null;
  readonly runPlaceholder?: (text: string) => Promise<void>;
}): Promise<OneshotResult> {
  if (!input.lint && !input.test) return { kind: 'skipped' };

  if (input.lint) await input.runLintWorkflow();

  if (input.test) {
    if (!input.testCmd) {
      input.error('No --test-cmd provided.');
      return { kind: 'exit', status: 1 };
    }
    await input.runTestCommand(input.testCmd);
    if (input.placeholder && input.runPlaceholder) await input.runPlaceholder(input.placeholder);
  }

  return { kind: 'exit', status: 0 };
}
