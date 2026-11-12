// MX-WORKER-CONCURRENCY: several workers spawned at once, each on a different resolved model, in its own session, tmux session and worktree.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, settledAndCollected, spawnedTogether } from '../lib/checks.ts';
import { overwrite, patchAssignment, setSessionCwd, workerSessionFile } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import { writes } from './shared.ts';
import type { Family } from './types.ts';

const RUN = 'concurrent-workers';
const SRC = src('swarm/SKILL.md', 'Spawn all N workers one after another without waiting');
const MODELS: Record<string, { model: string; thinking: string | null }> = {
  'worker-a': { model: 'sim/claude-sim', thinking: null },
  'worker-b': { model: 'sim/grok-sim', thinking: null },
  'worker-c': { model: 'sim/deepseek-sim', thinking: null },
  'worker-d': { model: 'sim/claude-sim', thinking: 'high' },
};

const statesOf = (view: RunView) => allWorkers(view).map((worker) => ({ id: worker.id, state: (worker.state ?? {}) as { model?: { provider: string; id: string }; tmuxSession?: string; sessionFile?: string; settles?: { phase: string; at: string }[] } }));
/** Finds the tmux pane that is an ancestor of this shell, whatever the environment says, and records its session, its id, and what $TMUX_PANE claims. */
const IDENTIFY = `p=$$; while [ "$p" -gt 1 ]; do row=$(tmux -L "$PSTACK_TMUX_SOCKET" list-panes -a -F '#{pane_pid} #{session_name} #{pane_id}' | awk -v p=$p '$1==p{print $2, $3}'); [ -n "$row" ] && break; p=$(ps -o ppid= -p $p | tr -d ' '); done; echo "$row $TMUX_PANE" > ../tmux-identity.txt`;

const eventAt = (view: RunView, workerId: string, kind: string): number => Date.parse(String((view.runs[0]?.events ?? []).find((entry) => entry['workerId'] === workerId && entry['kind'] === kind)?.['ts'] ?? ''));

export const concurrencyFamily: Family = {
  id: 'worker-concurrency',
  title: 'four workers spawned in one message on three different models: distinct sessions, tmux sessions and worktrees, overlapping in time (MX-WORKER-CONCURRENCY)',
  spec: {
    family: 'worker-concurrency',
    runId: RUN,
    env: { TMUX_PANE: '%77' },
    history: cartHistory,
    prompt: () => '/swarm Add one small helper file each in four workers at the same time.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      parent.readSkill('swarm').bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook investigation --title "four writers" --run-id ${ctx.runId}`);
      const ids = Object.keys(MODELS);
      const staged = ids.map((id) => parent.stage(id, { role: 'general', model: (MODELS[id] as { model: string }).model, thinkingLevel: (MODELS[id] as { thinking: string | null }).thinking, workspace: parent.worktree() }, `Write src/${id}.js exporting the name "${id}", commit it, and report.`));
      parent.fire(...staged).bash(`touch ${JSON.stringify(join(parent.runDir, 'after-spawn'))}`);
      for (const id of ids) parent.wait(id);
      parent.collect(...ids).text('four workers done');
      const workers = Object.fromEntries(ids.map((id) => [id, writes(parent, id, { [`src/${id}.js`]: `export const name = '${id}';\n` }, `add ${id}`, { before: ['sleep 2.5', IDENTIFY], test: `node -e "import('./src/${id}.js').then((m)=>{if(m.name!=='${id}')process.exit(1)})"`, report: `${id} added src/${id}.js` })]));
      return scenario(parent, workers);
    },
  },
  checks: [
    spawnedTogether('worker-concurrency.spawned-in-one-message', SRC, ['general']),
    check('worker-concurrency.spawn-does-not-block', 'spawn returned before any worker settled: the parent kept running while all four were live, and the four live intervals share one instant', src('swarm/SKILL.md', 'without waiting'), (view) => {
      const ids = Object.keys(MODELS);
      const spawned = ids.map((id) => eventAt(view, id, 'spawn'));
      const settled = statesOf(view).map(({ state }) => Date.parse(state.settles?.find((settle) => settle.phase === 'idle')?.at ?? ''));
      if ([...spawned, ...settled].some(Number.isNaN)) return fail(`missing spawn or idle times: spawned ${spawned.join()}, settled ${settled.join()}`);
      const overlap = Math.min(...settled) - Math.max(...spawned);
      const marker = join(view.runs[0]?.dir ?? '', 'after-spawn');
      const parentRan = existsSync(marker) ? statSync(marker).mtimeMs : Number.NaN;
      return when(overlap > 1000 && parentRan < Math.min(...settled), `all four were live together for ${overlap} ms; the parent's next command ran ${Math.round(Math.min(...settled) - parentRan)} ms before the first settle`, `last spawn to first settle ${overlap} ms; parent marker at ${parentRan}, first settle ${Math.min(...settled)}`);
    }),
    check('worker-concurrency.distinct-resolved-models', 'the workers ran on the models their assignments named: three distinct physical models, each recorded by the host and in the worker session', SRC, (view) => {
      const states = statesOf(view);
      const problems = states.flatMap(({ id, state }) => {
        const want = (MODELS[id] as { model: string }).model;
        const got = state.model === undefined ? '' : `${state.model.provider}/${state.model.id}`;
        const sessionModels = allWorkers(view).find((worker) => worker.id === id)?.session?.models ?? [];
        return [...(got === want ? [] : [`${id}: host recorded ${got}, assignment says ${want}`]), ...(sessionModels.length === 1 && sessionModels[0] === want ? [] : [`${id}: session answered with ${sessionModels.join() || 'nothing'}`])];
      });
      const distinct = new Set(states.map(({ state }) => `${state.model?.provider}/${state.model?.id}`));
      return when(problems.length === 0 && distinct.size === 3, `${distinct.size} distinct models: ${[...distinct].join(', ')}`, problems.join('; ') || `${distinct.size} distinct models`);
    }),
    check('worker-concurrency.distinct-sessions-and-panes', 'every worker has its own Pi session file, session id, tmux session and tmux pane marker, and none is shared', SRC, (view) => {
      const states = statesOf(view);
      const unique = (values: string[]) => new Set(values).size === values.length && values.every((value) => value !== '');
      const panes = states.map(({ id }) => view.runs[0]?.workers.find((worker) => worker.id === id)?.dir ?? '').map((dir) => (dir === '' ? '' : (identity(dir)[0] ?? '')));
      const sessionIds = allWorkers(view).map((worker) => worker.session?.file.split('_').pop() ?? '');
      const ok = states.length === 4 && unique(states.map(({ state }) => state.sessionFile ?? '')) && unique(sessionIds) && unique(states.map(({ state }) => state.tmuxSession ?? '')) && unique(panes) && states.every(({ id, state }) => panes[states.findIndex((entry) => entry.id === id)] === state.tmuxSession);
      return when(ok, `4 session files, 4 session ids, 4 tmux sessions (${states.map(({ state }) => state.tmuxSession).join(', ')}); each worker's own pane reports the session the host recorded`, `files ${states.map(({ state }) => state.sessionFile).join()}; tmux ${states.map(({ state }) => state.tmuxSession).join()}; pane names ${panes.join()}`);
    }),
    check('worker-concurrency.distinct-worktrees-and-branches', 'every worker ran inside its own worktree on its own new branch pstack-run/<run>/<worker>, each started at the input commit and ending with its own commit only', SRC, (view) => {
      const problems = allWorkers(view).flatMap((worker) => {
        const branch = `pstack-run/${RUN}/${worker.id}`;
        const commits = view.git.branchCommits[branch] ?? [];
        const tree = view.git.worktrees.find((entry) => entry.branch === branch);
        const files = commits.length === 1 ? view.git.branchCommits[branch] : [];
        return [...(tree === undefined ? [`${worker.id}: no worktree on ${branch}`] : []), ...(worker.session?.cwd !== worker.worktree ? [`${worker.id}: session cwd ${worker.session?.cwd} is not its worktree ${worker.worktree}`] : []), ...(files?.length === 1 ? [] : [`${worker.id}: ${commits.length} commits on its branch`])];
      });
      const trees = allWorkers(view).map((worker) => worker.worktree);
      return when(problems.length === 0 && new Set(trees).size === 4, `4 worktrees, 4 branches, one commit each, sessions started in their own tree`, problems.join('; ') || `distinct worktrees: ${new Set(trees).size}`);
    }),
    check('worker-concurrency.no-worker-saw-anothers-files', 'each worktree holds its own helper file and none of the other three', SRC, (view) => {
      const problems = Object.keys(MODELS).flatMap((id) => {
        const tree = view.runs[0]?.workers.find((worker) => worker.id === id)?.worktree;
        const dirty = tree === null || tree === undefined ? [] : (view.git.worktreeDirty[tree] ?? []);
        return dirty.length === 0 ? [] : [`${id} worktree has uncommitted ${dirty.join(',')}`];
      });
      return when(problems.length === 0, 'no worktree has uncommitted or foreign files', problems.join('; '));
    }),
    check('worker-concurrency.assignments-differ-only-where-intended', 'the four assignments are for the same role and input commit and differ in worker id and model', SRC, (view) => {
      const inputs = new Set(allWorkers(view).map((worker) => assignmentOf(worker).workspace?.inputCommit));
      const models = new Set(allWorkers(view).map((worker) => assignmentOf(worker).model));
      return when(inputs.size === 1 && models.size === 3, 'one input commit, three models', `${inputs.size} input commits, ${models.size} models`);
    }),
    check('worker-concurrency.workers-get-their-own-pane-env', "each worker's $TMUX_PANE names its own pane, not the pane its parent runs in", SRC, (view) => {
      const rows = view.runs[0]?.workers.map((worker) => ({ id: worker.id, row: identity(worker.dir) })) ?? [];
      const wrong = rows.filter(({ row }) => row.length < 3 || row[2] !== row[1]);
      return when(rows.length === 4 && wrong.length === 0, 'every worker sees its own pane id', `${wrong.map(({ id, row }) => `${id} is in pane ${row[1]} but $TMUX_PANE is ${row[2]}`).join('; ')}`);
    }),
    settledAndCollected('worker-concurrency.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  knownDefects: [{ checkId: 'worker-concurrency.workers-get-their-own-pane-env', defect: 'src/workers.ts:520-526 builds the worker environment from the parent snapshot (launchEnvironment), which carries the parent\'s TMUX and TMUX_PANE over the values tmux gives the worker pane; only container workers drop them (src/container.ts:49 hostOnlyEnv). A host worker that runs a bare tmux command targets its parent\'s pane.' }],
  negatives: [
    { name: 'two workers share one tmux session', mutate: (sandbox) => overwrite(join(sandbox, 'repo/.pi/pstack/runs', RUN, 'workers/worker-b/state.json'), (text) => text.replace(/"tmuxSession": "[^"]+"/, `"tmuxSession": "${/"tmuxSession": "([^"]+)"/.exec(readFileSync(join(sandbox, 'repo/.pi/pstack/runs', RUN, 'workers/worker-a/state.json'), 'utf8'))?.[1]}"`)), fails: ['worker-concurrency.distinct-sessions-and-panes'] },
    { name: 'a worker ran inside another worker\'s worktree', mutate: (sandbox) => setSessionCwd(workerSessionFile(sandbox, RUN, 'worker-b'), join(sandbox, 'repo/.pi/pstack/runs', RUN, 'workers/worker-a/worktree')), fails: ['worker-concurrency.distinct-worktrees-and-branches'] },
    { name: 'spawn blocked until the workers finished', mutate: (sandbox) => overwrite(join(sandbox, 'repo/.pi/pstack/runs', RUN, 'events.jsonl'), (text) => text.split('\n').map((line) => (line.includes('"workerId":"worker-d"') && line.includes('"kind":"spawn"') ? line.replace(/"ts":"[^"]+"/, '"ts":"2099-01-01T00:00:00.000Z"') : line)).join('\n')), fails: ['worker-concurrency.spawn-does-not-block'] },
    { name: 'all four workers ran on one model', mutate: (sandbox) => patchAssignment(sandbox, RUN, 'worker-b', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: ['worker-concurrency.assignments-differ-only-where-intended'] },
  ],
};

/** [session, pane id, $TMUX_PANE] as the worker's own shell recorded them. */
function identity(workerDir: string): string[] {
  try {
    return readFileSync(join(workerDir, 'tmux-identity.txt'), 'utf8').trim().split(' ');
  } catch {
    return [];
  }
}
