import { resolve } from 'node:path';

export interface ExpectedRoute {
  route: string;
  path: string;
  source: string;
  cwd: string;
  noPr?: boolean;
}
const object = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
const textContent = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .flatMap((part: unknown) => {
          const item = object(part);
          return item?.['type'] === 'text' && typeof item['text'] === 'string' ? [item['text']] : [];
        })
        .join('\n')
    : '';

export function routeEvidence(jsonl: string, expected: ExpectedRoute, exitCode: number | null) {
  const events = jsonl
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => object(JSON.parse(line)));
  if (events.some((event) => !event || typeof event['type'] !== 'string')) throw new Error('Malformed Pi JSONL event');
  const completed = exitCode === 0 && events.filter((event) => event?.['type'] === 'agent_settled').at(-1)?.['aborted'] === false;
  const messages = events
    .filter((event) => event?.['type'] === 'message_end')
    .map((event) => object(event?.['message']))
    .filter((message) => message?.['role'] === 'assistant');
  const final = messages.at(-1);
  const failed = final?.['stopReason'] === 'error' || final?.['stopReason'] === 'aborted';
  let decision: Record<string, unknown> | undefined;
  try {
    decision = object(JSON.parse(textContent(final?.['content'])));
  } catch {
    /* Unstructured replies require manual review, not a guessed route. */
  }
  const valid = completed && !failed && typeof decision?.['route'] === 'string' && typeof decision['path'] === 'string' && (!expected.noPr || typeof decision['prRequired'] === 'boolean');
  const source = expected.source.trimEnd();
  const lines = source.split('\n');
  const reads = new Map<string, number>();
  const ranges: [number, number][] = [];
  for (const event of events) {
    if (!event) continue;
    const args = object(event['args']);
    if (event['type'] === 'tool_execution_start' && typeof event['toolCallId'] === 'string') reads.delete(event['toolCallId']);
    if (event['type'] === 'tool_execution_start' && event['toolName'] === 'read' && typeof event['toolCallId'] === 'string' && typeof args?.['path'] === 'string' && resolve(expected.cwd, args['path']) === expected.path) {
      const offset = args['offset'] ?? 1;
      if (typeof offset === 'number' && Number.isInteger(offset) && offset > 0 && offset <= lines.length)
        reads.set(
          event['toolCallId'],
          lines.slice(0, offset - 1).reduce((count, line) => count + line.length + 1, 0),
        );
    }
    if (event['type'] !== 'tool_execution_end' || typeof event['toolCallId'] !== 'string' || event['isError'] !== false) continue;
    const start = reads.get(event['toolCallId']);
    if (start === undefined) continue;
    const output = textContent(object(event['result'])?.['content']);
    let length = 0;
    while (length < output.length && start + length < source.length && output[length] === source[start + length]) length++;
    if (length) ranges.push([start, start + length]);
  }
  let covered = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    if (start > covered) break;
    covered = Math.max(covered, end);
  }
  const fullRead = source.length > 0 && covered === source.length;
  const routeMatches = valid && decision?.['route'] === expected.route;
  const pathMatches = valid && typeof decision?.['path'] === 'string' && resolve(expected.cwd, decision['path']) === expected.path;
  const noPrMatches = expected.noPr ? decision?.['prRequired'] === false : true;
  const status = !valid ? 'INCONCLUSIVE' : routeMatches && pathMatches && fullRead && noPrMatches ? 'PASS' : 'FAIL';
  return {
    status,
    decision: decision ?? null,
    completed,
    fullRead,
    routeMatches,
    pathMatches,
    noPrMatches,
    axes: {
      outcome: !valid ? 'INCONCLUSIVE' : routeMatches && pathMatches ? 'YES' : 'NO',
      workflow: valid && (!fullRead || !noPrMatches) ? 'NO' : 'INCONCLUSIVE',
      piImplementation: 'INCONCLUSIVE',
    },
    scope: 'Routing decision, source read and stated PR policy only. Full task workflow and Pi defect attribution require separate review.',
  };
}
