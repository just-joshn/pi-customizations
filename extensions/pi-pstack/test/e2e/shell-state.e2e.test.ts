// Cursor CLI 2026.11.05 keeps the shell's working directory and exported variables between shell calls in one
// conversation, and starts a background command from them (parity/evidence/shell-probe-2026-11-07).
import { expect, onTestFinished, test } from 'vitest';
import { makeSandbox, type PiEvent, type RpcSession, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

const SET = { tool: 'bash', args: { command: 'cd /usr && export PSTACK_PROBE=42' } };
const PROBE = { tool: 'bash', args: { command: 'pwd; echo "probe=$PSTACK_PROBE"' } };

function sandbox(settings: Record<string, unknown> = {}): Sandbox {
  const made = makeSandbox(settings);
  onTestFinished(() => made.dispose());
  return made;
}

function rpcSession(box: Sandbox): RpcSession {
  const rpc = startRpc(box);
  onTestFinished(() => rpc.close());
  return rpc;
}

async function command(rpc: RpcSession, type: string): Promise<void> {
  rpc.send({ id: type, type });
  const response = await rpc.waitFor((event) => event.type === 'response' && event['id'] === type, 60_000);
  expect(response).toMatchObject({ command: type, success: true });
}

/** Sets the shell state in one prompt, runs `between`, then returns what the probe prints in the next prompt. */
async function probeAfter(rpc: RpcSession, between: () => Promise<void>): Promise<string | undefined> {
  const settled = (mark: number) => (event: PiEvent) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark;
  let mark = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([SET]) });
  await rpc.waitFor(settled(mark));
  await between();
  mark = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([PROBE]) });
  await rpc.waitFor(settled(mark));
  return toolEnds(rpc.events.slice(mark), 'bash')[0]?.text;
}

test('a second bash call runs where the first left the shell, with its exported variables', async () => {
  const run = await runJson(sandbox(), script([SET, PROBE]), ['--no-session']);

  expect(toolEnds(run.events, 'bash').map((end) => [end.isError, end.text])).toEqual([
    [false, '(no output)'],
    [false, '/usr\nprobe=42\n'],
  ]);
});

const task = (steps: unknown[], options: Record<string, unknown> = {}) => ({ tool: 'Task', args: { description: 'shell probe', subagent_type: 'shell', prompt: script(steps), ...options } });

test.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')("a readonly subagent's sandboxed shell keeps its own state between calls", async () => {
  const run = await runJson(sandbox(), script([task([SET, PROBE], { readonly: true })]), ['--no-session']);

  expect(toolEnds(run.events, 'Task')[0]?.text).toContain('RESULTS:\n[bash] (no output)\n[bash] /usr\nprobe=42\n');
});

test("a subagent's shell starts fresh, not where the parent's shell is", async () => {
  const box = sandbox();
  const run = await runJson(box, script([SET, task([PROBE])]), ['--no-session']);

  expect(toolEnds(run.events, 'Task')[0]?.text).toContain(`RESULTS:\n[bash] ${box.workDir}\nprobe=\n`);
});

test('a function defined in one bash call runs in the next', async () => {
  const run = await runJson(sandbox(), script([{ tool: 'bash', args: { command: `pstack_fn() { printf '%s' "it's"; }` } }, { tool: 'bash', args: { command: 'pstack_fn' } }]), ['--no-session']);

  expect(toolEnds(run.events, 'bash').map((end) => [end.isError, end.text])).toEqual([
    [false, '(no output)'],
    [false, "it's"],
  ]);
});

test('a background command that changes directory leaves that directory for the next bash call', async () => {
  const run = await runJson(
    sandbox(),
    script([
      { tool: 'bash', args: { command: 'cd /tmp' } },
      { tool: 'bash_background', args: { command: 'cd /usr', block_until_ms: 10_000 } },
      { tool: 'bash', args: { command: 'pwd' } },
    ]),
    ['--no-session'],
  );

  expect(toolEnds(run.events, 'bash').map((end) => end.text)).toEqual(['(no output)', '/usr\n']);
});

test('a bash command moved to the background keeps the directory it reached', async () => {
  const run = await runJson(
    sandbox(),
    script([
      { tool: 'bash', args: { command: 'cd /tmp' } },
      { tool: 'bash', args: { command: 'cd /usr && sleep 30', timeout: 1 } },
      { tool: 'bash', args: { command: 'pwd' } },
    ]),
    ['--no-session'],
  );

  expect(toolEnds(run.events, 'bash').at(-1)?.text).toBe('/usr\n');
});

test('bash_background starts where the shell is, with its exported variables', async () => {
  const run = await runJson(sandbox(), script([SET, { tool: 'bash_background', args: { command: 'pwd; echo "probe=$PSTACK_PROBE"', block_until_ms: 10_000 } }]), ['--no-session']);

  expect(toolEnds(run.events, 'bash_background')[0]?.text).toContain('Command output:\n\n```\n/usr\nprobe=42\n\n```');
});

test('the shell state carries across prompts and compaction in one session', async () => {
  const rpc = rpcSession(sandbox({ compaction: { keepRecentTokens: 1 } }));

  await expect(probeAfter(rpc, () => command(rpc, 'compact'))).resolves.toBe('/usr\nprobe=42\n');
});

test.for(['new_session', 'clone'])('a session made by %s starts with a fresh shell', async (type) => {
  const box = sandbox();
  const rpc = rpcSession(box);

  await expect(probeAfter(rpc, () => command(rpc, type))).resolves.toBe(`${box.workDir}\nprobe=\n`);
});
