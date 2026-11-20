import { frameSubagentReport } from './framing.ts';
import { aggregateUsage, getFinalOutput, getResultOutput, isFailedResult, makeDetails, type ToolResult, textResult, truncateModelOutput, withWorktreeNote } from './results.ts';
import { runSingleAgent } from './run-single.ts';
import type { WorkItem } from './schema.ts';
import type { DispatchRun, OnUpdateCallback, ResolvedAgent, SingleResult } from './types.ts';

/** Streams the current step's progress together with every step that already finished. */
function chainUpdate({ onUpdate }: DispatchRun, done: SingleResult[]): OnUpdateCallback | undefined {
  if (!onUpdate) return undefined;
  return (partial) => {
    const current = partial.details?.results[0];
    if (!current) return;
    onUpdate({ content: partial.content, details: makeDetails('chain')([...done, current]) });
  };
}

async function runStep(run: DispatchRun, steps: WorkItem[], resolved: ResolvedAgent[], index: number, done: SingleResult[], previousOutput: string): Promise<ToolResult> {
  const step = steps[index];
  const agent = resolved[index];
  if (!step || !agent) return finishChain(done);

  const task = step.task.replace(/\{previous\}/g, previousOutput);
  const result = await runSingleAgent(run.defaults, agent, step.agent, task, index + 1, run.signal, chainUpdate(run, done), makeDetails('chain'));
  const results = [...done, result];
  if (isFailedResult(result)) {
    const message = `Chain stopped at step ${index + 1} (${step.agent}): ${getResultOutput(result)}`;
    return textResult(frameSubagentReport(withWorktreeNote(result, truncateModelOutput(message)), aggregateUsage(results)), makeDetails('chain')(results));
  }
  return runStep(run, steps, resolved, index + 1, results, getFinalOutput(result.messages));
}

function finishChain(results: SingleResult[]): ToolResult {
  const last = results.at(-1);
  const output = truncateModelOutput((last ? getResultOutput(last) : '') || '(no output)');
  return textResult(frameSubagentReport(last ? withWorktreeNote(last, output) : output, aggregateUsage(results)), makeDetails('chain')(results));
}

export function runChain(run: DispatchRun, steps: WorkItem[], resolved: ResolvedAgent[]): Promise<ToolResult> {
  return runStep(run, steps, resolved, 0, [], '');
}
