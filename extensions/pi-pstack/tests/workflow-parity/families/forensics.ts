// Families: runtime-forensics, trace-forensics, visual-parity (spec 12.3).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import {
  CONFIG_JS,
  cartHistory,
  indexProfile,
  INDEXER_JS,
  lineOf,
  spinHistory,
  UI_BADGE_V2,
  UI_BUTTON_V2,
  UI_PALETTE_V2,
  uiHistory,
} from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import {
  allWorkers,
  assignmentOf,
  branchCommits,
  collectOrder,
  everyCommitGreen,
  filesChanged,
  finalReply,
  noToolErrors,
  playbookReads,
  primaryRun,
  promptRoutes,
  readonlyEnforced,
  repoUntouched,
  runAtCommit,
  settledAndCollected,
  spawnOrder,
  todoChecks,
  workersCheck,
  worktreeIsolation,
  writableWorkerRecords,
} from '../lib/checks.ts';
import { SCRIPTED_ROLES } from '../lib/driver.ts';
import type { Commit } from '../lib/driver.ts';
import { appendToolCall, corruptArtifact, dirtyRepo, parentSession, patchAssignment, refreshGit, rewriteFinalReply, squashBranch, workerSessionFile } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import { todoNegatives, worktreeOf, writer } from './shared.ts';
import type { Family } from './types.ts';

const model = (line: string) => String(SCRIPTED_ROLES[line]);
const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const rewriteSession = (sandbox: string, from: string | RegExp, to: string) => {
  const file = parentSession(sandbox);
  writeFileSync(file, typeof from === 'string' ? read(file).replaceAll(from, to) : read(file).replace(from, to));
};

/** The function with the most self time in a V8 cpuprofile, computed here from its samples, not taken from anyone's report. */
export function topSelf(profilePath: string): { fn: string; url: string; line: number; share: number } | undefined {
  try {
    const profile = JSON.parse(read(profilePath)) as { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] };
    const self = new Map<number, number>();
    profile.samples.forEach((id, index) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0)));
    const total = [...self.values()].reduce((sum, value) => sum + value, 0);
    const ranked = [...self.entries()].map(([id, time]) => ({ node: profile.nodes.find((entry) => entry.id === id), time })).filter((entry) => entry.node !== undefined && !entry.node.callFrame.functionName.startsWith('(') && entry.node.callFrame.functionName !== '');
    ranked.sort((a, b) => b.time - a.time);
    const top = ranked[0];
    return top?.node === undefined ? undefined : { fn: top.node.callFrame.functionName, url: top.node.callFrame.url, line: top.node.callFrame.lineNumber + 1, share: top.time / total };
  } catch {
    return undefined;
  }
}

// ---- runtime forensics

const CAPTURE = (artifacts: string) => `node --cpu-prof --cpu-prof-dir=${artifacts}/prof --cpu-prof-name=spin.cpuprofile bin/spinner.js && echo captured`;
const REDUCER = (profile: string) => `node -e "const p=JSON.parse(require('fs').readFileSync('${profile}','utf8'));const t=new Map();p.samples.forEach((id,i)=>t.set(id,(t.get(id)||0)+p.timeDeltas[i]));const top=[...t].filter(([id])=>!p.nodes.find((n)=>n.id===id).callFrame.functionName.startsWith('(')).sort((a,b)=>b[1]-a[1])[0];const n=p.nodes.find((x)=>x.id===top[0]).callFrame;console.log(n.functionName+' '+n.url+' line '+(n.lineNumber+1))"`;

export const runtimeForensicsFamily: Family = {
  id: 'runtime-forensics',
  title: 'Runtime forensics playbook: a real CPU profile of the live process, reduced by a subagent, mechanism proven, mapped to source, no fix (spec 12.3)',
  spec: {
    family: 'runtime-forensics',
    runId: 'forensic-spin',
    history: spinHistory,
    prompt: () => '/poteto-mode the spinner program in bin/spinner.js burns CPU. Find out why from a profile of it running. Diagnose only, do not fix.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      const profile = join(artifacts, 'prof', 'spin.cpuprofile');
      const hotLine = lineOf(spinHistory, 'src/spin.js', 'export function hotLoop');
      parent.beginPlaybook('runtime-forensics', 'Runtime forensics: spinner CPU');
      parent.readSkill('principle-guard-the-context-window').readSkill('control-cli');
      parent.proof({ id: 'rt-capture', target: 'step-1', command: CAPTURE(artifacts), kind: 'trace', artifacts: [profile], commit: ctx.base });
      parent.done('runtime-forensics', 1, 'rt-capture');
      parent.spawn('reducer', { role: 'general', model: model('how explorer'), workspace: parent.readonly() }, `Reduce the CPU profile at ${profile} to the smoking gun: the function with the most self time and its source location. Keep the finding short.`);
      parent.wait('reducer').collect('reducer');
      parent.proof({ id: 'rt-reduced', target: 'step-2', command: REDUCER(profile), kind: 'review' });
      parent.done('runtime-forensics', 2, 'rt-reduced');
      parent.proof({ id: 'rt-mechanism', target: 'step-3', command: `node --input-type=module -e "import('./src/spin.js').then((m)=>{let calls=0;const end=Date.now()+300;while(Date.now()<end){m.hotLoop(200000);calls+=1}console.log('hotLoop calls in 300ms='+calls)})"`, kind: 'measurement' });
      parent.done('runtime-forensics', 3, 'rt-mechanism');
      parent.proof({ id: 'rt-source', target: 'step-4', command: `sed -n '${hotLine}p' src/spin.js | grep -q hotLoop`, kind: 'command' });
      parent.done('runtime-forensics', 4, 'rt-source');
      parent.task('throughput checkpoint: n/a, read-only forensics');
      parent.proof({ id: 'rt-checkpoint', target: 'step-5', command: `grep -F 'throughput checkpoint: n/a, read-only forensics' ${join(parent.runDir, 'TODO.md')}`, kind: 'review' });
      parent.done('runtime-forensics', 5, 'rt-checkpoint');
      parent.text(`Signal captured: a V8 CPU profile of bin/spinner.js running, from node --cpu-prof.\nReduced finding: hotLoop holds nearly all self time.\nMechanism proof: with a call counter around it, hotLoop ran thousands of times in 300ms, so the loop is the work.\nSource location: src/spin.js:${hotLine} hotLoop.\nArtifact paths: ${profile}.\nNo fix was made.`);
      return scenario(parent, { reducer: new Worker().call('bash_readonly', { command: REDUCER(profile) }).text(`hotLoop file://${ctx.repo}/src/spin.js line ${hotLine}`) });
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('runtime-forensics'),
    ...todoChecks({ playbook: 'runtime-forensics' }),
    check('rt.signal-is-a-real-cpu-profile-from-the-process', 'step 1: the artifact is a V8 CPU profile that --cpu-prof wrote while the real program ran, and the receipt hashes it', src('poteto-mode/playbooks/runtime-forensics.md', 'A real artifact, not a guess'), (view) => {
      const receipt = primaryRun(view, 'runtime-forensics')?.receipts.find((entry) => entry.id === 'rt-capture');
      const profile = receipt?.artifacts.find((artifact) => artifact.path.endsWith('.cpuprofile'));
      const top = profile === undefined ? undefined : topSelf(profile.path);
      return when(profile !== undefined && /--cpu-prof/.test(String(receipt?.command?.[2])) && /bin\/spinner\.js/.test(String(receipt?.command?.[2])) && top !== undefined && top.share > 0.1, `profile ${profile?.path.split('/').pop()}, top self-time ${top?.fn} at ${(100 * (top?.share ?? 0)).toFixed(0)}%`, `receipt command ${JSON.stringify(receipt?.command)}, profile ${profile?.path}, top ${JSON.stringify(top)}`);
    }),
    check('rt.finding-is-the-profiles-hot-function', 'the reply names the function the checker finds hottest in the profile, and cites a source location that holds that function', src('poteto-mode/playbooks/runtime-forensics.md', 'Reduce the artifact to the smoking gun'), (view) => {
      const profile = primaryRun(view, 'runtime-forensics')?.receipts.find((entry) => entry.id === 'rt-capture')?.artifacts.find((artifact) => artifact.path.endsWith('.cpuprofile'));
      const top = profile === undefined ? undefined : topSelf(profile.path);
      const reply = finalReply(view);
      const cited = /Source location: ([\w./-]+):(\d+)/.exec(reply);
      const line = cited === null ? '' : (read(join(view.repo, cited[1] as string)).split('\n')[Number(cited[2]) - 1] ?? '');
      return when(top !== undefined && reply.includes(`hotLoop`) && top.fn === 'hotLoop' && cited !== null && line.includes(top.fn) && top.url.endsWith(String(cited[1])), `hottest ${top?.fn} (${top?.url.split('/').slice(-2).join('/')}:${top?.line}); the reply cites ${cited?.[1]}:${cited?.[2]}, which reads: ${line.trim()}`, `hottest ${JSON.stringify(top)}; cited ${cited?.[0]}; line "${line.trim()}"`);
    }),
    check('rt.reduction-in-a-subagent', 'step 2: the profile is parsed by a readonly worker that ran a command on it', src('poteto-mode/playbooks/runtime-forensics.md', 'Parse large artifacts in a subagent'), (view) => {
      const profiles = primaryRun(view, 'runtime-forensics')?.receipts.flatMap((receipt) => receipt.artifacts.filter((artifact) => artifact.path.endsWith('.cpuprofile')).map((artifact) => artifact.path)) ?? [];
      const candidates = allWorkers(view).filter((worker) => worker.session?.toolCalls.some((call) => {
        const command = String(call.args['command'] ?? '');
        return ['bash_readonly', 'bash'].includes(call.name) && !call.isError && profiles.some((profile) => command.includes(profile)) && /JSON\.parse|json\.load|jq\b/.test(command) && /samples|nodes|timeDeltas/.test(command);
      }));
      if (candidates.length !== 1) return fail(`profile reduction candidates: ${candidates.map((worker) => worker.id).join(', ') || 'none'}`);
      return workersCheck('', '', [], { role: 'general', min: 1, max: 1, mode: 'readonly', rootPath: true, modelLine: 'how explorer' }).run({ ...view, runs: view.runs.map((run) => ({ ...run, workers: run.workers.filter((worker) => candidates.includes(worker)) })) });
    }),
    readonlyEnforced('rt.reducer-readonly', src('poteto-mode/playbooks/runtime-forensics.md', 'Parse large artifacts in a subagent'), ['general']),
    check('rt.mechanism-proven-by-instrumentation', 'step 3: the hypothesis is confirmed by instrumentation the parent ran on the code, with a passing receipt', src('poteto-mode/playbooks/runtime-forensics.md', 'Prove the mechanism before believing it'), (view) => {
      const receipt = primaryRun(view, 'runtime-forensics')?.receipts.find((entry) => entry.id === 'rt-mechanism');
      const output = receipt?.artifacts[0] === undefined ? '' : read(receipt.artifacts[0].path);
      return when(receipt?.exitCode === 0 && /hotLoop calls in 300ms=\d+/.test(output), output.trim(), `receipt ${JSON.stringify(receipt?.exitCode)}, output ${output.trim()}`);
    }),
    check('rt.throughput-checkpoint-line', 'step 5: the checkpoint stays one literal line', src('poteto-mode/playbooks/runtime-forensics.md', 'Throughput checkpoint stays one line'), (view) => when((primaryRun(view, 'runtime-forensics')?.todoText?.split('## Task-specific work')[1] ?? '').includes('throughput checkpoint: n/a, read-only forensics'), 'the line is in TODO.md', 'TODO.md lacks the line')),
    repoUntouched('rt.no-fix-unless-asked', 'the deliverable is a diagnosis: the program and the repository are unchanged', src('poteto-mode/playbooks/runtime-forensics.md', 'No fix unless asked')),
    check('rt.reply-has-the-five-parts', 'the reply gives the signal captured, the reduced finding, how the mechanism was proved, the source location, and the artifact paths', src('poteto-mode/playbooks/runtime-forensics.md', '**Reply:** the signal captured'), (view) => {
      const reply = finalReply(view);
      const missing = [/Signal captured:/, /Reduced finding:/, /Mechanism proof:/, /Source location:/, /Artifact paths: \//].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'five parts present', `missing ${missing.join(', ')}`);
    }),
    settledAndCollected('rt.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
    noToolErrors('rt.no-tool-errors', src('poteto-mode/playbooks/runtime-forensics.md', '**You own the diagnosis.')),
  ],
  negatives: [
    ...todoNegatives('forensic-spin', 'runtime-forensics', { done: [1, 2, 3, 4, 5], receipts: { 1: 'rt-capture', 2: 'rt-reduced', 3: 'rt-mechanism', 4: 'rt-source', 5: 'rt-checkpoint' } }),
    { name: 'the reply blames a cold function', mutate: (sandbox) => rewriteFinalReply(sandbox, /hotLoop/g, 'idleTick'), fails: ['rt.finding-is-the-profiles-hot-function'] },
    { name: 'the cited line does not hold the function', mutate: (sandbox) => rewriteFinalReply(sandbox, /src\/spin\.js:\d+/, 'src/spin.js:1'), fails: ['rt.finding-is-the-profiles-hot-function'] },
    { name: 'the profile was edited after it was hashed', mutate: (sandbox) => corruptArtifact(sandbox, 'forensic-spin', 'rt-capture'), fails: ['todo.runtime-forensics.done-steps-proven'] },
    { name: 'the profile was never captured from the program', mutate: (sandbox) => emptyProfile(sandbox), fails: ['rt.signal-is-a-real-cpu-profile-from-the-process'] },
    { name: 'a fix was applied', mutate: (sandbox) => dirtyRepo(sandbox, 'src/spin.js'), fails: ['rt.no-fix-unless-asked'] },
    { name: 'the reducer wrote a file', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, 'forensic-spin', 'reducer'), 'write', { path: '/x', content: 'x' }), fails: ['rt.reducer-readonly'] },
    { name: 'the mechanism was asserted, not instrumented', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/forensic-spin/verification/artifacts/rt-mechanism.txt'), 'it is the loop\n'), fails: ['rt.mechanism-proven-by-instrumentation'] },
    { name: 'the checkpoint line is missing', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/forensic-spin/TODO.md'), read(join(sandbox, 'repo/.pi/pstack/runs/forensic-spin/TODO.md')).replace(/(## Task-specific work[\s\S]*)throughput checkpoint: n\/a, read-only forensics/, '$1none')), fails: ['rt.throughput-checkpoint-line'] },
  ],
};

function emptyProfile(sandbox: string): void {
  const path = join(sandbox, 'repo/.pi/pstack/runs/forensic-spin/verification/artifacts/prof/spin.cpuprofile');
  writeFileSync(path, JSON.stringify({ nodes: [], samples: [], timeDeltas: [] }));
  const receipt = join(sandbox, 'repo/.pi/pstack/runs/forensic-spin/verification/receipts/rt-capture.json');
  const recorded = JSON.parse(read(receipt)) as { receipt: { artifacts: { path: string; sha256: string }[] } };
  for (const artifact of recorded.receipt.artifacts) if (artifact.path.endsWith('.cpuprofile')) artifact.sha256 = sha256(path);
  writeFileSync(receipt, JSON.stringify(recorded));
}

// ---- trace forensics

const traceHistory = (repoMarker: string): Commit[] => [
  ...cartHistory,
  { message: 'feat: indexer and config (#180)', files: { 'src/config.js': CONFIG_JS, 'src/indexer.js': INDEXER_JS, 'traces/index.cpuprofile': indexProfile(repoMarker) } },
];
const TRACE_MARKER = '/REPO';
const DUMP = `import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const [profilePath, dbPath] = process.argv.slice(2);
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
const db = new DatabaseSync(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS frames (id INTEGER PRIMARY KEY, fn TEXT, url TEXT, line INTEGER, self_us INTEGER)');
const self = new Map();
profile.samples.forEach((id, index) => self.set(id, (self.get(id) ?? 0) + profile.timeDeltas[index]));
const insert = db.prepare('INSERT INTO frames VALUES (?, ?, ?, ?, ?)');
for (const node of profile.nodes) insert.run(node.id, node.callFrame.functionName, node.callFrame.url, node.callFrame.lineNumber + 1, self.get(node.id) ?? 0);
console.log('rows=' + profile.nodes.length);
`;
const TOP_QUERY = (db: string) => `node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('${db}'); const row = db.prepare(\\"SELECT fn, url, line, self_us FROM frames WHERE fn NOT LIKE '(%' ORDER BY self_us DESC LIMIT 1\\").get(); console.log(row.fn + ' ' + row.url + ' line ' + row.line + ' self_us=' + row.self_us)"`;

export const traceForensicsFamily: Family = {
  id: 'trace-forensics',
  title: 'Trace forensics playbook: a handed-over profile loaded into sqlite, narrowed, attributed to source, labeled a hypothesis, never re-run (spec 12.3)',
  spec: {
    family: 'trace-forensics',
    runId: 'trace-index',
    history: traceHistory(TRACE_MARKER),
    prompt: () => '/poteto-mode here is a CPU profile from a slow indexing run, traces/index.cpuprofile. Tell me where the time went. Diagnose only.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      const db = join(artifacts, 'trace.db');
      const profile = join(ctx.repo, 'traces/index.cpuprofile');
      const hotLine = lineOf(traceHistory(TRACE_MARKER), 'src/indexer.js', 'export function buildIndex');
      parent.beginPlaybook('trace-forensics', 'Trace forensics: slow indexing');
      parent.readSkill('principle-guard-the-context-window');
      parent.bash(`head -c 300 ${profile}`);
      parent.proof({ id: 'tr-format', target: 'step-1', command: `node -e "const p=JSON.parse(require('fs').readFileSync('${profile}','utf8'));if(!p.nodes||!p.samples||!p.timeDeltas)process.exit(1);console.log('cpuprofile nodes='+p.nodes.length+' samples='+p.samples.length)"`, kind: 'review' });
      parent.done('trace-forensics', 1, 'tr-format');
      parent.write(join(artifacts, 'dump.mjs'), DUMP);
      parent.proof({ id: 'tr-sqlite', target: 'step-2', command: `rm -f ${db} && node --disable-warning=ExperimentalWarning ${artifacts}/dump.mjs ${profile} ${db}`, kind: 'command', artifacts: [db] });
      parent.done('trace-forensics', 2, 'tr-sqlite');
      parent.proof({ id: 'tr-narrow', target: 'step-3', command: TOP_QUERY(db), kind: 'measurement' });
      parent.done('trace-forensics', 3, 'tr-narrow');
      parent.proof({ id: 'tr-source', target: 'step-4', command: `sed -n '${hotLine}p' src/indexer.js | grep -q buildIndex`, kind: 'command' });
      parent.done('trace-forensics', 4, 'tr-source');
      parent.skip('trace-forensics', 5, 'there is no paired capture, so the finding is marked as the strongest hypothesis the artifact supports');
      parent.task('throughput checkpoint: n/a, read-only forensics');
      parent.proof({ id: 'tr-handback', target: 'step-6', command: `grep -F 'throughput checkpoint: n/a, read-only forensics' ${join(parent.runDir, 'TODO.md')}`, kind: 'review' });
      parent.done('trace-forensics', 6, 'tr-handback');
      parent.text(`Artifact and format: traces/index.cpuprofile, a V8 cpuprofile.\nReduced finding: buildIndex holds most of the self time, 12 of 18 samples.\nSource location: src/indexer.js:${hotLine} buildIndex.\nArtifact paths: ${db}.\nPaired capture: none, so this is the strongest hypothesis the artifact supports, not a confirmed cause.`);
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('trace-forensics'),
    ...todoChecks({ playbook: 'trace-forensics', skipReason: { 5: /paired|hypothesis/i } }),
    check('trace.dumped-into-a-queryable-sqlite-table', 'step 2: the profile is in a sqlite table with one row per node and the self time of each, and the checker re-derives the same totals from the profile', src('poteto-mode/playbooks/trace-forensics.md', 'Dump the trace or heap snapshot into sqlite, one row per sample, frame, or node'), (view) => {
      const run = primaryRun(view, 'trace-forensics');
      const db = join(run?.dir ?? '', 'verification/artifacts/trace.db');
      const profile = join(view.repo, 'traces/index.cpuprofile');
      const parsed = JSON.parse(read(profile)) as { nodes: unknown[]; timeDeltas: number[] };
      const query = spawnSync('node', ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('${db}'); console.log(JSON.stringify(db.prepare('SELECT COUNT(*) AS n, SUM(self_us) AS total FROM frames').get()))`], { encoding: 'utf8' });
      const row = query.status === 0 ? (JSON.parse(query.stdout) as { n: number; total: number }) : undefined;
      return when(row !== undefined && row.n === parsed.nodes.length && row.total === parsed.timeDeltas.reduce((sum, value) => sum + value, 0), `${row?.n} rows, ${row?.total} total self microseconds, both match the profile`, `query exit ${query.status}: ${query.stderr.slice(0, 120)}; row ${JSON.stringify(row)}`);
    }),
    check('trace.finding-is-the-profiles-hot-frame', 'the reply names the frame the checker finds hottest in the profile and attributes it to a source line that holds it', src('poteto-mode/playbooks/trace-forensics.md', 'Query for the frames that hold the most time'), (view) => {
      const top = topSelf(join(view.repo, 'traces/index.cpuprofile'));
      const reply = finalReply(view);
      const cited = /Source location: ([\w./-]+):(\d+)/.exec(reply);
      const line = cited === null ? '' : (read(join(view.repo, cited[1] as string)).split('\n')[Number(cited[2]) - 1] ?? '');
      return when(top !== undefined && reply.includes(top.fn) && cited !== null && line.includes(top.fn) && top.url.endsWith(String(cited[1])), `hottest ${top?.fn} cited at ${cited?.[1]}:${cited?.[2]}`, `hottest ${JSON.stringify(top)}; cited ${cited?.[0]}; line "${line.trim()}"`);
    }),
    check('trace.labeled-a-hypothesis-without-a-paired-capture', 'step 5: with no paired capture the reply says the finding is the strongest hypothesis, not a confirmed cause', src('poteto-mode/playbooks/trace-forensics.md', 'mark the finding as the strongest hypothesis the artifact supports'), (view) => {
      const reply = finalReply(view);
      return when(/Paired capture: none/.test(reply) && /strongest hypothesis/.test(reply) && !/\bis confirmed\b|the confirmed cause\b/.test(reply.replace('not a confirmed cause', '')), 'labeled a hypothesis', `reply: ${reply.slice(-160)}`);
    }),
    check('trace.artifact-is-read-not-re-run', 'the capture is a fixed dataset: it is unchanged from the commit and the program was never run again', src('poteto-mode/playbooks/trace-forensics.md', 'The artifact is a fixed dataset, read it, don\'t re-run it'), (view) => {
      const committed = execFileSync('git', ['-C', view.repo, 'show', `${view.base}:traces/index.cpuprofile`], { encoding: 'utf8' });
      const reruns = [view.parent, ...allWorkers(view).map((worker) => worker.session)].flatMap((session) => session?.toolCalls ?? []).filter((call) => call.name === 'bash' && /\bnode\s+(?:--?\S+\s+)*(?:\S*\/)?(?:src|bin)\/(?:indexer|config|run)\.js/.test(String(call.args['command'])));
      return when(committed === read(join(view.repo, 'traces/index.cpuprofile')) && reruns.length === 0, 'the profile is byte-identical and nothing was re-run', `profile changed ${committed !== read(join(view.repo, 'traces/index.cpuprofile'))}; re-runs ${reruns.length}`);
    }),
    check('trace.throughput-checkpoint-line', 'the checkpoint stays one literal line', src('poteto-mode/playbooks/trace-forensics.md', 'Throughput checkpoint stays one line'), (view) => when((primaryRun(view, 'trace-forensics')?.todoText?.split('## Task-specific work')[1] ?? '').includes('throughput checkpoint: n/a, read-only forensics'), 'the line is in TODO.md', 'TODO.md lacks the line')),
    repoUntouched('trace.no-fix-unless-asked', 'the deliverable is a diagnosis: nothing in the repository changed', src('poteto-mode/playbooks/trace-forensics.md', 'Hand back a cited diagnosis, no fix unless asked')),
    check('trace.reply-has-the-four-parts', 'the reply gives the artifact and format, the reduced finding, the source location, the artifact paths, and whether a paired capture confirmed it', src('poteto-mode/playbooks/trace-forensics.md', '**Reply:** the artifact and format'), (view) => {
      const reply = finalReply(view);
      const missing = [/Artifact and format:/, /Reduced finding:/, /Source location:/, /Artifact paths: \//, /Paired capture:/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'all parts present', `missing ${missing.join(', ')}`);
    }),
    noToolErrors('trace.no-tool-errors', src('poteto-mode/playbooks/trace-forensics.md', '**You own the diagnosis from the artifact.**')),
  ],
  negatives: [
    ...todoNegatives('trace-index', 'trace-forensics', { done: [1, 2, 3, 4, 6], receipts: { 1: 'tr-format', 2: 'tr-sqlite', 3: 'tr-narrow', 4: 'tr-source', 6: 'tr-handback' } }),
    { name: 'the sqlite table does not hold the profile', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/trace-index/verification/artifacts/trace.db'), ''), fails: ['trace.dumped-into-a-queryable-sqlite-table'] },
    { name: 'the reply blames the wrong frame', mutate: (sandbox) => rewriteFinalReply(sandbox, /buildIndex/g, 'parseConfig'), fails: ['trace.finding-is-the-profiles-hot-frame'] },
    { name: 'the finding was presented as confirmed', mutate: (sandbox) => rewriteFinalReply(sandbox, 'so this is the strongest hypothesis the artifact supports, not a confirmed cause', 'so this is confirmed'), fails: ['trace.labeled-a-hypothesis-without-a-paired-capture'] },
    { name: 'the program was re-run', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'node bin/run.js' }), fails: ['trace.artifact-is-read-not-re-run'] },
    { name: 'the capture was edited', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/traces/index.cpuprofile'), '{}'), fails: ['trace.artifact-is-read-not-re-run'] },
    { name: 'a fix was applied', mutate: (sandbox) => dirtyRepo(sandbox, 'src/indexer.js'), fails: ['trace.no-fix-unless-asked'] },
    { name: 'the source line does not hold the frame', mutate: (sandbox) => rewriteFinalReply(sandbox, /src\/indexer\.js:\d+/, 'src/indexer.js:1'), fails: ['trace.finding-is-the-profiles-hot-frame'] },
  ],
};

// ---- visual parity

const UI_STATES = ['idle', 'hover'];
const COMPONENTS = ['button', 'badge'];
const BASELINE_DIR = 'ui/baseline';
const PARITY_CMD = (components: string[]) => `for c in ${components.join(' ')}; do for s in ${UI_STATES.join(' ')}; do node ui/render.mjs $c $s | cmp -s - ${BASELINE_DIR}/$c-$s.ppm || { echo "diff at $c $s"; exit 1; }; done; done; echo diff=0`;
const IMGDIFF = (component: string) => `for s in ${UI_STATES.join(' ')}; do node ui/render.mjs ${component} $s > "\${TMPDIR:-/tmp}/vp.ppm"; node ui/imgdiff.mjs ${BASELINE_DIR}/${component}-$s.ppm "\${TMPDIR:-/tmp}/vp.ppm"; done`;
const CLAUSES = 'Hold these: no harness modifications (ui/render.mjs, ui/imgdiff.mjs stay as they are), no baseline tampering (ui/baseline stays as it is), no component restructuring to make a diff pass. If the baseline looks wrong, stop and say so.';

export const visualParityFamily: Family = {
  id: 'visual-parity',
  title: 'Visual parity playbook: baseline before any migration, anti-shortcut clauses held, primitives first, one owner per component, zero pixel diff (spec 12.3)',
  spec: {
    family: 'visual-parity',
    runId: 'parity-ui',
    history: uiHistory,
    prompt: () => '/poteto-mode migrate the button and badge renderers in ui/ to the table based style with pixel exact output',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      const branch = (id: string) => `pstack-run/${ctx.runId}/${id}`;
      parent.beginPlaybook('visual-parity', 'Visual parity: button and badge');
      parent.readSkill('principle-separate-before-serializing-shared-state').readSkill('control-ui');
      parent.bash(`cd ${ctx.repo} && mkdir -p ${BASELINE_DIR} && for c in ${COMPONENTS.join(' ')}; do for s in ${UI_STATES.join(' ')}; do node ui/render.mjs $c $s > ${BASELINE_DIR}/$c-$s.ppm; done; done && git add ${BASELINE_DIR} && git -c user.name=vp -c user.email=v@example.com commit -q -m "baseline: screenshots of every component state before the migration"`);
      parent.proof({ id: 'vp-baseline', target: 'step-1', command: `test $(ls ${BASELINE_DIR} | wc -l) -eq 4`, kind: 'command', gitDir: ctx.repo });
      parent.done('visual-parity', 1, 'vp-baseline');
      parent.proof({ id: 'vp-clauses', target: 'step-2', command: `printf 'clauses are in every brief\\n'`, kind: 'review' });
      parent.done('visual-parity', 2, 'vp-clauses');
      parent.spawnFromRef('prim', 'owner', model('feature, refactoring'), 'HEAD', `Migrate the shared primitive first, ui/palette.js: store colors as rgb arrays and keep rgb() accepting both forms. ${CLAUSES}`);
      workers['prim'] = writer(parent, 'prim', { units: [{ files: { 'ui/palette.js': UI_PALETTE_V2 }, commit: 'migrate the shared palette' }], test: PARITY_CMD(COMPONENTS), testKind: 'command', report: 'The palette now holds arrays, rgb() accepts both, every component state renders the same bytes.' });
      parent.wait('prim').collect('prim');
      parent.spawnFromRef('owner-button', 'owner', model('feature, refactoring'), branch('prim'), `Migrate ui/button.js to the table based style. ${CLAUSES}`);
      parent.spawnFromRef('owner-badge', 'owner', model('feature, refactoring'), branch('prim'), `Migrate ui/badge.js to the table based style. ${CLAUSES}`);
      workers['owner-button'] = writer(parent, 'owner-button', { units: [{ files: { 'ui/button.js': UI_BUTTON_V2 }, commit: 'migrate the button' }], test: PARITY_CMD(['button']), testKind: 'command', report: 'The button renders the baseline bytes in both states.' });
      workers['owner-badge'] = writer(parent, 'owner-badge', { units: [{ files: { 'ui/badge.js': UI_BADGE_V2 }, commit: 'migrate the badge' }], test: PARITY_CMD(['badge']), testKind: 'command', report: 'The badge renders the baseline bytes in both states.' });
      parent.wait('owner-button').wait('owner-badge').collect('owner-button', 'owner-badge');
      parent.done('visual-parity', 3, 'prim-check', 'owner-button-check', 'owner-badge-check');
      parent.proof({ id: 'vp-button-diff', target: 'owner-button', command: IMGDIFF('button'), cwd: worktreeOf(parent, 'owner-button'), kind: 'command' });
      parent.proof({ id: 'vp-badge-diff', target: 'owner-badge', command: IMGDIFF('badge'), cwd: worktreeOf(parent, 'owner-badge'), kind: 'command' });
      parent.done('visual-parity', 4, 'vp-button-diff', 'vp-badge-diff');
      parent.skip('visual-parity', 5, 'this repository has no remote, so no PR is opened here');
      parent.text('Components migrated: button and badge, after the shared palette.\nDiff result: button diff=0 in idle and hover, badge diff=0 in idle and hover.\nBaseline harness: ui/baseline holds the four screenshots, committed before any migration, with ui/render.mjs and ui/imgdiff.mjs unchanged.\nWhat is left: nothing, every component is migrated.');
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('visual-parity'),
    ...todoChecks({ playbook: 'visual-parity', skipReason: { 5: /PR|remote/i } }),
    check('vp.baseline-first-and-real', 'step 1: the baseline is committed before any worker is spawned, holds every component state, and equals what the unmigrated code renders', src('poteto-mode/playbooks/visual-parity.md', 'Establish the baseline first, before any migration'), (view) => {
      const baseline = [...view.git.commitsSinceBase].reverse()[0];
      const files = baseline === undefined ? [] : filesChanged(view, baseline);
      const first = Math.min(...allWorkers(view).map((worker) => spawnOrder(view, worker.id)));
      const baselineRun = view.parent.toolCalls.find((call) => call.name === 'bash' && /ui\/baseline/.test(String(call.args['command'])) && /git add/.test(String(call.args['command'])))?.order ?? Number.POSITIVE_INFINITY;
      const mismatched = COMPONENTS.flatMap((component) => UI_STATES.filter((state) => runAtCommit(view, view.base, `node ui/render.mjs ${component} ${state}`).output !== (baseline === undefined ? '' : runAtCommit(view, baseline, `cat ${BASELINE_DIR}/${component}-${state}.ppm`).output)).map((state) => `${component}-${state}`));
      return when(baseline !== undefined && files.length === 4 && files.every((file) => file.startsWith(`${BASELINE_DIR}/`)) && baselineRun < first && mismatched.length === 0, `baseline commit ${baseline?.slice(0, 8)} holds ${files.length} screenshots, taken before the first spawn, equal to the unmigrated render`, `baseline ${baseline}; files ${files.join(', ')}; before spawns ${baselineRun < first}; mismatched ${mismatched.join(', ')}`);
    }),
    check('vp.anti-shortcut-clauses-in-every-brief', 'step 2: every owner brief states no harness changes, no baseline tampering, and no restructuring to pass the diff', src('poteto-mode/playbooks/visual-parity.md', 'Anti-shortcut clauses, stated and held'), (view) => {
      const owners = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'owner');
      const bad = owners.filter((worker) => !/no harness modifications/.test(worker.brief ?? '') || !/no baseline tampering/.test(worker.brief ?? '') || !/no component restructuring/.test(worker.brief ?? ''));
      return when(owners.length >= 3 && bad.length === 0, `${owners.length} briefs carry the three clauses`, `briefs missing a clause: ${bad.map((worker) => worker.id).join(', ')}`);
    }),
    check('vp.baseline-and-harness-untouched', 'every migration branch leaves ui/baseline and the harness scripts byte-identical to the baseline commit', src('poteto-mode/playbooks/visual-parity.md', 'no harness modifications, no baseline tampering'), (view) => {
      const baseline = [...view.git.commitsSinceBase].reverse()[0] ?? '';
      const run = view.runs[0]?.id ?? '';
      const bad = allWorkers(view).flatMap((worker) => {
        const head = branchCommits(view, run, worker.id).at(-1);
        if (head === undefined) return [`${worker.id} has no commit`];
        const diff = spawnSync('git', ['-C', view.repo, 'diff', '--name-only', baseline, head, '--', BASELINE_DIR, 'ui/render.mjs', 'ui/imgdiff.mjs'], { encoding: 'utf8' }).stdout.trim();
        return diff === '' ? [] : [`${worker.id} changed ${diff.split('\n').join(', ')}`];
      });
      return when(baseline !== '' && bad.length === 0, 'baseline and harness are identical on every branch', bad.join('; '));
    }),
    check('vp.pixel-diff-is-zero-by-the-checkers-own-diff', 'step 4: at each owner\'s delivered commit, the checker renders every state of its component and finds zero differing bytes against the baseline', src('poteto-mode/playbooks/visual-parity.md', 'Verify each component against its baseline via image diff'), (view) => {
      const baseline = [...view.git.commitsSinceBase].reverse()[0] ?? '';
      const run = view.runs[0]?.id ?? '';
      const problems = [['owner-button', 'button'], ['owner-badge', 'badge']].flatMap(([id, component]) => {
        const head = branchCommits(view, run, id as string).at(-1) ?? '';
        return UI_STATES.filter((state) => runAtCommit(view, head, `node ui/render.mjs ${component} ${state}`).output !== runAtCommit(view, baseline, `cat ${BASELINE_DIR}/${component}-${state}.ppm`).output).map((state) => `${component} ${state} differs`);
      });
      return when(baseline !== '' && problems.length === 0, 'both components render the baseline bytes in both states', problems.join('; '));
    }),
    check('vp.primitives-first-as-a-blocking-phase', 'step 3: the shared primitive is migrated and collected before any component owner is spawned, and the owners start from its commit', src('poteto-mode/playbooks/visual-parity.md', 'Shared primitives migrate first as a blocking phase'), (view) => {
      const run = view.runs[0]?.id ?? '';
      const primHead = branchCommits(view, run, 'prim').at(-1);
      const owners = ['owner-button', 'owner-badge'];
      const afterCollect = owners.every((id) => spawnOrder(view, id) > collectOrder(view, 'prim') && collectOrder(view, 'prim') !== -1);
      const fromPrim = owners.every((id) => String(assignmentOf(allWorkers(view).find((worker) => worker.id === id) as never).workspace?.inputCommit) === primHead);
      return when(primHead !== undefined && afterCollect && fromPrim, `owners spawned after prim was collected, from ${primHead?.slice(0, 8)}`, `prim head ${primHead}; owners after collect ${afterCollect}; from prim ${fromPrim}`);
    }),
    worktreeIsolation('vp.one-owner-per-component-own-worktree', src('poteto-mode/playbooks/visual-parity.md', 'one owner per component')),
    check('vp.each-owner-touches-only-its-component', 'each owner commit changes its own component file and nothing else', src('poteto-mode/playbooks/visual-parity.md', 'Migrate one component at a time'), (view) => {
      const run = view.runs[0]?.id ?? '';
      const baseline = [...view.git.commitsSinceBase].reverse()[0] ?? '';
      const own = (id: string, below: string[]) => branchCommits(view, run, id).filter((sha) => !below.includes(sha));
      const prim = own('prim', [baseline]);
      const problems = [['owner-button', 'ui/button.js', own('owner-button', [baseline, ...prim])], ['owner-badge', 'ui/badge.js', own('owner-badge', [baseline, ...prim])], ['prim', 'ui/palette.js', prim]].flatMap(([id, file, commits]) => (commits as string[]).flatMap((sha) => filesChanged(view, sha)).filter((changed) => changed !== file).map((changed) => `${id} touched ${changed}`));
      return when(problems.length === 0 && prim.length === 1, 'each commit stays in its own file', problems.join('; ') || `prim commits ${prim.length}`);
    }),
    check('vp.migration-descends-from-the-baseline', 'every migration branch is built on the baseline commit, so no migration predates the baseline', src('poteto-mode/playbooks/visual-parity.md', 'No baseline, no parity claim'), (view) => {
      const baseline = [...view.git.commitsSinceBase].reverse()[0] ?? '';
      const run = view.runs[0]?.id ?? '';
      const bad = allWorkers(view).filter((worker) => {
        const head = branchCommits(view, run, worker.id).at(-1) ?? '';
        return baseline === '' || head === '' || spawnSync('git', ['-C', view.repo, 'merge-base', '--is-ancestor', baseline, head]).status !== 0;
      });
      return when(baseline !== '' && bad.length === 0, 'the baseline is an ancestor of every branch', `not descended from the baseline: ${bad.map((worker) => worker.id).join(', ')}`);
    }),
    everyCommitGreen('vp.owner-commits-keep-parity', src('poteto-mode/playbooks/visual-parity.md', 'A nonzero diff is a fail'), (view) => view.runs[0]?.id ?? '', 'owner-button', { min: 1, command: PARITY_CMD(['button']) }),
    check('vp.reply-has-components-diffs-baseline-and-whats-left', 'the reply names the components migrated, the diff result for each, the baseline harness location, and what is left', src('poteto-mode/playbooks/visual-parity.md', '**Reply:** components migrated'), (view) => {
      const reply = finalReply(view);
      const missing = [/Components migrated:/, /button diff=0/, /badge diff=0/, /Baseline harness: ui\/baseline/, /What is left:/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'all four parts present', `missing ${missing.join(', ')}`);
    }),
    writableWorkerRecords('vp.worker-records', src('poteto-mode/playbooks/visual-parity.md', 'one owner per component'), ['owner']),
    settledAndCollected('vp.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    ...todoNegatives('parity-ui', 'visual-parity', { done: [1, 2, 3, 4], receipts: { 1: 'vp-baseline', 2: 'vp-clauses', 3: 'owner-button-check', 4: 'vp-button-diff' } }),
    { name: 'a migrated component renders different pixels', mutate: (sandbox) => rebaseBranch(sandbox, 'owner-badge', (dir) => writeFileSync(join(dir, 'ui/badge.js'), read(join(dir, 'ui/badge.js')).replace("'badge'", "'badge'").replace('palette.badge', 'palette.fill'))), fails: ['vp.pixel-diff-is-zero-by-the-checkers-own-diff'] },
    { name: 'the baseline was edited to match the migration', mutate: (sandbox) => rebaseBranch(sandbox, 'owner-button', (dir) => writeFileSync(join(dir, 'ui/baseline/button-idle.ppm'), 'P3\n1 1\n255\n0 0 0\n')), fails: ['vp.baseline-and-harness-untouched'] },
    { name: 'the harness was edited', mutate: (sandbox) => rebaseBranch(sandbox, 'owner-button', (dir) => writeFileSync(join(dir, 'ui/imgdiff.mjs'), 'console.log("diff=0");\n')), fails: ['vp.baseline-and-harness-untouched'] },
    { name: 'a migration branch does not descend from the baseline', mutate: (sandbox) => squashBranch(sandbox, 'pstack-run/parity-ui/owner-badge'), fails: ['vp.migration-descends-from-the-baseline'] },
    { name: 'an owner brief dropped the anti-shortcut clauses', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/parity-ui/workers/owner-button/brief.md'), 'Migrate ui/button.js.'), fails: ['vp.anti-shortcut-clauses-in-every-brief'] },
    { name: 'an owner changed a file outside its component', mutate: (sandbox) => rebaseBranch(sandbox, 'owner-badge', (dir) => writeFileSync(join(dir, 'ui/button.js'), `${read(join(dir, 'ui/button.js'))}// stray\n`)), fails: ['vp.each-owner-touches-only-its-component'] },
    { name: 'the owners did not start from the migrated primitive', mutate: (sandbox) => patchAssignment(sandbox, 'parity-ui', 'owner-badge', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: 'abc1234' })), fails: ['vp.primitives-first-as-a-blocking-phase'] },
    { name: 'the reply hid a nonzero diff', mutate: (sandbox) => rewriteFinalReply(sandbox, 'badge diff=0', 'badge looks fine'), fails: ['vp.reply-has-components-diffs-baseline-and-whats-left'] },
  ],
};

/** Adds one commit on a worker branch, built on a detached worktree of that branch. */
function rebaseBranch(sandbox: string, workerId: string, change: (dir: string) => void): void {
  const repo = join(sandbox, 'repo');
  const branch = `pstack-run/parity-ui/${workerId}`;
  const dir = mkdtempSync(join(tmpdir(), 'wf-vp-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=m', '-c', 'user.email=m@x', ...args], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', dir, branch]);
    change(dir);
    git('add', '-A');
    git('commit', '-q', '-m', 'mutation');
    execFileSync('git', ['-C', repo, 'update-ref', `refs/heads/${branch}`, git('rev-parse', 'HEAD').trim()]);
  } finally {
    spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
  refreshGit(sandbox);
}

void [cpSync, readdirSync, renameSync, fail, everyCommitGreen, workerSessionFile, rewriteSession];

export const forensicsFamilies: Family[] = [runtimeForensicsFamily, traceForensicsFamily, visualParityFamily];

export type { RunView };
