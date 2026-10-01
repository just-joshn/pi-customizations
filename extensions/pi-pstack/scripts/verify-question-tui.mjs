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
  tmux('new-session', '-d', '-s', 'questions', '-x', '120', '-y', '35', '-c', agent, `env PI_CODING_AGENT_DIR=${quote(agent)} PSTACK_TUI_ANSWERS=${quote(answer)} pi --no-session -e ${quote(join(root, 'test/question-tui-fixture.ts'))}`);
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
  await writeFile(join(output, 'results.json'), JSON.stringify({ passes: cases.map((row) => row.name), scope: 'Production question handler, real Pi TUI, no inference or subagents.' }, null, 2));
  process.stdout.write('Five real terminal question journeys passed\n');
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
