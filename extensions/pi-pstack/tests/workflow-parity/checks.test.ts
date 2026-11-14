// The shared checks accept what the skills and the tool descriptions allow, and still fail what they forbid.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { evaluate } from './lib/check.ts';
import { todoChecks, carries, commitsNotFromWorkers, delegateCommits, everyCommitGreen, parentSpawnCommits, ranBefore, redFirst, workflowCommits, shellCommands, fileReferencesResolve, finalReply, noToolErrors, openedAt, parentProductionWrites, settledAndCollected, withoutOwnIdentity, writableWorkerRecords } from './lib/checks.ts';
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
  test('a not-settled collect is not a collected result even after a wake', () => {
    expect(verdict(view([call(5, { action: 'collect', workerId: 'w' }, 'Worker w has not settled (running).')], [wake(4)]))?.verdict).toBe('FAIL');
    expect(verdict(view([call(5, { action: 'collect', workerId: 'w' }, '{"settled":false}')], [wake(4)]))?.verdict).toBe('FAIL');
  });
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

test('receipt adaptation is inconclusive when no playbook step was marked done', () => {
  const checks = todoChecks({ playbook: 'feature' });
  const run = { id: 'r', steps: [{ n: 1, state: 'open', evidence: [] }], receipts: [] };
  const results = evaluate(checks.filter((entry) => /every-step-resolved|done-steps-proven/.test(entry.id)), { runs: [run] } as unknown as RunView);
  expect(results.map((entry) => entry.verdict)).toEqual(['FAIL', 'INCONCLUSIVE']);
  run.steps[0]!.state = 'done';
  expect(evaluate(checks.filter((entry) => entry.id.endsWith('done-steps-proven')), { runs: [run] } as unknown as RunView)[0]?.verdict).toBe('FAIL');
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
  test('no presented text leaves reference resolution inconclusive', () => {
    expect(check('')).toBe('INCONCLUSIVE');
  });
  test('too few files fails', () => {
    expect(check('Only src/cart.js here.')).toBe('FAIL');
  });
});

describe('tool errors', () => {
  const run = (name: string, resultText: string) => evaluate([noToolErrors('t.errors', { file: 'how/SKILL.md', anchor: '## 4. Present' })], { parent: { errors: [], toolCalls: [{ order: 1, name, args: {}, resultText, isError: true }] } } as unknown as RunView)[0]?.verdict;

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
  test('a shorter closing report after a new owner turn is not an old wake acknowledgement', () => {
    const view = run([message(1, 'user', '/poteto-mode'), message(3, 'assistant', 'The initial queue plan is much longer than the eventual closing report.'), woken(6, 'w'), message(10, 'assistant', 'Both PRs merged.')], [collectOf(2, 'w'), { order: 4, name: 'pstack_worker', args: { action: 'steer', workerId: 'w' } }, collectOf(7, 'w'), { order: 8, name: 'bash', args: { command: 'gh pr view 1' } }]);
    expect(finalReply(view)).toBe('Both PRs merged.');
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
  const bash = (command: string): Session => ({ file: '', cwd: null, messages: [], models: [], errors: [], errorTimes: [], toolCalls: [{ order: 3, name: 'bash', args: { command }, resultText: '', isError: false }] });
  const suffix = 'candidate-1/worktree/src/coupon.js';

  test('cd into the skill and cat its relative playbook opens it', () => {
    const suffix = 'generated/skills/poteto-mode/playbooks/babysit.md';
    expect(openedAt(bash('cd /p/generated/skills/poteto-mode && ls -R && cat playbooks/babysit.md'), suffix)).toBe(3);
    expect(openedAt(bash('cd /p/generated/skills/poteto-mode && cat playbooks/shipping.md'), suffix)).toBe(-1);
    expect(openedAt(bash('cd /p/generated/skills/other && cat playbooks/babysit.md'), suffix)).toBe(-1);
  });
  test('a playbook path under an assigned shell variable opens that playbook', () => {
    const suffix = 'generated/skills/poteto-mode/playbooks/orchestrate.md';
    expect(openedAt(bash('P=/p/generated/skills/poteto-mode; cat $P/playbooks/orchestrate.md'), suffix)).toBe(3);
    expect(openedAt(bash(`P=/p/generated/skills/other; cat \${P}/playbooks/orchestrate.md`), suffix)).toBe(-1);
    expect(openedAt(bash('P=/p/generated/skills/poteto-mode; echo $P/playbooks/orchestrate.md'), suffix)).toBe(-1);
  });
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

describe('a shell loop that opens skill files', () => {
  const session = (command: string) => ({ messages: [], toolCalls: [{ order: 3, name: 'bash', args: { command }, resultText: '', isError: false }] }) as unknown as Session;
  const loop = 'for s in how why tdd; do cat "generated/skills/$s/SKILL.md"; done';
  test.for(['how', 'why', 'tdd'])('opens %s', (name) => {
    expect(openedAt(session(loop), `generated/skills/${name}/SKILL.md`)).toBe(3);
  });
  test('braced variables and a trailing done on its own line expand too', () => {
    expect(openedAt(session('for s in how why\ndo head -50 generated/skills/${s}/SKILL.md\ndone'), 'generated/skills/why/SKILL.md')).toBe(3);
    expect(openedAt(session('for s in how why; do head -50 generated/skills/${s}/SKILL.md; done'), 'generated/skills/why/SKILL.md')).toBe(3);
  });
  test('a skill the loop does not list is not opened, and a loop that never reads opens nothing', () => {
    expect(openedAt(session(loop), 'generated/skills/arena/SKILL.md')).toBe(-1);
    expect(openedAt(session('for s in how why; do echo generated/skills/$s/SKILL.md; done'), 'generated/skills/how/SKILL.md')).toBe(-1);
  });
  test('the expansion keeps the command itself', () => {
    expect(shellCommands('cat a.md')).toEqual(['cat a.md']);
  });
});

describe('what the playbook has the parent write itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-allow-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const writeCall = (path: string) => ({ order: 1, name: 'write', args: { path }, resultText: '', isError: false });
  const view = (writes: string[]) => ({ repo: dir, parent: { toolCalls: writes.map(writeCall) }, git: { dirty: [], commitsSinceBase: [], branchCommits: {} } }) as unknown as RunView;
  test('the failing repro under test/ is allowed when the playbook says so, and production source still is not', () => {
    expect(parentProductionWrites(view([`${dir}/test/cart.test.js`]), /^test\//)).toEqual([]);
    expect(parentProductionWrites(view([`${dir}/test/cart.test.js`, `${dir}/src/cart.js`]), /^test\//)).toEqual([`${dir}/src/cart.js`]);
    expect(parentProductionWrites(view([`${dir}/test/cart.test.js`]))).toEqual([`${dir}/test/cart.test.js`]);
  });
});

describe('a writable worker owes only the records its brief asks for', () => {
  const run = (worker: Record<string, unknown>) => ({ runs: [{ workers: [{ id: 'w1', assignment: { kind: 'pi', role: 'poteto', workspace: { mode: 'worktree' } }, report: null, evidenceFiles: [], finalText: 'Done: the change is committed.', ...worker }], receipts: [] }] }) as unknown as RunView;
  const verdictOf = (worker: Record<string, unknown>) => evaluate([writableWorkerRecords('t.records', { file: 'poteto-mode/playbooks/feature.md', anchor: 'Delegate code-writing' }, ['poteto'])], run(worker))[0];
  test('a brief that names no report, worker directory, or receipt leaves the final reply as the report', () => {
    expect(verdictOf({ brief: 'Add the export. Commit when green.' })?.verdict).toBe('PASS');
  });
  test('a brief that asks for report.md fails the worker that wrote none', () => {
    expect(verdictOf({ brief: 'Add the export. Write report.md in your worker directory.' })?.verdict).toBe('FAIL');
  });
  test('a brief that asks for a receipt fails the worker that recorded none', () => {
    expect(verdictOf({ brief: 'Add the export. Record a receipt.', report: 'done' })?.verdict).toBe('FAIL');
  });
  test('a worker with no report and no final reply fails whatever the brief says', () => {
    expect(verdictOf({ brief: 'Add the export.', finalText: '' })?.verdict).toBe('FAIL');
  });
});

describe('every commit of a worker branch passes, except a failing test that comes first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-green-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { encoding: 'utf8' }).trim();
  const commit = (files: Record<string, string>, message: string) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  const base = commit({ 'package.json': '{"scripts":{"test":"node --test"}}' }, 'base');
  const TEST = "const test = require('node:test'); const assert = require('node:assert'); test('adds', () => assert.equal(require('../src/add.js').add(1, 2), 3));";
  const red = commit({ 'test/add.test.js': TEST }, 'test: add');
  const green = commit({ 'src/add.js': 'exports.add = (a, b) => a + b;' }, 'feat: add');
  const broken = commit({ 'src/add.js': 'exports.add = (a, b) => a - b;' }, 'refactor: break add');
  const verdictOf = (commits: string[]) => {
    const view = { repo: dir, base, git: { branchCommits: { 'pstack-run/r/w': [...commits].reverse() } }, runs: [{ id: 'r' }] } as unknown as RunView;
    return evaluate([everyCommitGreen('t.green', { file: 'poteto-mode/playbooks/feature.md', anchor: 'building, verifying, and committing' }, () => 'r', 'w', { min: 2 })], view)[0]?.verdict;
  };
  test('a test-only commit that fails, followed by a commit that passes, is the failing test first', () => {
    expect(verdictOf([red, green])).toBe('PASS');
  });
  test('a test-only red commit that no later commit turns green is still red', () => {
    expect(verdictOf([red, green, broken])).toBe('FAIL');
  });
  test('a red commit that changes production source is red even before a green one', () => {
    git('checkout', '-q', '-b', 'other', base);
    const redProd = commit({ 'src/add.js': 'exports.add = () => 0;', 'test/add.test.js': TEST }, 'feat: wrong');
    git('checkout', '-q', 'main');
    expect(verdictOf([redProd, green])).toBe('FAIL');
  });
});

describe('a failing test the parent commits before it spawns the delegate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-redfirst-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { encoding: 'utf8' }).trim();
  const commit = (files: Record<string, string>, message: string) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  const base = commit({ 'package.json': '{}', 'src/add.js': 'exports.add = (a, b) => a - b;' }, 'base');
  const TEST = "const test = require('node:test'); const assert = require('node:assert'); test('adds', () => assert.equal(require('../src/add.js').add(1, 2), 3));";
  const parentRed = commit({ 'test/add.test.js': TEST }, 'test: add');
  const fix = commit({ 'src/add.js': 'exports.add = (a, b) => a + b;' }, 'fix: add');
  git('branch', 'pstack-run/r/w', fix);
  const view = (input: string, commits: string[]) => {
    const delegate = { id: 'w', assignment: { kind: 'pi', role: 'poteto', workspace: { mode: 'worktree', inputCommit: input } } };
    return { repo: dir, base, git: { branchCommits: { 'pstack-run/r/w': [...commits].reverse() } }, runs: [{ id: 'r', workers: [delegate] }], parent: { toolCalls: [] } } as unknown as RunView;
  };

  test('is the workflow\'s red test, and is not credited to the delegate', () => {
    const run = view(parentRed, [parentRed, fix]);
    expect(parentSpawnCommits(run)).toEqual([parentRed]);
    expect(delegateCommits(run)).toEqual([fix]);
    expect(workflowCommits(run)).toEqual([parentRed, fix]);
    expect(redFirst(run).ok).toBe(true);
  });
  test('a delegate history check that wants two delegate commits fails: the parent\'s test is not one of them', () => {
    const verdict = evaluate([everyCommitGreen('t.green', { file: 'poteto-mode/playbooks/feature.md', anchor: 'building, verifying, and committing' }, () => 'r', 'w', { min: 2, commits: delegateCommits })], view(parentRed, [parentRed, fix]))[0]?.verdict;
    expect(verdict).toBe('FAIL');
  });
  test('the workflow check still fails when the parent\'s first commit already changes source, or the test never turns green', () => {
    const touchesSource = commit({ 'src/other.js': 'x', 'test/b.test.js': 'y' }, 'test: with source');
    expect(redFirst(view(touchesSource, [touchesSource, fix]), [touchesSource, fix]).ok).toBe(false);
    expect(redFirst(view(parentRed, [parentRed]), [parentRed]).ok).toBe(false);
    git('checkout', '-q', '-b', 'still-red', parentRed);
    const stillRed = commit({ 'src/add.js': 'exports.add = () => 0;' }, 'feat: wrong');
    expect(redFirst(view(parentRed, [parentRed, stillRed]), [parentRed, stillRed]).ok).toBe(false);
    git('checkout', '-q', 'main');
  });
});

describe('"ran before the spawn" rests on the parent session\'s tool-call order, never on file times', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-ran-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const artifact = join(dir, 'repro-before.txt');
  writeFileSync(artifact, 'total=-5\n');
  utimesSync(artifact, new Date('2000-01-01'), new Date('2000-01-01'));
  const receipt = { id: 'repro-before', runId: 'r', target: '1', kind: 'command', verdict: 'pass', commit: null, artifacts: [{ path: artifact, sha256: '0' }], command: ['node', 'repro.js'] };
  const delegate = { id: 'fix', assignment: { kind: 'pi', role: 'poteto', workspace: { mode: 'worktree' } } };
  const spawn = (order: number) => ({ order, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: `/runs/r/workers/fix/assignment.json` }, resultText: '', isError: false });
  const bash = (order: number, command: string) => ({ order, name: 'bash', args: { command }, resultText: '', isError: false });
  const record = (order: number, path: string) => ({ order, name: 'pstack_evidence', args: { action: 'record', receiptPath: path }, resultText: '', isError: false });
  const verdict = (toolCalls: unknown[]) => ranBefore({ repo: dir, runs: [{ dir, id: 'r', workers: [delegate] }], parent: { toolCalls } } as unknown as RunView, receipt as never, delegate as never);

  test('a receipt recorded before the spawn ran before it', () => {
    expect(verdict([record(1, '/runs/r/repro-before.receipt.json'), spawn(2)])).toBe(true);
  });
  test('a command that wrote the artifact before the spawn, recorded in a batch after it, ran before it', () => {
    expect(verdict([bash(1, `node repro.js > ${artifact}`), spawn(2), record(3, '/runs/r/repro-before.receipt.json')])).toBe(true);
    expect(verdict([bash(1, 'node repro.js'), spawn(2)])).toBe(true);
  });
  test('an old artifact file time proves nothing: with no earlier call and the receipt recorded after the spawn, it did not run before', () => {
    expect(verdict([spawn(1), record(2, '/runs/r/repro-before.receipt.json')])).toBe(false);
    expect(verdict([bash(1, 'ls'), spawn(2), bash(3, `node repro.js > ${artifact}`)])).toBe(false);
  });
});
