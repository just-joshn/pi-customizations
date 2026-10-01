import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? '/tmp/pstack-question-tui');
await mkdir(output, { recursive: true });
const agent = await mkdtemp(join(tmpdir(), 'pstack-question-agent-'));
const answer = join(output, 'answer.json');
const socket = `pstack-question-${process.pid}`;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const tmux = (...args) => execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });
const pane = () => tmux('capture-pane', '-p', '-t', 'questions');
const literal = (text) => tmux('send-keys', '-t', 'questions', '-l', text);
const key = (...keys) => tmux('send-keys', '-t', 'questions', ...keys);
async function wait(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  throw new Error('Terminal journey timed out');
}
const cases = [
  { name: 'single', mode: 'single', keys: ['Down', 'Enter'], answers: ['two'], cancelled: false, width: 120 },
  { name: 'text', mode: 'text', text: 'terminal answer', keys: ['Enter'], answers: ['terminal answer'], cancelled: false, width: 120 },
  { name: 'cancel', mode: 'single', keys: ['Escape'], answers: [], cancelled: true, width: 120 },
  { name: 'multiple', mode: 'multiple', keys: ['Down', 'Enter'], answers: ['one', 'two'], cancelled: false, width: 70 },
  { name: 'partial-cancel', mode: 'multiple', keys: ['Escape'], answers: ['one'], cancelled: true, width: 70 },
];
try {
  tmux(
    'new-session',
    '-d',
    '-s',
    'questions',
    '-x',
    '120',
    '-y',
    '35',
    '-c',
    agent,
    `env PI_CODING_AGENT_DIR=${quote(agent)} PSTACK_TUI_ANSWERS=${quote(answer)} pi --no-session -e ${quote(join(root, 'test/question-tui-fixture.ts'))} -e ${quote(join(root, 'test/setup-tui-fixture.ts'))}`,
  );
  await wait(() => pane().includes('question-tui-fixture.ts') && pane().includes('0.0%/'));
  for (const row of cases) {
    await rm(answer, { force: true });
    tmux('resize-window', '-t', 'questions', '-x', String(row.width), '-y', '35');
    literal(`/fixture-question ${row.mode}`);
    key('Enter');
    await wait(() => pane().includes('Fixture preference'));
    await writeFile(join(output, `${row.name}-dialog.txt`), pane());
    if (row.mode === 'multiple') {
      key('Enter');
      await wait(() => pane().includes('selected: First choice'));
      if (!row.cancelled) {
        key('Enter');
        await wait(() => pane().includes('selected: First choice, Second choice'));
      }
      await writeFile(join(output, `${row.name}-selected.txt`), pane());
    }
    if (row.text) literal(row.text);
    key(...row.keys);
    await wait(async () => {
      try {
        return JSON.parse(await readFile(answer, 'utf8'));
      } catch {
        return false;
      }
    });
    const actual = JSON.parse(await readFile(answer, 'utf8'));
    assert.deepEqual(actual, [{ id: 'fixture', answers: row.answers, cancelled: row.cancelled }], row.name);
    await writeFile(join(output, `${row.name}-answer.json`), JSON.stringify(actual, null, 2));
    await wait(() => !pane().includes('Fixture preference'));
  }
  await rm(answer, { force: true });
  literal('/fixture-setup-cancel');
  key('Enter');
  await wait(() => pane().includes('pstack reasoning budget'));
  await writeFile(join(output, 'setup-budget-dialog.txt'), pane());
  key('Escape');
  await wait(async () => {
    try {
      return JSON.parse(await readFile(answer, 'utf8'));
    } catch {
      return false;
    }
  });
  const cancelledSetup = JSON.parse(await readFile(answer, 'utf8'));
  assert.deepEqual(cancelledSetup, { completed: false, configurationExists: false });
  await writeFile(join(output, 'setup-cancel-answer.json'), JSON.stringify(cancelledSetup, null, 2));
  const roles = [
    'feature, refactoring',
    'bug-fix',
    'perf-issue',
    'hillclimb',
    'judgment and prose',
    'hardest tasks',
    'how explorer',
    'how explainer',
    'why investigators',
    'why synthesizer',
    'reflect tooling',
    'reflect judgment, divergent, synthesizer',
    'arena runners',
    'arena cross-judge pool',
    'swarm workers',
    'architect runners',
    'interrogate reviewers',
  ];
  const config = join(agent, 'pstack/models.mdc');
  const initial = `${roles.map((role) => `${role}: auto`).join('\n')}\n`;
  await mkdir(dirname(config), { recursive: true });
  await writeFile(config, initial);
  for (const mode of ['decline', 'accept', 'edit', 'panel']) {
    const accept = mode !== 'decline';
    await rm(answer, { force: true });
    literal('/fixture-setup-cancel');
    key('Enter');
    await wait(() => pane().includes('pstack reasoning budget'));
    key('Down', 'Down', 'Down', 'Enter');
    await wait(() => pane().includes('Accept model table or change a role'));
    await writeFile(join(output, `setup-${mode}-roles.txt`), pane());
    if (mode === 'edit') {
      key('Down', 'Down', 'Enter');
      await wait(() => pane().includes('bug-fix (current: auto)'));
      await writeFile(join(output, 'setup-edit-picker.txt'), pane());
      key('Enter');
      await wait(() => pane().includes('Accept model table or change a role'));
    }
    if (mode === 'panel') {
      key(...Array.from({ length: 13 }, () => 'Down'), 'Enter');
      await wait(() => pane().includes('arena runners seat 1'));
      key('Enter');
      await wait(() => pane().includes('arena runners seat 2'));
      key('Down', 'Enter');
      await wait(() => pane().includes('arena runners seat 3'));
      await writeFile(join(output, 'setup-panel-duplicate-seats.txt'), pane());
      key('Enter');
      await wait(() => pane().includes('Accept model table or change a role'));
    }
    key('Enter');
    await wait(() => pane().includes('Write pstack model configuration?'));
    await writeFile(join(output, `setup-${mode}-confirmation.txt`), pane());
    if (!accept) key('Escape');
    else key('Enter');
    await wait(async () => {
      try {
        return JSON.parse(await readFile(answer, 'utf8'));
      } catch {
        return false;
      }
    });
    const actual = JSON.parse(await readFile(answer, 'utf8'));
    assert.equal(actual.completed, accept);
    assert.equal(actual.configurationExists, true);
    if (accept) {
      assert.ok(actual.configuration.includes('# budget: small (medium)'));
      for (const role of roles) {
        const expected = role === 'arena runners' && mode === 'panel' ? 'inherit-parent, inherit-parent' : role === 'bug-fix' && ['edit', 'panel'].includes(mode) ? 'inherit-parent' : 'auto';
        assert.ok(actual.configuration.includes(`${role}: ${expected}\n`), role);
      }
    } else assert.equal(actual.configuration, initial);
    await writeFile(join(output, `setup-${mode}-answer.json`), JSON.stringify(actual, null, 2));
    await wait(() => !pane().includes('Write pstack model configuration?'));
  }
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        passes: [...cases.map((row) => row.name), 'setup-budget-cancel', 'setup-write-decline', 'setup-write-accept', 'setup-role-edit', 'setup-panel-duplicate-seats'],
        scope: 'Production question and setup handlers, real Pi TUI, no inference or subagents.',
      },
      null,
      2,
    ),
  );
  process.stdout.write('Ten real terminal question and setup journeys passed\n');
} finally {
  try {
    await writeFile(join(output, 'final-terminal.txt'), pane());
  } catch (error) {
    process.stderr.write(`Terminal capture failed: ${String(error)}\n`);
  }
  try {
    tmux('kill-server');
  } catch (error) {
    process.stderr.write(`Terminal cleanup failed: ${String(error)}\n`);
  }
  await rm(agent, { recursive: true, force: true });
}
