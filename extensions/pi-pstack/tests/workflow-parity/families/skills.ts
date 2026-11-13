// automate-me (spec 12.5) and in-your-own-words: skills that work from history and from the user's own words.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, shQuote, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, finalReply, openedAt, promptRoutes, repoUntouched, settledAndCollected, skillFile } from '../lib/checks.ts';
import { SCRIPTED_ROLES } from '../lib/driver.ts';
import { appendToolCall, dirtyRepo, parentSession, patchAssignment, rewriteFinalReply, rewriteSession, workerSessionFile } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import type { Family } from './types.ts';

const model = (line: string) => String(SCRIPTED_ROLES[line]);

// ---- in-your-own-words

const IYOW_REQUEST = 'the coupon percent can go over 100 and customers get paid to shop, fix it before the sale on friday';

export const inYourOwnWordsFamily: Family = {
  id: 'in-your-own-words',
  title: 'in-your-own-words: the goal and the problem restated, nothing started (spec 12.5)',
  spec: {
    family: 'in-your-own-words',
    runId: 'in-your-own-words',
    history: cartHistory,
    prompt: () => `/in-your-own-words ${IYOW_REQUEST}`,
    scenario: (ctx) => scenario(new Parent(ctx).readSkill('in-your-own-words').text('Your goal is to stop a coupon from ever paying a customer, before the sale on Friday. The problem is that a coupon percent above 100 makes the total negative, so the shop pays the customer to shop. I have not changed anything.')),
  },
  checks: [
    check('slash.in-your-own-words', '/in-your-own-words reaches Pi as the pstack skill prompt with the request', src('in-your-own-words/SKILL.md', 'Restate in your own words'), (view) => when(view.prompt.includes('Use the pstack `in-your-own-words` skill for this request.') && view.prompt.includes(skillFile('in-your-own-words')) && view.prompt.includes(IYOW_REQUEST), 'first user message routes to the skill with the request', `first user message was: ${view.prompt.slice(0, 160)}`)),
    check('in-your-own-words.states-goal-and-problem', 'the reply restates the user\'s goal and the problem they are solving, in its own words, using the request\'s own facts', src('in-your-own-words/SKILL.md', "Restate in your own words what you think the user's goals are"), (view) => {
      const reply = finalReply(view);
      const facts = [/coupon/i, /100/, /negative|pays?|paid/i, /friday/i].filter((pattern) => !pattern.test(reply));
      const verbatim = reply.includes(IYOW_REQUEST);
      return when(/goal/i.test(reply) && /problem/i.test(reply) && facts.length === 0 && !verbatim, 'goal and problem named, the facts kept, not a copy of the request', `missing facts ${facts.map(String).join(', ')}; goal ${/goal/i.test(reply)}; problem ${/problem/i.test(reply)}; verbatim copy ${verbatim}`);
    }),
    check('in-your-own-words.starts-no-work', 'it only restates: no worker, no run directory, no write, no command beyond reading the skill', src('in-your-own-words/SKILL.md', "Restate in your own words what you think the user's goals are"), (view) => {
      const other = view.parent.toolCalls.filter((call) => call.name !== 'read');
      return when(other.length === 0 && allWorkers(view).length === 0 && view.runs.length === 0, 'only read calls, no workers, no run', `non-read calls: ${other.map((call) => call.name).join(', ')}; runs ${view.runs.length}`);
    }),
    repoUntouched('in-your-own-words.no-writes', 'the repository is untouched', src('in-your-own-words/SKILL.md', "Restate in your own words")),
  ],
  negatives: [
    { name: 'the reply parroted the request', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Your goal is', `${IYOW_REQUEST}. Your goal is`), fails: ['in-your-own-words.states-goal-and-problem'] },
    { name: 'it started editing', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['in-your-own-words.no-writes'] },
    { name: 'it ran a command', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'npm test' }), fails: ['in-your-own-words.starts-no-work'] },
  ],
};

// ---- automate-me

const RUN = 'automate-me';
const HANDLE = 'jay';
const SLICES = [
  ['slice-1', ['use pnpm not npm for installs', 'keep answers short, two sentences', 'call me Captain in replies']],
  ['slice-2', ['keep answers short, two sentences', 'run the tests before you say done']],
  ['slice-3', ['run the tests before you say done', 'use pnpm not npm for installs']],
] as const;
const DECOY_MARK = 'OTHER-WORKSPACE-PRIVATE-7721';
const QUESTION = 'Which areas matter most?\n1. Response style\n2. Autonomy\n3. Verification\n4. Process\n5. Skills';

const SKILL_BODY = `---
name: ${HANDLE}-mode
description: "Use for ${HANDLE}, /${HANDLE}-mode, or requests to work in ${HANDLE}'s style."
disable-model-invocation: true
---

# ${HANDLE} mode

## Response style

Short answers. Two sentences unless the user asks for more.

## Process

Install with pnpm, never npm.

## Review and verify

Run the tests before saying done. The **poteto-mode** skill (\`../poteto-mode/SKILL.md\`) shows the shape.
`;

const sessionFile = (messages: readonly string[]): string => `${[{ type: 'session', version: 3, id: 'seed', timestamp: '2026-10-01T00:00:00.000Z', cwd: '/work' }, ...messages.map((text, index) => ({ type: 'message', id: `m${index}`, parentId: null, timestamp: '2026-10-01T00:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text }] } }))].map((line) => JSON.stringify(line)).join('\n')}\n`;

const authors = (view: RunView) => allWorkers(view).filter((worker) => assignmentOf(worker).role === 'poteto' && /jay-mode\/SKILL\.md/.test(worker.brief ?? ''));
const authorOf = (view: RunView) => authors(view).length === 1 ? authors(view)[0] : undefined;
const authorSpawn = (view: RunView) => {
  const author = authorOf(view);
  return author === undefined ? -1 : view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/workers/${author.id}/`))?.order ?? -1;
};

const toolText = (view: RunView, worker: string) => JSON.stringify(allWorkers(view).find((entry) => entry.id === worker)?.session?.toolCalls ?? []);

export const automateMeFamily: Family = {
  id: 'automate-me',
  title: 'automate-me: mine this workspace\'s history in parallel slices, ask a structured question, keep only multi-slice signals, author the mode skill in a worktree (spec 12.5)',
  spec: {
    family: 'automate-me',
    runId: RUN,
    history: cartHistory,
    prompt: () => '/automate-me create my skill, my handle is jay',
    followUps: () => ['1 and 3'],
    prepare: (ctx) => {
      for (const [name, messages] of SLICES) writeFileSync(join(ctx.sessionsDir, `00-${name}.jsonl`), sessionFile(messages));
      const other = join(ctx.agentDir, 'sessions', '--elsewhere--');
      mkdirSync(other, { recursive: true });
      writeFileSync(join(other, 'private.jsonl'), sessionFile([DECOY_MARK]));
    },
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.readSkill('automate-me').bash(`find .pi/skills ${JSON.stringify(join(ctx.agentDir, 'skills'))} -path '*-mode/SKILL.md' 2>/dev/null; true`);
      parent.bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook authoring-a-skill --title "automate-me jay" --run-id ${ctx.runId}`);
      const staged = SLICES.map(([name]) => parent.stage(`miner-${name}`, { role: 'general', model: model('swarm workers'), workspace: parent.readonly() }, `Read only ${join(ctx.sessionsDir, `00-${name}.jsonl`)}, which is this workspace's history. Do not read any other sessions folder. Report the working preferences you see, with the message that shows each.`));
      parent.fire(...staged);
      for (const [name, messages] of SLICES) workers[`miner-${name}`] = new Worker().read(join(ctx.sessionsDir, `00-${name}.jsonl`)).text(`Preferences in ${name}:\n${messages.map((message) => `- ${message}`).join('\n')}`);
      for (const [name] of SLICES) parent.wait(`miner-${name}`);
      parent.collect(...SLICES.map(([name]) => `miner-${name}`));
      parent.text(QUESTION);
      parent.readSkill('unslop').readPlaybook('authoring-a-skill');
      parent.spawn('author', { role: 'poteto', model: model('feature, refactoring'), workspace: parent.worktree(), skills: ['poteto-mode'] }, `Write ${HANDLE}-mode at .pi/skills/${HANDLE}-mode/SKILL.md with exactly this content and commit it:\n\n${SKILL_BODY}`);
      workers['author'] = new Worker().bash(`mkdir -p ${join(parent.workerDir('author'), 'worktree/.pi/skills', `${HANDLE}-mode`)}`).write(join(parent.workerDir('author'), 'worktree/.pi/skills', `${HANDLE}-mode`, 'SKILL.md'), SKILL_BODY).bash(`cd ${join(parent.workerDir('author'), 'worktree')} && git add -A && git -c user.name=w -c user.email=w@example.com commit -q -m "add ${HANDLE}-mode"`).text(`${HANDLE}-mode committed`);
      parent.wait('author').collect('author');
      parent.text(`Drafted ${HANDLE}-mode from preferences seen in two or more slices: short answers, pnpm, tests before done. One call-name preference appeared once, so I left it out. It is committed on a worktree branch, no PR because there is no remote.`);
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('automate-me'),
    check('automate-me.checks-for-an-existing-skill', 'the parent looked for an existing *-mode skill before mining', src('automate-me/SKILL.md', '### 0. Check for an existing skill'), (view) => {
      const find = view.parent.toolCalls.find((call) => call.name === 'bash' && /-mode\/SKILL\.md/.test(String(call.args['command'])));
      const firstSpawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn')?.order ?? Number.POSITIVE_INFINITY;
      return when(find !== undefined && find.order < firstSpawn, `searched at ${find?.order}, first spawn at ${firstSpawn}`, 'no search for an existing mode skill before the first spawn');
    }),
    check('automate-me.parallel-slice-miners', 'three miners, one per slice, readonly, spawned in one message', src('automate-me/SKILL.md', 'Run multiple parallel subagents across slices of history'), (view) => {
      const miners = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'general');
      const slices = miners.map((worker) => SLICES.filter(([name]) => (worker.brief ?? '').includes(`00-${name}.jsonl`)));
      const valid = miners.every((worker) => assignmentOf(worker).workspace?.mode === 'readonly' && assignmentOf(worker).workspace?.path === view.repo);
      return when(miners.length === 3 && valid && slices.every((slice) => slice.length === 1) && new Set(slices.flat().map(([name]) => name)).size === 3, 'three readonly miners assigned distinct history slices', 'expected three readonly root-scoped miners, each assigned one distinct slice');
    }),
    check('automate-me.history-is-workspace-scoped', 'every miner read only its own slice under this workspace\'s session folder; nothing touched another workspace\'s sessions', src('automate-me/SKILL.md', 'Don\'t glob across `~/.pi/agent/sessions/*/`'), (view) => {
      const everything = JSON.stringify([view.parent.toolCalls, ...allWorkers(view).map((worker) => worker.session?.toolCalls ?? [])].flat().map((call) => call.args));
      const miners = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'general');
      const slices = SLICES.map(([name]) => `00-${name}.jsonl`);
      const assigned = miners.map((worker) => slices.filter((slice) => (worker.brief ?? '').includes(slice)));
      const wrong = miners.filter((worker, index) => assigned[index]?.length !== 1 || !(worker.session?.toolCalls ?? []).some((call) => call.name === 'read' && String(call.args['path']).includes(assigned[index]![0]!)));
      if (miners.length !== 3 || new Set(assigned.flat()).size !== 3) return fail('expected three miners assigned distinct history slices');
      return when(!everything.includes('--elsewhere--') && !everything.includes(DECOY_MARK) && !/sessions\/\*/.test(everything) && wrong.length === 0, 'no call names the other workspace folder, a glob across sessions, or its content; each miner read its own slice', `touched elsewhere ${everything.includes('--elsewhere--')}; glob ${/sessions\/\*/.test(everything)}; miners without their slice: ${wrong.map((worker) => worker.id).join(',')}`);
    }),
    check('automate-me.asks-a-structured-question', 'before drafting, the parent ended a turn with one numbered multiple-choice question of 4 to 6 options, and drafted only after the user answered', src('automate-me/SKILL.md', 'Ask structured multiple-choice questions in the conversation, with numbered options'), (view) => {
      const users = view.parent.messages.filter((message) => message.role === 'user' && !/^pstack worker/.test(message.text));
      const question = view.parent.messages.find((message) => message.role === 'assistant' && /Which areas matter most\?/.test(message.text));
      const options = (question?.text.match(/^\d+\. /gm) ?? []).length;
      const answer = users.find((message) => message.text.trim() === '1 and 3');
      const author = authorSpawn(view);
      return when(question !== undefined && options >= 4 && options <= 6 && answer !== undefined && answer.order > question.order && author > answer.order, `question with ${options} options, answered at ${answer?.order}, drafting at ${author}`, `question ${question !== undefined}, options ${options}, answer ${answer?.order}, drafting ${author}`);
    }),
    check('automate-me.keeps-only-multi-slice-signals', 'the skill holds each preference seen in two or more slices and none seen once', src('automate-me/SKILL.md', 'Patterns seen in 2+ slices are high-confidence. Lone signals are weak and usually get dropped.'), (view) => {
      const author = authorOf(view);
      if (author === undefined) return fail('expected one jay-mode author');
      const text = JSON.stringify(author?.session?.toolCalls.find((call) => call.name === 'write')?.args ?? {});
      const kept = [/pnpm/, /Short answers/, /tests before saying done/].filter((pattern) => !pattern.test(text));
      return when(kept.length === 0 && !/Captain/.test(text), 'pnpm, short answers and tests are in; the once-only Captain is out', `missing ${kept.map(String).join(', ')}; lone signal present ${/Captain/.test(text)}`);
    }),
    check('automate-me.skill-shape-and-placement', 'the skill is .pi/skills/jay-mode/SKILL.md with a handle-triggered description and disable-model-invocation true, committed in the author\'s worktree, references not inlined, no long dash', src('automate-me/SKILL.md', 'Frontmatter `disable-model-invocation: true` by default'), (view) => {
      const author = authorOf(view);
      if (author === undefined) return fail('expected one jay-mode author');
      const text = execFileSync('git', ['-C', view.repo, 'show', `pstack-run/${view.runs[0]?.id}/${author.id}:.pi/skills/${HANDLE}-mode/SKILL.md`], { encoding: 'utf8' });
      const problems = [...(/^name: jay-mode$/m.test(text) ? [] : ['name']), ...(/^description: .*\/jay-mode/m.test(text) ? [] : ['description trigger']), ...(/^disable-model-invocation: true$/m.test(text) ? [] : ['disable-model-invocation']), ...(/Non-negotiables|Autopilot-full/.test(text) ? ['inlined poteto-mode content'] : []), ...(/\.\.\/poteto-mode\/SKILL\.md/.test(text) ? [] : ['no path reference']), ...(/[\u2014\u2013]/.test(text) ? ['long dash'] : [])];
      return when(problems.length === 0, 'name, description, disable-model-invocation, a path reference, no inlined content, no long dash', problems.join(', '));
    }),
    check('automate-me.reads-unslop-and-authoring-before-drafting', 'unslop and the authoring playbook were opened before the author was spawned', src('automate-me/SKILL.md', 'Apply the **unslop** skill and the Authoring a skill playbook\'s writing guidance to every line.'), (view) => {
      const author = authorSpawn(view);
      const opened = [openedAt(view.parent, skillFile('unslop')), openedAt(view.parent, 'generated/skills/poteto-mode/playbooks/authoring-a-skill.md')];
      return when(!opened.includes(-1) && opened.every((at) => at < author), `opened at ${opened.join(', ')}, author spawned at ${author}`, `opened at ${opened.join(', ')}; author at ${author}`);
    }),
    check('automate-me.lands-in-a-worktree-not-main', 'the skill lives on a worktree branch; main has no new commit and no change', src('automate-me/SKILL.md', 'Work in a worktree off main. Commit and open a PR. Don\'t push to main directly.'), (view) => when(authorOf(view) !== undefined && (view.git.branchCommits[`pstack-run/${view.runs[0]?.id}/${authorOf(view)?.id}`]?.length ?? 0) === 1 && view.git.commitsSinceBase.length === 0 && view.git.dirty.length === 0, '1 commit on the author branch, main untouched', `author commits ${view.git.branchCommits[`pstack-run/${view.runs[0]?.id}/${authorOf(view)?.id}`]?.length}; main commits ${view.git.commitsSinceBase.length}; dirty ${view.git.dirty.join(',')}`)),
    settledAndCollected('automate-me.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    { name: 'a miner read another workspace\'s history', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'miner-slice-1'), '00-slice-1.jsonl', '--elsewhere--/private.jsonl'), fails: ['automate-me.history-is-workspace-scoped'] },
    { name: 'a lone signal was codified', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'author'), 'Install with pnpm', 'Call the user Captain. Install with pnpm'), fails: ['automate-me.keeps-only-multi-slice-signals'] },
    { name: 'the parent never asked', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'Which areas matter most?', 'Done.'), fails: ['automate-me.asks-a-structured-question'] },
    { name: 'the parent skipped the existing-skill check', mutate: (sandbox) => rewriteSession(parentSession(sandbox), '*-mode/SKILL.md', '*.md'), fails: ['automate-me.checks-for-an-existing-skill'] },
    { name: 'drafting began before unslop was opened', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'generated/skills/unslop/SKILL.md', 'generated/skills/zzz/SKILL.md'), fails: ['automate-me.reads-unslop-and-authoring-before-drafting'] },
    { name: 'a miner was writable', mutate: (sandbox) => patchAssignment(sandbox, RUN, 'miner-slice-2', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: 'abc1234' })), fails: ['automate-me.parallel-slice-miners'] },
  ],
};

void [fail, assignmentOf, shQuote, toolText];
export const skillsFamilies: Family[] = [inYourOwnWordsFamily, automateMeFamily];
