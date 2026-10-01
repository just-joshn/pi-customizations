import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? '/tmp/pstack-skill-reload-tui');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'pstack-skill-reload-'));
const agent = join(directory, 'agent');
const cwd = join(directory, 'workspace');
await mkdir(agent, { recursive: true });
await mkdir(cwd, { recursive: true });
const socket = `pstack-reload-${process.pid}`;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const tmux = (...args) => execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });
const pane = () => tmux('capture-pane', '-p', '-t', 'reload');
const submit = (text) => {
  tmux('send-keys', '-t', 'reload', '-l', text);
  tmux('send-keys', '-t', 'reload', 'Enter');
};
async function wait(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 40));
  }
  throw new Error('Skill reload terminal journey timed out');
}
async function requests() {
  const files = (await readdir(output)).filter((name) => /^requests-\d+\.jsonl$/.test(name));
  return (
    await Promise.all(
      files.map(async (name) =>
        (
          await readFile(join(output, name), 'utf8')
        )
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      ),
    )
  ).flat();
}
async function skill(name, description, body) {
  const path = join(cwd, '.pi', 'skills', name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\ndisable-model-invocation: true\n---\n${body}\n`);
}
try {
  assert.equal((await requests()).length, 0, 'Use a fresh evidence directory');
  await skill('e2e-terminal-reload', 'Before reload', 'Literal original terminal skill body.');
  tmux(
    'new-session',
    '-d',
    '-s',
    'reload',
    '-x',
    '120',
    '-y',
    '35',
    '-c',
    cwd,
    `env PI_CODING_AGENT_DIR=${quote(agent)} PSTACK_JOURNEY_LOG=${quote(output)} pi --no-session --approve --no-extensions -e ${quote(join(root, 'src/index.ts'))} -e ${quote(join(root, 'test/journey-provider.ts'))} --provider journey-test --model recorder --thinking off`,
  );
  await wait(() => pane().includes('recorder'));
  submit('/skill:e2e-terminal-reload');
  await wait(async () => (await requests()).length === 1 && pane().includes('recorded'));
  assert.ok(JSON.stringify((await requests())[0].messages).includes('Literal original terminal skill body.'));
  await writeFile(join(output, 'before-reload.txt'), pane());
  await skill('e2e-terminal-reload', 'After reload', 'Literal edited terminal skill body.');
  await skill('e2e-terminal-added', 'Added during terminal session', 'Literal added terminal skill body.');
  submit('/reload');
  await wait(() => pane().includes('Reloaded'));
  assert.equal((await requests()).length, 1, 'Literal /reload does not invoke the model');
  await writeFile(join(output, 'reload-notification.txt'), pane());
  submit('/skill:e2e-terminal-added');
  await wait(async () => (await requests()).length === 2);
  assert.ok(JSON.stringify((await requests())[1].messages).includes('Literal added terminal skill body.'));
  await wait(() => pane().includes('recorded'));
  submit('/skill:e2e-terminal-reload');
  await wait(async () => (await requests()).length === 3);
  assert.ok(JSON.stringify((await requests())[2].messages).includes('Literal edited terminal skill body.'));
  await writeFile(join(output, 'after-reload.txt'), pane());
  await writeFile(
    join(output, 'results.json'),
    `${JSON.stringify({ passed: true, requests: 3, checks: ['original body delivered', 'literal reload notification', 'reload creates no model request', 'new skill body delivered', 'edited skill body delivered'], scope: 'Real Pi TUI, deterministic main-session provider, no Task or external inference.' }, null, 2)}\n`,
  );
  process.stdout.write('Real TUI skill reload passes five checks.\n');
} finally {
  try {
    await writeFile(join(output, 'final-terminal.txt'), pane());
  } catch {}
  try {
    tmux('kill-server');
  } catch {}
  await rm(directory, { recursive: true, force: true });
}
