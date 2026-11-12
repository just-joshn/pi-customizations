// The shared checks accept what the skills and the tool descriptions allow, and still fail what they forbid.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { evaluate } from './lib/check.ts';
import { carries, commitsNotFromWorkers, fileReferencesResolve, finalReply, noToolErrors, openedAt, parentProductionWrites, settledAndCollected, withoutOwnIdentity, writableWorkerRecords } from './lib/checks.ts';
import type { RunView, Session, WorkerView } from './lib/view.ts';

const call = (order: number, args: Record<string, unknown>, resultText: string) => ({ order, name: 'pstack_worker', args, resultText, isError: false });
const wake = (order: number) => ({ order, role: 'custom', text: 'woken', customType: 'pstack-worker', details: { workerId: 'w' } });

function view(toolCalls: ReturnType<typeof call>[], messages: ReturnType<typeof wake>[]): RunView {
  const worker = { id: 'w', assignment: { kind: 'pi', role: 'general' }, state: { settles: [{ phase: 'idle' }] } };
  return { runs: [{ workers: [worker] }], parent: { messages, toolCalls } } as unknown as RunView;
}

const verdict = (run: RunView) => evaluate([settledAndCollected('t.collected', { file: 'how/SKILL.md', anchor: '## 4. Present' })], run)[0];
const collect = (order: number) => call(order, { action: 'collect', workerId: 'w' }, 'Worker w settled (idle).');
const inspect = (order: number, phase: string) => call(order, { action: 'inspect', workerId: 'w' }, `Worker w: ${phase}`);

describe('collect needs a wake or an inspect that shows the worker settled', () => {
  test('a collect after the wake is allowed', () => {
    expect(verdict(view([collect(5)], [wake(4)]))?.verdict).toBe('PASS');
  });
  test('a collect after an inspect showed the worker idle is allowed even though the wake arrives later', () => {
    expect(verdict(view([inspect(3, 'idle'), collect(4)], [wake(6)]))?.verdict).toBe('PASS');
  });
  test('a collect while the last inspect said running is refused', () => {
    expect(verdict(view([inspect(3, 'running'), collect(4)], [wake(6)]))?.verdict).toBe('FAIL');
  });
  test('a collect with no inspect and no wake yet is refused', () => {
    expect(verdict(view([collect(4)], [wake(6)]))?.verdict).toBe('FAIL');
  });
  test('a worker the parent inspected as idle and collected needs no wake: a collected settle is sent none', () => {
    expect(verdict(view([inspect(3, 'idle'), collect(4)], []))?.verdict).toBe('PASS');
  });
  test('a worker that never woke the parent and was collected with no inspect that showed it settled is refused', () => {
    expect(verdict(view([collect(4)], []))?.verdict).toBe('FAIL');
  });
  test('a worker that never woke the parent and was inspected only while running is refused', () => {
    expect(verdict(view([inspect(3, 'running'), collect(4)], []))?.verdict).toBe('FAIL');
  });
  test('a worker the parent never collected is refused, woken or not', () => {
    expect(verdict(view([inspect(3, 'idle')], [wake(4)]))?.verdict).toBe('FAIL');
  });
});

describe('file references', () => {
  const repo = mkdtempSync(join(tmpdir(), 'wf-refs-'));
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'cart.js'), 'a\nb\nc\n');
  writeFileSync(join(repo, 'src', 'money.js'), 'a\n');
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  const check = (text: string, min = 2) => evaluate([fileReferencesResolve('t.refs', { file: 'how/references/explainer-prompt.md', anchor: 'Reference specific files and functions' }, { min, from: () => text })], { repo } as unknown as RunView)[0]?.verdict;

  test('files named by path or bare name count, with or without a line', () => {
    expect(check('See `src/cart.js` and money.js:1, built on Node.js.')).toBe('PASS');
  });
  test('a path that is not in the repository fails', () => {
    expect(check('See src/cart.js and src/nope.js.')).toBe('FAIL');
  });
  test('a line past the end of the file fails', () => {
    expect(check('See src/cart.js:2 and src/money.js:9.')).toBe('FAIL');
  });
  test('too few files fails', () => {
    expect(check('Only src/cart.js here.')).toBe('FAIL');
  });
});

describe('tool errors', () => {
  const run = (name: string, resultText: string) => evaluate([noToolErrors('t.errors', { file: 'how/SKILL.md', anchor: '## 4. Present' })], { parent: { toolCalls: [{ order: 1, name, args: {}, resultText, isError: true }] } } as unknown as RunView)[0]?.verdict;

  test('a bash probe that exited non-zero is not a failed tool', () => {
    expect(run('bash', '.\n..\n.git\n\n\nCommand exited with code 1')).toBe('PASS');
  });
  test('a bash command that timed out is a failed tool', () => {
    expect(run('bash', 'partial\n\nCommand timed out after 30 seconds')).toBe('FAIL');
  });
  test('a refused pstack_worker call is a failed tool even when its text mentions an exit code', () => {
    expect(run('pstack_worker', 'Run x has no run.json\n\nCommand exited with code 1')).toBe('FAIL');
  });
});

describe('the reply the user reads', () => {
  const message = (order: number, role: string, text: string, extra: Record<string, unknown> = {}) => ({ order, role, text, ...extra });
  const woken = (order: number, workerId: string) => message(order, 'custom', 'woken', { customType: 'pstack-worker', details: { workerId } });
  const collectOf = (order: number, workerId: string) => ({ order, name: 'pstack_worker', args: { action: 'collect', workerId }, resultText: `Worker ${workerId} settled (idle).`, isError: false });
  const run = (messages: unknown[], toolCalls: unknown[]) => ({ parent: { messages, toolCalls } }) as unknown as RunView;

  test('a turn a wake opens for a worker the parent already collected is an acknowledgement, not the answer', () => {
    const view = run([message(1, 'user', '/why'), message(5, 'assistant', 'The answer, with its eight sections.'), woken(6, 'w'), message(8, 'assistant', 'Collected. Same report, so the answer stands.')], [collectOf(4, 'w')]);
    expect(finalReply(view)).toBe('The answer, with its eight sections.');
  });
  test('a turn a wake opens for a worker not yet collected is where the answer can come, so it counts', () => {
    const view = run([message(1, 'user', '/why'), woken(6, 'w'), message(8, 'assistant', 'The answer, with its eight sections.')], [collectOf(7, 'w')]);
    expect(finalReply(view)).toBe('The answer, with its eight sections.');
  });
  test('a wake turn whose reply is shorter than a reply the parent already gave is an acknowledgement even for a worker not yet collected', () => {
    const view = run([message(1, 'user', '/teach'), message(5, 'assistant', 'The whole explanation, in several sentences that cover the cart, the coupon, and the rounding.'), woken(6, 'w'), message(8, 'assistant', 'Collected. Same.')], [collectOf(7, 'w')]);
    expect(finalReply(view)).toBe('The whole explanation, in several sentences that cover the cart, the coupon, and the rounding.');
  });
  test('an interim status before the wake does not hide the longer answer after it', () => {
    const view = run([message(1, 'user', '/why'), message(3, 'assistant', 'Spawned two workers.'), woken(6, 'w'), message(8, 'assistant', 'The answer, with its eight sections, now that the workers are in.')], [collectOf(7, 'w')]);
    expect(finalReply(view)).toBe('The answer, with its eight sections, now that the workers are in.');
  });
  test('a user turn after the answer is the last reply even when it is short', () => {
    const view = run([message(1, 'user', '/why'), message(5, 'assistant', 'The answer.'), message(6, 'user', 'thanks'), message(8, 'assistant', 'Welcome.')], [collectOf(4, 'w')]);
    expect(finalReply(view)).toBe('Welcome.');
  });
  test('with only acknowledgements to choose from, the last one is the reply', () => {
    const view = run([woken(6, 'w'), message(8, 'assistant', 'Collected.')], [collectOf(4, 'w')]);
    expect(finalReply(view)).toBe('Collected.');
  });
});

describe('a brief that carries a worker\'s findings', () => {
  const findings = ['### Source', '', 'Git history of the repository shows four commits on a single branch named main.', 'Every pull request body is unreachable because gh is not authenticated here.', 'The percent shape arrived in the first commit and was never revisited by anyone.', 'No issue tracker, chat, or document store was available to search at all.'].join('\n');
  const probe = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 80);

  test('the opening verbatim is enough', () => {
    expect(carries(`Findings:\n${findings}\nQuestion: why?`, findings, probe)).toBe(true);
  });
  test('a retitled heading, so the opening is not verbatim, still carries the lines', () => {
    expect(carries(findings.replace('### Source', '#### Source control'), findings, probe)).toBe(true);
  });
  test('one line of four is not most of them', () => {
    expect(carries(`#### Source control\n${findings.split('\n')[2]}\nSynthesize.`, findings, probe)).toBe(false);
  });
  test('a one-line mention carries none of it', () => {
    expect(carries('The archaeologist found four commits and no pull requests. Synthesize.', findings, probe)).toBe(false);
  });
});

describe('opening a file through a worktree directory', () => {
  const bash = (command: string): Session => ({ file: '', cwd: null, messages: [], models: [], toolCalls: [{ order: 3, name: 'bash', args: { command }, resultText: '', isError: false }] });
  const suffix = 'candidate-1/worktree/src/coupon.js';

  test('cd into the worktree and cat the file opens it', () => {
    expect(openedAt(bash('cd /r/workers/candidate-1/worktree && cat src/coupon.js'), suffix)).toBe(3);
  });
  test('a variable holding the worktree and cat of a path under it opens it', () => {
    expect(openedAt(bash('B=/r/workers/candidate-1/worktree; cat $B/src/coupon.js'), suffix)).toBe(3);
  });
  test('cd into the worktree and git status does not', () => {
    expect(openedAt(bash('cd /r/workers/candidate-1/worktree && git status && cat src/other.js'), suffix)).toBe(-1);
  });
  test('cat of the file in another candidate\'s worktree does not', () => {
    expect(openedAt(bash('cd /r/workers/candidate-2/worktree && cat src/coupon.js'), suffix)).toBe(-1);
  });
  test('cat of the file with no worktree named does not', () => {
    expect(openedAt(bash('cat src/coupon.js'), suffix)).toBe(-1);
  });
});

describe('the same prompt, whoever the candidate is', () => {
  const worker = (id: string) => ({ id, dir: `/r/workers/${id}` }) as unknown as WorkerView;
  const brief = (label: string, id: string, task: string) => `# ${label}\n\nYou are ${label.toLowerCase()}. Write to /r/workers/${id}/report.md and work in /r/workers/${id}/worktree. ${task}`;
  test('briefs that differ only in the candidate\'s id, label, and path are one prompt', () => {
    expect(withoutOwnIdentity(brief('Candidate 1', 'candidate-1', 'Clamp.'), worker('candidate-1'))).toBe(withoutOwnIdentity(brief('Candidate 2', 'candidate-2', 'Clamp.'), worker('candidate-2')));
  });
  test('briefs that differ in the task are not', () => {
    expect(withoutOwnIdentity(brief('Candidate 1', 'candidate-1', 'Clamp.'), worker('candidate-1'))).not.toBe(withoutOwnIdentity(brief('Candidate 2', 'candidate-2', 'Throw instead.'), worker('candidate-2')));
  });
});

describe('what the parent wrote and committed itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-parent-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.js'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  const writeCall = (path: string) => ({ order: 1, name: 'write', args: { path }, resultText: '', isError: false });
  const view = (writes: string[], extra: Record<string, unknown> = {}) => ({ repo: dir, base, parent: { toolCalls: writes.map(writeCall) }, git: { dirty: [], commitsSinceBase: [], branchCommits: {}, head: base, ...extra } }) as unknown as RunView;

  test('a hidden scratch file that is in no commit and not in the tree is not production source', () => {
    expect(parentProductionWrites(view([`${dir}/.pi-setup-workers.mjs`]))).toEqual([]);
  });
  test('a hidden file that stays dirty in the tree is production source', () => {
    expect(parentProductionWrites(view([`${dir}/.env`], { dirty: ['.env'] }))).toEqual([`${dir}/.env`]);
  });
  test('a hidden file that is tracked is production source', () => {
    writeFileSync(join(dir, '.tracked'), 'x\n');
    git('add', '.tracked');
    git('commit', '-q', '-m', 'tracked');
    expect(parentProductionWrites(view([`${dir}/.tracked`]))).toEqual([`${dir}/.tracked`]);
    git('reset', '-q', '--hard', base);
  });
  test('a visible file in the repository is production source, and anything under .pi/ is not', () => {
    expect(parentProductionWrites(view([`${dir}/src/cart.js`, `${dir}/.pi/pstack/runs/r/TODO.md`]))).toEqual([`${dir}/src/cart.js`]);
  });
  test('a worker commit the parent cherry-picked or fast-forwarded is the worker\'s; the parent\'s own commit, an empty one included, is not', () => {
    git('checkout', '-q', '-b', 'pstack-run/r/impl');
    writeFileSync(join(dir, 'x.js'), 'x\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'worker change');
    const worker = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    git('cherry-pick', worker);
    const picked = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'y.js'), 'y\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'parent change');
    const own = git('rev-parse', 'HEAD');
    git('commit', '-q', '--allow-empty', '-m', 'empty');
    const empty = git('rev-parse', 'HEAD');
    const branchCommits = { 'pstack-run/r/impl': [worker], main: [empty, own, picked] };
    expect(commitsNotFromWorkers(view([], { commitsSinceBase: [empty, own, picked], branchCommits }))).toEqual([empty, own]);
    expect(commitsNotFromWorkers(view([], { commitsSinceBase: [worker], branchCommits }))).toEqual([]);
  });
});

describe('a writable worker\'s recorded receipts', () => {
  const receipt = (id: string, target: string, artifactPath = 'x/y.log') => ({ id, target, artifacts: [{ path: artifactPath, sha256: '0' }] });
  const verdictFor = (receipts: ReturnType<typeof receipt>[], evidenceFiles: string[]) => {
    const worker = { id: 'candidate-1', assignment: { kind: 'pi', role: 'candidate', workspace: { mode: 'worktree' } }, report: 'done', evidenceFiles };
    const run = { workers: [worker], receipts };
    return evaluate([writableWorkerRecords('t.records', { file: 'arena/SKILL.md', anchor: 'instructions to produce the artifact and a short rationale' })], { runs: [run] } as unknown as RunView)[0]?.verdict;
  };

  test('a receipt whose id is the name of a file in the worker\'s evidence is its own', () => {
    expect(verdictFor([receipt('node-test', 'step-4')], ['node-test.receipt.json'])).toBe('PASS');
  });
  test('a receipt the parent recorded under a run-unique id, over the worker\'s evidence artifact, is its own', () => {
    expect(verdictFor([receipt('candidate-1-node-test', 'candidate-1', 'workers/candidate-1/evidence/node-test.log')], ['node-test.receipt.json'])).toBe('PASS');
  });
  test('a receipt that only targets the worker, over artifacts elsewhere, is not', () => {
    expect(verdictFor([receipt('candidate-1-node-test', 'candidate-1')], ['node-test.receipt.json'])).toBe('FAIL');
  });
  test('a receipt naming an artifact in the worker\'s evidence is its own', () => {
    expect(verdictFor([receipt('a1', 'step-4', 'workers/candidate-1/evidence/node-test.log')], ['node-test.log'])).toBe('PASS');
  });
  test('a receipt for another worker is not', () => {
    expect(verdictFor([receipt('candidate-2-node-test', 'candidate-2', 'workers/candidate-2/evidence/node-test.log')], ['node-test.log'])).toBe('FAIL');
  });
});
