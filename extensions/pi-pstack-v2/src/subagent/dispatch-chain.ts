import { formatResultText, getFinalOutput, getResultOutput, isFailedResult, progressResult, reportResult, runningText, type ToolResult } from './results.ts';
import { runSingleAgent } from './run-single.ts';
import type { DispatchRun, SingleResult, Work } from './types.ts';

const NO_OUTPUT = '(no output)';

/** Runs the steps in order, each given the last one's output where its task says `{previous}`, and stops at the first that fails. */
export async function runChain(run: DispatchRun, steps: Work[]): Promise<ToolResult> {
  let done: SingleResult[] = [];
  let previous = '';
  for (const [index, step] of steps.entries()) {
    const prev = previous;
    const completed = done;
    const task = step.item.task.replace(/\{previous\}/g, () => prev);
    const work: Work = { ...step, item: { ...step.item, task } };
    const result = await runSingleAgent(run, work, index + 1, (current) => run.onUpdate?.(progressResult('chain', [...completed, current], runningText(current))));
    done = [...done, result];
    if (isFailedResult(result)) {
      return reportResult('chain', done, formatResultText(result, `Chain stopped at step ${index + 1} (${step.item.agent}): ${getResultOutput(result)}`));
    }
    previous = getFinalOutput(result.messages);
  }
  const last = done.at(-1);
  return reportResult('chain', done, last ? formatResultText(last, getResultOutput(last)) : NO_OUTPUT);
}
