import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const script = join(root, 'skills/poteto-mode/scripts/check-plan.mjs');
const RULE = 'Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.';
const directories: string[] = [];

type Block = { head: string; rest?: string; lines: string[] };
type Parts = {
  h1: string[];
  intro: string[];
  howToRead: string[];
  programH3: string[];
  programBody: string[];
  prs: Block[][];
  close: string[];
  tail: string[][];
};

const box = (text: string) => `- [ ] ${text}`;
const lane = (n: number) => box(`Lane ${n}. Drive the surface. Save \`lane${n}.png\`. Pass when the page renders.`);

function blocks(): Block[] {
  return [
    { head: 'Depends on.', rest: 'none', lines: [] },
    { head: 'Files.', lines: [box('Touch one file.')] },
    { head: 'Build.', lines: [box('Build it.')] },
    { head: 'You see.', lines: [box('Run it and see the change.')] },
    { head: 'Verify, unit.', rest: RULE, lines: [box('Run the unit tests.')] },
    { head: 'Verify, live.', rest: `${RULE} Ten lanes on \`grok-4.7-xhigh-fast\` at the PR head.`, lines: Array.from({ length: 10 }, (_, i) => lane(i + 1)) },
    { head: 'Verify, perf.', rest: RULE, lines: ['Metric.', 'Probe.', 'Baseline.', 'Rule.'].map((name) => box(`${name} Named.`)) },
    { head: 'Review gate.', rest: 'None. PR one is not review-gated.', lines: [] },
    { head: 'Merge.', lines: [box('Merge it.')] },
  ];
}

function defaults(): Parts {
  return {
    h1: ['# Demo plan'],
    intro: ['Changes one thing for one user.'],
    howToRead: ['One box is one unit of work. Every box names the evidence that checks it.', 'Check a box only when its evidence exists, a file or a log line.', 'The program runs `playbooks/autopilot-full.md`.', RULE],
    programH3: ['Arm the program', 'Spawn owners', 'PR mechanics', 'Verdict and merge', 'Boot recipe'],
    programBody: [box('Arm the `/goal` and the 30-minute audit tick.'), box('Read `git show origin/main:path/to/playbook.md` first.'), box('Post a status message only on a tracked change.')],
    prs: [blocks()],
    close: ['## Close the program', '', box('Report the result.')],
    tail: [['## Appendix A. Prototype evidence', '', 'Branch and SHA recorded.']],
  };
}

function render(parts: Parts): string {
  const sections = [
    ...parts.h1,
    '',
    ...parts.intro,
    '',
    '## How to read this',
    '',
    ...parts.howToRead,
    '',
    '## Program checklist',
    '',
    ...parts.programH3.flatMap((name, index) => [`### ${name}`, '', ...(index === 0 ? parts.programBody : [box('Do the step.')]), '']),
    ...parts.prs.flatMap((pr, index) => [`## PR ${index + 1} Demo`, '', ...pr.flatMap((b) => [`**${b.head}**${b.rest ? ` ${b.rest}` : ''}`, ...b.lines, ''])]),
    ...parts.close,
    '',
    ...parts.tail.flatMap((section) => [...section, '']),
  ];
  return sections.join('\n');
}

const block = (parts: Parts, head: string): Block => parts.prs[0]!.find((b) => b.head === head)!;

async function run(text: string) {
  const directory = await mkdtemp(join(tmpdir(), 'check-plan-'));
  directories.push(directory);
  const file = join(directory, 'plan.md');
  await writeFile(file, text);
  const result = spawnSync('node', [script, file], { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout,
    problems: result.stderr
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(`${file}:`, '')),
  };
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

const mutate = (change: (parts: Parts) => void): string => {
  const parts = defaults();
  change(parts);
  return render(parts);
};

describe('check-plan.mjs on a valid plan', () => {
  test('exits 0 with one report line per PR section and a summary', async () => {
    const result = await run(render(defaults()));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('PR 1 Demo  boxes=19  files=1 build=1 you-see=1 verify-unit=1 verify-live=10 verify-perf=4 review-gate=0 merge=1\n1 PR sections, 0 problems\n');
    expect(result.problems).toEqual([]);
  });

  test('reports one line per PR section', async () => {
    const result = await run(mutate((parts) => parts.prs.push(blocks())));
    expect(result.stdout.split('\n').filter((line) => line.includes('boxes='))).toHaveLength(2);
    expect(result.stdout).toContain('2 PR sections, 0 problems');
  });

  test('skips YAML front matter when line 1 is a fence of dashes', async () => {
    const result = await run(`---\ntitle: a — b: c\n---\n${render(defaults())}`);
    expect(result.status).toBe(0);
  });

  test('exits 2 with usage when no plan path is given', () => {
    const result = spawnSync('node', [script], { encoding: 'utf8' });
    expect({ status: result.status, stderr: result.stderr.trim() }).toEqual({ status: 2, stderr: 'Usage: node check-plan.mjs <plan.md>' });
  });
});

const fails: { name: string; change: (parts: Parts) => void; message: string }[] = [
  { name: 'no H1', change: (p) => (p.h1 = []), message: 'no H1 title' },
  { name: 'an intro of ten lines', change: (p) => (p.intro = Array.from({ length: 10 }, (_, i) => `Line ${i}.`)), message: 'intro is 10 lines, under ten required' },
  ...['One box is one unit of work', 'names the evidence', 'Check a box only when its evidence exists', 'playbooks/', RULE].map((marker) => ({
    name: `How to read this missing "${marker.slice(0, 24)}"`,
    change: (p: Parts) => (p.howToRead = p.howToRead.map((line) => line.replace(marker, 'x')).filter((line) => line !== 'x')),
    message: `How to read this lacks "${marker}"`,
  })),
  { name: 'no Close section', change: (p) => (p.close = []), message: 'no "## Close the program" section' },
  { name: 'no PR sections', change: (p) => (p.prs = []), message: 'no PR sections between Program checklist and Close the program' },
  { name: 'a missing Prototype evidence appendix', change: (p) => (p.tail = [['## Appendix B. Risks']]), message: 'no "## Appendix ... Prototype evidence" section' },
  { name: 'a non-appendix H2 after Close', change: (p) => p.tail.push(['## Notes']), message: '"## Notes" after Close the program is not an appendix' },
  { name: 'Program checklist missing /goal', change: (p) => (p.programBody = p.programBody.filter((line) => !line.includes('/goal'))), message: 'Program checklist lacks "/goal"' },
  { name: 'Program checklist missing the origin trunk read', change: (p) => (p.programBody = p.programBody.filter((line) => !line.includes('git show'))), message: 'Program checklist lacks "/git show origin' },
  { name: 'Program checklist missing the 30-minute tick', change: (p) => (p.programBody[0] = box('Arm the `/goal`.')), message: 'Program checklist lacks "/30' },
  { name: 'Program checklist missing the status message', change: (p) => (p.programBody = p.programBody.filter((line) => !line.includes('status message'))), message: 'Program checklist lacks "status message"' },
  { name: 'a Program checklist H3 missing', change: (p) => (p.programH3 = p.programH3.filter((name) => name !== 'PR mechanics')), message: 'Program checklist lacks "### PR mechanics" in order' },
  { name: 'Program checklist H3s out of order', change: (p) => p.programH3.splice(3, 2, p.programH3[4]!, p.programH3[3]!), message: 'Program checklist lacks "### Boot recipe" in order' },
  { name: 'empty Depends on', change: (p) => (block(p, 'Depends on.').rest = undefined), message: 'Depends on names nothing' },
  { name: 'sub-blocks out of order', change: (p) => p.prs[0]!.reverse(), message: 'sub-blocks are [' },
  ...['Files.', 'Build.', 'You see.', 'Verify, unit.', 'Merge.'].map((head) => ({
    name: `${head} without a box`,
    change: (p: Parts) => (block(p, head).lines = []),
    message: `${head} has no box`,
  })),
  ...['Verify, unit.', 'Verify, live.', 'Verify, perf.'].map((head) => ({
    name: `${head} not opening with the rule`,
    change: (p: Parts) => (block(p, head).rest = (block(p, head).rest ?? '').replace(RULE, 'Looks fine.')),
    message: `${head} does not open with the rule`,
  })),
  { name: 'the live block with the model placeholder unfilled', change: (p) => (block(p, 'Verify, live.').rest = `${RULE} Ten lanes on \`<swarm workers model>\` at the PR head.`), message: 'Verify, live lacks "Ten lanes on' },
  { name: 'the live block without the lanes line', change: (p) => (block(p, 'Verify, live.').rest = RULE), message: 'Verify, live lacks "Ten lanes on' },
  { name: 'nine lanes', change: (p) => block(p, 'Verify, live.').lines.pop(), message: 'lanes are [1,2,3,4,5,6,7,8,9], expected 1 to 10' },
  { name: 'a lane without a screenshot', change: (p) => (block(p, 'Verify, live.').lines[2] = box('Lane 3. Drive it. Pass when it renders.')), message: 'lane 3 names no screenshot' },
  { name: 'a lane without a pass predicate', change: (p) => (block(p, 'Verify, live.').lines[3] = box('Lane 4. Drive it. Save `x.png`.')), message: 'lane 4 has no pass predicate' },
  { name: 'a live box that is not a lane', change: (p) => block(p, 'Verify, live.').lines.push(box('Extra step.')), message: 'live box is not a lane' },
  { name: 'perf boxes out of order', change: (p) => block(p, 'Verify, perf.').lines.reverse(), message: 'perf boxes are [' },
  { name: 'a Review gate of None with boxes', change: (p) => (block(p, 'Review gate.').lines = [box('screenshot video operator')]), message: 'Review gate says None but has boxes' },
  { name: 'a Review gate with no box', change: (p) => (block(p, 'Review gate.').rest = 'Operator reviews.'), message: 'Review gate has no box' },
  ...['screenshot', 'video', 'operator'].map((word) => ({
    name: `a Review gate lacking ${word}`,
    change: (p: Parts) => {
      const gate = block(p, 'Review gate.');
      gate.rest = 'Required.';
      gate.lines = [box(['screenshot', 'video', 'operator'].filter((w) => w !== word).join(' '))];
    },
    message: `Review gate lacks "${word}"`,
  })),
  { name: 'a long dash outside a fence', change: (p) => p.intro.push('One — two.'), message: 'long dash' },
  { name: 'an en dash outside a fence', change: (p) => p.intro.push('One – two.'), message: 'long dash' },
  { name: 'a curly quote', change: (p) => p.intro.push('It’s here.'), message: 'curly quote' },
  { name: 'a mid-sentence colon', change: (p) => p.intro.push('Finish the first part before the second: then ship.'), message: 'mid-sentence colon' },
];

describe('check-plan.mjs failures', () => {
  test.each(fails)('flags $name', async ({ change, message }) => {
    const result = await run(mutate(change));
    expect(result.status).toBe(1);
    expect(result.problems.filter((line) => line.includes(message))).toHaveLength(1);
  });

  test('a plan with no How to read this section fails with its message', async () => {
    const result = await run(render(defaults()).replace('## How to read this', '## Reading'));
    expect(result.problems).toContain('1: no "## How to read this" section');
  });

  test('a mutation reports only its own problem', async () => {
    const result = await run(mutate((p) => (block(p, 'Merge.').lines = [])));
    expect(result.problems).toHaveLength(1);
    expect(result.stdout).toContain('merge=0');
  });

  test('a three-line plan yields six problems and exit 1', async () => {
    const result = await run('# Plan\n\nIntro — here: bad\n');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('0 PR sections, 6 problems');
    expect(result.problems.map((line) => line.replace(/^\d+: /, '')).toSorted()).toEqual(
      ['long dash', 'mid-sentence colon', 'no "## Close the program" section', 'no "## How to read this" section', 'no "## Program checklist" section', 'no PR sections between Program checklist and Close the program'].toSorted(),
    );
  });
});

describe('check-plan.mjs prose rules and fences', () => {
  test.each([
    { name: 'a backtick fence', open: '```', close: '```' },
    { name: 'a four-backtick fence holding a three-backtick fence', open: '````text', close: '````', inner: '```' },
    { name: 'a fence indented three spaces', open: '   ```', close: '   ```' },
  ])('prose findings are exempt inside $name', async ({ open, close, inner }) => {
    const result = await run(mutate((p) => p.intro.push(open, 'Dash — quote “q” colon: here', ...(inner ? [inner, 'Still — inside: yes', inner] : []), close)));
    expect(result.problems).toEqual([]);
    expect(result.status).toBe(0);
  });

  test('prose findings resume after a fence closes', async () => {
    const result = await run(mutate((p) => p.intro.push('```', 'inside — ok', '```', 'outside — flagged')));
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('long dash');
  });

  test.each(['`a — b: c`', '![alt — text](x—y.png)', '[doc](path/with—dash)'])('inline code, image, and link targets are exempt: %s', async (text) => {
    const result = await run(mutate((p) => p.intro.push(`See ${text}.`)));
    expect(result.problems).toEqual([]);
  });

  test.each(['Owner: Josh', '- Owner: Josh', '**Owner:** Josh'])('a leading Label value line is allowed: %s', async (line) => {
    const result = await run(mutate((p) => (p.intro = [line])));
    expect(result.problems).toEqual([]);
  });

  test('a second colon after a leading label is still flagged', async () => {
    const result = await run(mutate((p) => (p.intro = ['Owner: finish the first part before the second: then ship.'])));
    expect(result.problems.filter((line) => line.includes('mid-sentence colon'))).toHaveLength(1);
  });

  test('a repository whose trunk is not main satisfies the trunk read', async () => {
    const result = await run(mutate((p) => (p.programBody[1] = box('Read `git show origin/master:docs/playbook.md` first.'))));
    expect(result.problems).toEqual([]);
  });
});

describe('check-plan.mjs location independence', () => {
  test('runs from a foreign working directory and from a copy outside the package', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'check-plan-foreign-'));
    directories.push(directory);
    const copy = join(directory, 'check-plan.mjs');
    await writeFile(copy, await readFile(script, 'utf8'));
    const plan = join(directory, 'plan.md');
    await writeFile(plan, render(defaults()));
    const result = spawnSync('node', [copy, plan], { cwd: directory, encoding: 'utf8' });
    expect({ status: result.status, stdout: result.stdout.split('\n').at(-2) }).toEqual({ status: 0, stdout: '1 PR sections, 0 problems' });
  });
});

describe('check-plan.mjs against the generated skeleton', () => {
  const skeleton = async () => {
    const playbook = await readFile(join(root, 'skills/poteto-mode/playbooks/multi-phase-plan.md'), 'utf8');
    return playbook.split('\n````markdown\n')[1]!.split('\n````')[0]!;
  };

  test('the unfilled skeleton reports its box counts and exactly one problem, the LANES placeholder', async () => {
    const result = await run(await skeleton());
    expect(result.stdout).toBe('<Task as a verb phrase> (<PR id>)  boxes=27  files=3 build=1 you-see=1 verify-unit=1 verify-live=10 verify-perf=4 review-gate=3 merge=4\n1 PR sections, 1 problems\n');
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('Verify, live lacks "Ten lanes on `<swarm workers model>` at the PR head"');
  });

  test('the skeleton passes once the swarm workers model is filled in', async () => {
    const result = await run((await skeleton()).replace('<swarm workers model>', 'grok-4.7-xhigh-fast'));
    expect(result.problems).toEqual([]);
    expect(result.status).toBe(0);
  });
});
