export const TODO_STATUSES = ['pending', 'running', 'passed', 'blocked', 'skipped'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoLedgerEntry {
  n: number;
  status: TodoStatus;
  requiredProof: string;
  source: string;
  evidence: string[];
  skip: string | null;
}

const RAW_START = '<!-- upstream-steps:start -->\n';
const RAW_END = '\n<!-- upstream-steps:end -->';
const LEDGER_START = '## Status ledger\n\n```json\n';
const LEDGER_END = '\n```\n\n## Task-specific work\n';

/** The contiguous source span, including its whitespace, not a reconstruction of its numbered lines. */
export function upstreamSteps(source: Buffer): { block: Buffer; steps: { n: number; line: number; text: string }[] } {
  const text = source.toString('utf8');
  const lines = text.split(/(?<=\n)/);
  const starts: { n: number; line: number; offset: number }[] = [];
  let fence: string | undefined;
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    } else if (fence === undefined) {
      const step = /^(\d+)\. /.exec(line);
      if (step !== null) starts.push({ n: Number(step[1]), line: index + 1, offset });
    }
    offset += Buffer.byteLength(line);
  }
  const first = starts[0];
  const last = starts.at(-1);
  if (first === undefined || last === undefined) return { block: Buffer.alloc(0), steps: [] };
  let end = last.offset;
  for (let index = last.line - 1; index < lines.length; index++) {
    const line = lines[index] as string;
    if (index > last.line - 1 && !/^[ \t\r\n]/.test(line)) break;
    end += Buffer.byteLength(line);
  }
  return {
    block: source.subarray(first.offset, end),
    steps: starts.map((step, index) => ({ n: step.n, line: step.line, text: source.subarray(step.offset, starts[index + 1]?.offset ?? end).toString('utf8') })),
  };
}

export function immutableTodoBlock(todo: Buffer): Buffer {
  const start = todo.indexOf(RAW_START);
  const end = todo.indexOf(RAW_END, start + RAW_START.length);
  if (start === -1 || end === -1 || todo.indexOf(RAW_START, start + RAW_START.length) !== -1) throw new Error('TODO.md is missing its immutable upstream block');
  return todo.subarray(start + Buffer.byteLength(RAW_START), end);
}

export function readTodoLedger(text: string): TodoLedgerEntry[] {
  const start = text.indexOf(LEDGER_START);
  const end = text.indexOf(LEDGER_END, start + LEDGER_START.length);
  if (start === -1 || end === -1) throw new Error('TODO.md is missing its separate status ledger');
  const raw: unknown = JSON.parse(text.slice(start + LEDGER_START.length, end));
  if (!Array.isArray(raw)) throw new Error('TODO status ledger must be an array');
  const seen = new Set<number>();
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) throw new Error('Invalid TODO ledger entry');
    const item = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(item['n']) ||
      Number(item['n']) < 1 ||
      seen.has(Number(item['n'])) ||
      !TODO_STATUSES.includes(item['status'] as TodoStatus) ||
      typeof item['requiredProof'] !== 'string' ||
      !item['requiredProof'].trim() ||
      typeof item['source'] !== 'string' ||
      !item['source'].trim() ||
      !Array.isArray(item['evidence']) ||
      item['evidence'].some((id: unknown) => typeof id !== 'string' || !id.trim()) ||
      !(item['skip'] === null || typeof item['skip'] === 'string') ||
      (item['status'] === 'skipped' ? typeof item['skip'] !== 'string' || !/^skip: [^\r\n]+$/.test(item['skip']) || !item['skip'].slice(6).trim() : item['skip'] !== null)
    )
      throw new Error('Invalid TODO ledger entry or skip: reason');
    seen.add(Number(item['n']));
  }
  return raw as TodoLedgerEntry[];
}

export function replaceTodoLedger(text: string, ledger: TodoLedgerEntry[]): string {
  const start = text.indexOf(LEDGER_START) + LEDGER_START.length;
  const end = text.indexOf(LEDGER_END, start);
  const updated = `${text.slice(0, start)}${JSON.stringify(ledger, null, 2)}${text.slice(end)}`;
  readTodoLedger(updated);
  return updated;
}

export function createTodo(title: string, playbook: string, revision: string, source: Buffer): string {
  const { block, steps } = upstreamSteps(source);
  const pointer = `https://github.com/cursor/plugins/blob/${revision}/pstack/skills/poteto-mode/playbooks/${playbook}.md`;
  const ledger: TodoLedgerEntry[] = steps.map((step) => ({ n: step.n, status: 'pending', requiredProof: step.text.split(/\r?\n/)[0] as string, source: `${pointer}#L${step.line}`, evidence: [], skip: null }));
  return `# ${title}\n\n## Original playbook steps\n${RAW_START}${block.toString('utf8')}${RAW_END}\n\nSource playbook: ${playbook}.md\nUpstream revision: ${revision}\nSource: ${pointer}\n${steps.length === 0 ? '\nThis playbook has no numbered steps. Read its rules in full.\n' : ''}\n${LEDGER_START}${JSON.stringify(ledger, null, 2)}${LEDGER_END}`;
}

export function validateTodoSource(todo: Buffer, source: Buffer, playbook: string, revision: string): TodoLedgerEntry[] {
  const expected = upstreamSteps(source);
  const text = todo.toString('utf8');
  const section = text.indexOf('\n## Original playbook steps\n');
  if (section === -1 || section !== text.indexOf('\n## ') || text.indexOf(RAW_START) !== section + '\n## Original playbook steps\n'.length || text.indexOf(LEDGER_START) < text.indexOf(RAW_END) + RAW_END.length)
    throw new Error('TODO.md must put its immutable source first, then its separate status ledger');
  if (!immutableTodoBlock(todo).equals(expected.block)) throw new Error('TODO.md immutable upstream bytes differ from the pinned source');
  const ledger = readTodoLedger(todo.toString('utf8'));
  if (
    ledger.length !== expected.steps.length ||
    ledger.some((entry, index) => {
      const step = expected.steps[index];
      return entry.n !== step?.n || entry.source !== `https://github.com/cursor/plugins/blob/${revision}/pstack/skills/poteto-mode/playbooks/${playbook}.md#L${step.line}`;
    })
  )
    throw new Error('TODO.md ledger must link each pinned source step in order');
  return ledger;
}
