import { mapWithConcurrencyLimit } from './concurrency.ts';
import { frameSubagentReport } from './framing.ts';
import { aggregateUsage, createUnstartedResult, getResultOutput, isFailedResult, makeDetails, type ToolResult, textResult, truncateParallelOutput, withWorktreeNote } from './results.ts';
import { runSingleAgent } from './run-single.ts';
import type { WorkItem } from './schema.ts';
import type { DispatchRun, OnUpdateCallback, ResolvedAgent, SingleResult } from './types.ts';

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
  return `### [${result.agent}] ${status}\n\n${withWorktreeNote(result, truncateParallelOutput(getResultOutput(result)))}`;
}

function finishParallel(results: SingleResult[]): ToolResult {
  const successCount = results.filter((result) => !isFailedResult(result)).length;
  const text = `Parallel: ${successCount}/${results.length} succeeded\n\n${results.map(summarize).join(SEPARATOR)}`;
  return textResult(frameSubagentReport(text, aggregateUsage(results)), makeDetails('parallel')(results));
}

export async function runParallel(run: DispatchRun, tasks: WorkItem[], resolved: ResolvedAgent[]): Promise<ToolResult> {
  if (tasks.length > MAX_PARALLEL_TASKS) {
    return textResult(`Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`, makeDetails('parallel', true)([]));
  }

  let all = tasks.map((item) => createUnstartedResult(item.agent, item.task, undefined, 'pending'));
  const record = (index: number, result: SingleResult): void => {
    all = all.with(index, result);
    run.onUpdate?.({ content: [{ type: 'text', text: progressText(all) }], details: makeDetails('parallel')(all) });
  };

  const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (item, index) => {
    const agent = resolved[index];
    if (!agent) throw new Error(`No resolved agent for task ${index + 1}.`);
    const onUpdate: OnUpdateCallback = (partial) => {
      const current = partial.details?.results[0];
      if (current) record(index, current);
    };
    const result = await runSingleAgent(run.defaults, agent, item.agent, item.task, undefined, run.signal, onUpdate, makeDetails('parallel'));
    record(index, result);
    return result;
  });
  return finishParallel(results);
}
