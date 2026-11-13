// MX-CODEMODE: Pi's codemode tool composes concurrent tool calls with isolated results, in the parent and inside a pstack worker.
// The tools are a stdio MCP server's (fixtures/mcp-server.mjs), so each Pi process runs its own server and its own pid in the server log.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { allWorkers, settledAndCollected } from '../lib/checks.ts';
import { PKG, SCRIPTED_ROLES } from '../lib/driver.ts';
import { overwrite, parentSession, patchAssignment, rewriteSession, workerSessionFile } from '../lib/mutate.ts';
import type { RunView, Session } from '../lib/view.ts';
import type { Family } from './types.ts';

const SERVER = join(PKG, 'tests/workflow-parity/fixtures/mcp-server.mjs');
const SRC = src('poteto-mode/SKILL.md', 'Use any MCP tool');
const NS = 'tools.mcp__decisions__';
const RUN = 'codemode-compose';

/** Three overlapping 700 ms calls, one error result, one call to a tool that does not exist. Each slot keeps its own outcome. */
const compose = (who: string) => `const t0 = Date.now();
const nope = async () => ${NS}no_such_tool({});
const settled = await Promise.allSettled([
  ${NS}slow_echo({ label: '${who}-' + 'A', ms: 700 }),
  ${NS}slow_echo({ label: '${who}-' + 'B', ms: 700 }),
  ${NS}slow_echo({ label: '${who}-' + 'C', ms: 700 }),
  ${NS}fail_now({ reason: '${who}-failure' }),
  nope(),
]);
const slots = settled.map((entry) => entry.status === 'rejected' ? { status: 'rejected' } : entry.value.isError ? { status: 'isError', text: entry.value.content[0].text } : { status: 'ok', label: JSON.parse(entry.value.content[0].text).label });
return JSON.stringify({ who: '${who}', wallMs: Date.now() - t0, slots });`;

const BIG = `// @options: {"max_output_tokens": 200}
const big = await ${NS}big_text({ chars: 60000 });
return big.content[0].text;`;

const REDUCED = `const big = await ${NS}big_text({ chars: 60000 });
const text = big.content[0].text;
return JSON.stringify({ length: text.length, head: text.slice(0, 8) });`;

interface Slot {
  status: string;
  label?: string;
  text?: string;
}

const composerOf = (view: RunView) => {
  const candidates = allWorkers(view).filter((worker) => codemodeCalls(worker.session).length > 0);
  const worker = candidates[0];
  if (candidates.length !== 1 || worker === undefined) throw new Error(`expected one codemode worker; candidates: ${candidates.map((entry) => entry.id).join(', ') || 'none'}`);
  return worker;
};
const codemodeCalls = (session: Session | null) => (session?.toolCalls ?? []).filter((call) => call.name === 'codemode');
const slotsOf = (text: string): { who: string; wallMs: number; slots: Slot[] } | null => {
  const found = /\{"who":.*"slots":\[.*\]\}/.exec(text.replace(/\\"/g, '"'));
  return found === null ? null : (JSON.parse(found[0]) as { who: string; wallMs: number; slots: Slot[] });
};
const calls = (view: RunView): { tool?: string; method?: string; pid: number; at: number; args?: { label?: string; ms?: number } }[] => {
  const path = join(view.sandbox, 'mcp-calls.jsonl');
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { pid: number; at: number })
    : [];
};
const echoesOf = (view: RunView, who: string) => calls(view).filter((entry) => entry.tool === 'slow_echo' && entry.args?.label?.startsWith(`${who}-`));

function composes(who: 'parent' | 'worker'): ReturnType<typeof check>[] {
  const session = (view: RunView): Session | null => (who === 'parent' ? view.parent : composerOf(view).session);
  const first = (view: RunView) => slotsOf(codemodeCalls(session(view)).find((call) => /slow_echo/.test(JSON.stringify(call.args)))?.resultText ?? '');
  return [
    check(`codemode.${who}-isolated`, `in the ${who}, each concurrent call's result lands in its own slot: three labels in order, the error result flagged only on its own slot, the missing tool rejected only on its own`, SRC, (view) => {
      const out = first(view);
      if (out === null) return fail(`no codemode result with slots in the ${who} session: ${codemodeCalls(session(view)).map((call) => call.resultText.slice(0, 120)).join(' | ') || 'no codemode call'}`);
      const wanted = ['A', 'B', 'C'].map((letter) => `${who}-${letter}`);
      const labels = out.slots.slice(0, 3).map((slot) => slot.label);
      const ok = out.who === who && JSON.stringify(labels) === JSON.stringify(wanted) && out.slots[3]?.status === 'isError' && out.slots[3].text === `failed: ${who}-failure` && out.slots[4]?.status === 'rejected';
      return when(ok, `slots ${out.slots.map((slot) => slot.label ?? slot.status).join(', ')}`, `slots ${JSON.stringify(out.slots)}`);
    }),
    check(`codemode.${who}-concurrent`, `the ${who}'s three 700 ms calls ran at the same time: the server received all three within 300 ms, and the script took under 1500 ms`, SRC, (view) => {
      const received = echoesOf(view, who).map((entry) => entry.at);
      const wall = first(view)?.wallMs ?? Number.POSITIVE_INFINITY;
      const spread = Math.max(...received) - Math.min(...received);
      return when(received.length === 3 && spread < 300 && wall < 1500, `3 calls received ${spread} ms apart, script took ${wall} ms (serial would be 2100)`, `${received.length} calls, spread ${spread} ms, script ${wall} ms`);
    }),
  ];
}

export const codemodeFamily: Family = {
  id: 'codemode',
  title: 'codemode composes concurrent tool calls with isolated results, in the parent and in a worker (MX-CODEMODE)',
  spec: {
    family: 'codemode',
    runId: RUN,
    history: cartHistory,
    prompt: () => '/poteto-mode Compose several tool calls at once with codemode, in you and in one worker.',
    prepare: (ctx) => writeFileSync(join(ctx.agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { decisions: { command: 'node', args: [SERVER], env: { MCP_FIXTURE_LOG: join(ctx.sandbox, 'mcp-calls.jsonl') }, description: 'Product decision records' } } }, null, 2)),
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      parent.readSkill('poteto-mode').bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook investigation --title "codemode composition" --run-id ${ctx.runId}`);
      const composer = parent.stage('composer', { role: 'general', model: String(SCRIPTED_ROLES['swarm workers']), workspace: parent.worktree(), capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false } }, 'Run one codemode script that composes the concurrent calls and report its output.');
      parent.fire(composer).call('codemode', { code: compose('parent') }).wait('composer').collect('composer').call('codemode', { code: BIG }).call('codemode', { code: REDUCED }).text('done');
      return scenario(parent, { composer: new Worker().call('codemode', { code: compose('worker') }).text('composed') });
    },
  },
  checks: [
    ...composes('parent'),
    ...composes('worker'),
    check('codemode.worker-ran-codemode', 'the worker is a pstack worker with its own worktree that ran codemode itself', src('swarm/SKILL.md', 'Spawn all N workers one after another without waiting'), (view) => {
      const worker = composerOf(view);
      return when(worker.assignment['role'] === 'general' && (worker.assignment['workspace'] as { mode?: string })?.mode === 'worktree', `codemode worker ${worker.id} has its own worktree`, `worker ${worker.id}: ${JSON.stringify(worker.assignment)}`);
    }),
    check('codemode.sessions-do-not-share', 'the parent and the worker each ran their own MCP server process, and no label crossed from one to the other', SRC, (view) => {
      const parentPids = new Set(echoesOf(view, 'parent').map((entry) => entry.pid));
      const workerPids = new Set(echoesOf(view, 'worker').map((entry) => entry.pid));
      const shared = [...parentPids].filter((pid) => workerPids.has(pid));
      const crossed = [...codemodeCalls(view.parent), ...codemodeCalls(composerOf(view).session)].filter((call, index) => (index < codemodeCalls(view.parent).length ? /worker-[ABC]/.test(call.resultText) : /parent-[ABC]/.test(call.resultText)));
      return when(parentPids.size === 1 && workerPids.size === 1 && shared.length === 0 && crossed.length === 0, `parent server pid ${[...parentPids].join()}, worker server pid ${[...workerPids].join()}, no label crossed`, `parent pids ${[...parentPids].join()}, worker pids ${[...workerPids].join()}, shared ${shared.join()}, crossed ${crossed.length}`);
    }),
    check('codemode.large-output-is-bounded', 'a 60000 character tool result with max_output_tokens 200 reaches the model truncated with the full text saved to a file, and a script that reduces it returns only a summary', SRC, (view) => {
      const [, big, reduced] = codemodeCalls(view.parent);
      if (big === undefined || reduced === undefined) return fail(`${codemodeCalls(view.parent).length} codemode calls, want 3`);
      const tempFile = /(\/[^\s"']+\.(?:txt|log|json|out)|\/(?:var|tmp)\/[^\s"']+)/.exec(big.resultText.replace(/\\n/g, '\n'))?.[1];
      const summary = /"length":60000/.test(reduced.resultText.replace(/\\"/g, '"'));
      return when(big.resultText.length < 3000 && /truncated/i.test(big.resultText) && tempFile !== undefined && summary && reduced.resultText.length < 600, `unreduced result ${big.resultText.length} chars with a saved file ${tempFile}; reduced script result ${reduced.resultText.length} chars with length 60000`, `big ${big.resultText.length} chars, truncated ${/truncated/i.test(big.resultText)}, file ${String(tempFile)}; reduced ${reduced.resultText.length} chars, summary ${summary}`);
    }),
    settledAndCollected('codemode.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    { name: 'two parent results swapped slots', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'parent-B', 'parent-C'), fails: ['codemode.parent-isolated'] },
    { name: 'the worker calls ran one after another', mutate: (sandbox) => overwrite(join(sandbox, 'mcp-calls.jsonl'), (text) => text.split('\n').map((line) => (line.includes('worker-B') ? line.replace(/"at":(\d+)/, (_, at: string) => `"at":${Number(at) + 1000}`) : line)).join('\n')), fails: ['codemode.worker-concurrent'] },
    { name: 'a worker label appeared in the parent', mutate: (sandbox, view) => rewriteSession(workerSessionFile(sandbox, view.runs.find((run) => run.workers.includes(composerOf(view)))?.id ?? '', composerOf(view).id), 'worker-A', 'parent-A'), fails: ['codemode.worker-isolated', 'codemode.sessions-do-not-share'] },
    { name: 'the large result reached the model whole', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'truncated', 'complete'), fails: ['codemode.large-output-is-bounded'] },
    { name: 'the worker was readonly, with no codemode', mutate: (sandbox, view) => patchAssignment(sandbox, view.runs.find((run) => run.workers.includes(composerOf(view)))?.id ?? '', composerOf(view).id, (assignment) => (assignment['workspace'] = { mode: 'readonly', path: join(sandbox, 'repo') })), fails: ['codemode.worker-ran-codemode'] },
  ],
};
