import { concurrencyCapMessage } from './admission.ts';
import { mapWithConcurrencyLimit } from './concurrency.ts';
import { createUnstartedResult, formatResultText, getResultOutput, isFailedResult, progressResult, refusalResult, reportResult, type ToolResult, truncateParallelOutput } from './results.ts';
import { runSingleAgent } from './run-single.ts';
import type { DispatchRun, SingleResult, Work } from './types.ts';

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const SEPARATOR = '\n\n---\n\n';

function progressText(all: SingleResult[]): string {
  const running = all.filter((result) => result.status === 'running').length;
  const pending = all.filter((result) => result.status === 'pending').length;
  return `Parallel: ${all.length - running - pending}/${all.length} done, ${running} running, ${pending} pending...`;
}

function summarize(result: SingleResult): string {
  const showReason = isFailedResult(result) && result.stopReason && result.stopReason !== 'end';
  const status = showReason ? `${result.status} (${result.stopReason})` : result.status;
  return `### [${result.agent}] ${status}\n\n${formatResultText(result, getResultOutput(result), truncateParallelOutput)}`;
}

function finalText(results: SingleResult[]): string {
  const successCount = results.filter((result) => !isFailedResult(result)).length;
  return `Parallel: ${successCount}/${results.length} succeeded\n\n${results.map(summarize).join(SEPARATOR)}`;
}

/** A call is turned away, starting none, when it could not start the workers it runs at once. */
function refusalFor(run: DispatchRun, work: Work[]): ToolResult | undefined {
  if (work.length > MAX_PARALLEL_TASKS) return refusalResult('parallel', `Too many parallel tasks (${work.length}). Max is ${MAX_PARALLEL_TASKS}.`);
  if (Math.min(work.length, MAX_CONCURRENCY) > run.gate.available()) return refusalResult('parallel', concurrencyCapMessage(run.gate.limit()));
  return undefined;
}

export async function runParallel(run: DispatchRun, work: Work[]): Promise<ToolResult> {
  const refused = refusalFor(run, work);
  if (refused) return refused;

  let all = work.map(({ item }) => createUnstartedResult(item.agent, item.task, undefined, 'pending'));
  const record = (index: number, result: SingleResult): void => {
    all = all.with(index, result);
    run.onUpdate?.(progressResult('parallel', all, progressText(all)));
  };

  const results = await mapWithConcurrencyLimit(work, MAX_CONCURRENCY, async (unit, index) => {
    const result = await runSingleAgent(run, unit, undefined, (current) => record(index, current));
    record(index, result);
    return result;
  });
  return reportResult('parallel', results, finalText(results));
}
