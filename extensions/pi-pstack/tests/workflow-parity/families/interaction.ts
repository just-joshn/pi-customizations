// MX-DIRECT-INTERACTION: an operator types into a live worker's tmux pane, the parent steers it, and RPC steers the parent.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { allWorkers, settledAndCollected } from '../lib/checks.ts';
import { type DriveApi, sleep } from '../lib/driver.ts';
import { persistedWorkers } from '../lib/live-workers.ts';
import { parentSession, rewriteSession, workerSessionFile } from '../lib/mutate.ts';
import type { Json, RunView, Session } from '../lib/view.ts';
import type { Family } from './types.ts';

const RUN = 'worker-interaction';
const SRC = src('poteto-mode/playbooks/orchestrate.md', 'Steer a worker only for a follow-up on the same work');
const PANE_PROMPT = 'PANE-PROMPT-7f3a';
const PANE_STEER = 'PANE-STEER-91bc';
const PARENT_STEER = 'PARENT-STEER-55de';
const RPC_STEER = 'RPC-STEER-0c2e';

const readState = (dir: string): Json => {
  try {
    return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as Json;
  } catch {
    return {};
  }
};
const idleSettles = (state: Json) => ((state['settles'] as { phase: string }[] | undefined) ?? []).filter((settle) => settle.phase === 'idle').length;

async function until(what: string, ready: () => boolean | Promise<boolean>, ms = 40_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ready())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

const tmux = (socket: string, ...args: string[]) => spawnSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });

/** The operator: types into the live worker's pane on the private tmux server, then steers the parent over RPC. */
async function operator(api: DriveApi): Promise<void> {
  let dir = '';
  await until('the worker to go idle once', () => {
    const candidate = persistedWorkers(api.ctx.repo).find((worker) => idleSettles(worker.state) >= 1 && typeof worker.state['tmuxSession'] === 'string');
    dir = candidate?.dir ?? '';
    return candidate !== undefined;
  });
  const session = String(readState(dir)['tmuxSession']);
  const type = (line: string) => {
    tmux(api.socket, 'send-keys', '-t', session, line, 'Enter');
  };
  type(`prompt ${PANE_PROMPT}`);
  await until('the worker to run the typed prompt', () => readState(dir)['phase'] === 'running');
  type(`steer ${PANE_STEER}`);
  await until('the parent to be running', async () => (((await api.request({ type: 'get_state' }))['data'] as Json | undefined)?.['isStreaming'] === true));
  const steered = await api.request({ type: 'steer', message: RPC_STEER });
  if (steered['success'] !== true) throw new Error(`RPC steer rejected: ${JSON.stringify(steered)}`);
  await until('the pane to echo the operator receipts', () => (tmux(api.socket, 'capture-pane', '-p', '-S', '-200', '-t', session).stdout.match(/operator receipt/g) ?? []).length >= 2);
  writeFileSync(join(api.ctx.sandbox, 'pane-capture.txt'), tmux(api.socket, 'capture-pane', '-p', '-S', '-200', '-t', session).stdout);
}

const worker = (view: RunView): Session | null => allWorkers(view).find((entry) => entry.state?.['tmuxSession'] !== undefined)?.session ?? null;
const userMessages = (session: Session | null) => (session?.messages ?? []).filter((message) => message.role === 'user' || message.customType !== undefined);
const userOrder = (session: Session | null, text: string) => userMessages(session).find((message) => message.text.includes(text))?.order ?? -1;
const capture = (view: RunView) => (existsSync(join(view.sandbox, 'pane-capture.txt')) ? readFileSync(join(view.sandbox, 'pane-capture.txt'), 'utf8') : '');

export const interactionFamily: Family = {
  id: 'worker-interaction',
  title: 'an operator types into a live worker pane, the parent steers the worker, and RPC steers the parent: every message lands in a transcript (MX-DIRECT-INTERACTION)',
  spec: {
    family: 'worker-interaction',
    runId: RUN,
    history: cartHistory,
    drive: operator,
    prompt: () => '/swarm Start one worker and wait for it while I talk to it.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const marker = join(parent.runDir, 'pane-done');
      parent.readSkill('swarm').bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook investigation --title "live worker" --run-id ${ctx.runId}`);
      parent.spawn('live', { role: 'general', model: 'sim/deepseek-sim', workspace: parent.worktree() }, 'Say ready, then do what you are asked.').wait('live');
      parent.bash(`until [ -f ${JSON.stringify(marker)} ]; do sleep 0.2; done`);
      parent.call('pstack_worker', { action: 'steer', runId: ctx.runId, workerId: 'live', message: PARENT_STEER }).wait('live', 2).collect('live').text('conversation done');
      return scenario(parent, { live: new Worker().text('ready').bash('sleep 6').bash(`touch ${JSON.stringify(marker)}`).text('handled the typed prompt and the typed steer').text('handled the parent steer') });
    },
  },
  checks: [
    check('worker-interaction.spawn-returns-an-attach-command', 'the spawn result names the tmux session and an attach command, and returned while the worker was starting', SRC, (view) => {
      const spawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn');
      const session = String(allWorkers(view).find((entry) => entry.state?.['tmuxSession'] !== undefined)?.state?.['tmuxSession'] ?? '?');
      return spawn !== undefined && /attach/.test(spawn.resultText) && spawn.resultText.includes(session) ? when(true, `spawn result carries ${spawn.resultText.match(/tmux[^\n]*attach[^\n]*/)?.[0] ?? 'attach'}`, '') : fail(`spawn result: ${spawn?.resultText.slice(0, 200)}`);
    }),
    check('worker-interaction.pane-shows-the-worker', 'the live pane shows the host banner, the operator command echo and a receipt for each typed line', SRC, (view) => {
      const text = capture(view);
      const receipts = (text.match(/operator receipt/g) ?? []).length;
      return when(/host ready/.test(text) && text.includes(`operator command`) && text.includes(PANE_PROMPT) && text.includes(PANE_STEER) && receipts >= 2, `pane shows host ready, both typed lines and ${receipts} receipts`, `capture: ${text.slice(0, 200) || 'empty'}`);
    }),
    check('worker-interaction.typed-prompt-reaches-the-transcript', 'the line typed as `prompt <text>` is a user message in the worker session, and the worker acted on it (its next tool call is the long command)', SRC, (view) => {
      const session = worker(view);
      const at = userOrder(session, PANE_PROMPT);
      const acted = session?.toolCalls.find((call) => call.name === 'bash' && /sleep 6/.test(String(call.args['command'])));
      return when(at !== -1 && acted !== undefined && acted.order > at, `user message at ${at}, the worker ran its command at ${acted?.order}`, `typed prompt at ${at}; command at ${acted?.order}`);
    }),
    check('worker-interaction.typed-steer-lands-mid-run', 'the line typed as `steer <text>` while the worker ran is a user message that follows the command it interrupted, and the worker answered it', SRC, (view) => {
      const session = worker(view);
      const at = userOrder(session, PANE_STEER);
      const sleeping = session?.toolCalls.find((call) => call.name === 'bash' && /sleep 6/.test(String(call.args['command'])));
      const answered = (session?.messages ?? []).some((message) => message.role === 'assistant' && message.order > at && /typed steer/.test(message.text));
      return when(at !== -1 && sleeping !== undefined && at > sleeping.order && answered, `steer at ${at} after the command at ${sleeping?.order}; the worker answered it`, `steer at ${at}; command at ${sleeping?.order}; answered ${answered}`);
    }),
    check('worker-interaction.parent-steer-lands', 'pstack_worker steer reaches the same worker as a user message, and the worker answered it', SRC, (view) => {
      const session = worker(view);
      const at = userOrder(session, PARENT_STEER);
      const result = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer');
      const answered = (session?.messages ?? []).some((message) => message.role === 'assistant' && message.order > at && /parent steer/.test(message.text));
      return when(at !== -1 && result?.isError === false && answered, `steer accepted (${result?.resultText.slice(0, 60)}), in the transcript at ${at}, answered`, `at ${at}; steer result ${result?.resultText.slice(0, 80)}; answered ${answered}`);
    }),
    check('worker-interaction.rpc-steer-lands-in-the-parent', 'an RPC steer sent while the parent ran a command is a user message in the parent session after that command and before its next call', SRC, (view) => {
      const waiting = view.parent.toolCalls.find((call) => call.name === 'bash' && /pane-done/.test(String(call.args['command'])));
      const at = userOrder(view.parent, RPC_STEER);
      const next = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer');
      return when(waiting !== undefined && at > waiting.order && next !== undefined && at < next.order, `RPC steer at ${at}, between the command (${waiting?.order}) and the next call (${next?.order})`, `steer at ${at}; command ${waiting?.order}; next ${next?.order}`);
    }),
    settledAndCollected('worker-interaction.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    { name: 'the typed prompt never reached the worker', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'live'), PANE_PROMPT, 'nothing'), fails: ['worker-interaction.typed-prompt-reaches-the-transcript'] },
    { name: 'the typed steer was lost', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'live'), PANE_STEER, 'nothing'), fails: ['worker-interaction.typed-steer-lands-mid-run'] },
    { name: 'the parent steer never arrived', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'live'), PARENT_STEER, 'nothing'), fails: ['worker-interaction.parent-steer-lands'] },
    { name: 'the RPC steer was not recorded in the parent', mutate: (sandbox) => rewriteSession(parentSession(sandbox), RPC_STEER, 'x'), fails: ['worker-interaction.rpc-steer-lands-in-the-parent'] },
    { name: 'the pane showed nothing', mutate: (sandbox) => writeFileSync(join(sandbox, 'pane-capture.txt'), ''), fails: ['worker-interaction.pane-shows-the-worker'] },
  ],
};
