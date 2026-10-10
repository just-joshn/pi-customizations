import type { Notices } from '../edit/working-tree.ts';
import type { ConfirmRequest } from './confirm.ts';

export interface ExecRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface ExecOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly killed: boolean;
}

/**
 * The user-facing capabilities a port may use: Aider's `tool_output`, `tool_warning`, and
 * `tool_error`, `confirm_ask`, a choice list, and subprocesses. Ports receive a Host and never
 * import Pi.
 */
export interface Host extends Notices {
  confirm(request: ConfirmRequest): Promise<boolean>;
  /** The chosen option, or undefined when there is no UI or the dialog is dismissed. */
  select(title: string, options: readonly string[]): Promise<string | undefined>;
  exec(request: ExecRequest): Promise<ExecOutcome>;
}
