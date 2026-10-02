import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rpcProcess } from './rpc-process.mjs';
import { promptAndSettle } from './rpc-turn.mjs';

function uiBridge(child, answers) {
  const requests = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let boundary = buffer.indexOf('\n');
    while (boundary >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (line.trim()) respond(requests, answers, child, line);
      boundary = buffer.indexOf('\n');
    }
  });
  return requests;
}

const silentMethods = new Set(['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text']);
const dialogBudget = 150;

function respond(requests, answers, child, line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (record?.type !== 'extension_ui_request') return;
  requests.push(record);
  if (silentMethods.has(record.method)) return;
  answers.dialogs += 1;
  const exhausted = answers.dialogs > dialogBudget;
  const supplied = exhausted ? undefined : answers[record.method];
  const value = typeof supplied === 'function' ? supplied(record) : (supplied ?? record.options?.[0]);
  const response = record.method === 'confirm' ? { type: 'extension_ui_response', id: record.id, confirmed: !exhausted } : { type: 'extension_ui_response', id: record.id, value };
  child.stdin.write(`${JSON.stringify(response)}\n`);
}

export async function everyRequest(log) {
  const names = (await readdir(log)).filter((name) => name.startsWith('requests-') && name.endsWith('.jsonl'));
  const text = (await Promise.all(names.map((name) => readFile(join(log, name), 'utf8').catch(() => '')))).join('');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForRpcIdle(client) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const state = await client.send({ type: 'get_state' });
    if (!state.isStreaming && state.pendingMessageCount === 0) return;
    await new Promise((done) => setTimeout(done, 40));
  }
  throw new Error('Pi did not return to idle');
}

async function recordedRequests(log, child) {
  return (await readFile(join(log, `requests-${child.pid}.jsonl`), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function clientFor(child, log) {
  let settlements = 0;
  const client = rpcProcess(child, {
    requestDeadlineMs: 180000,
    shutdownDeadlineMs: 15000,
    onRecord: (record) => {
      if (record.type === 'agent_settled') settlements += 1;
    },
  });
  let reference = 0;
  const requests = () => recordedRequests(log, child);
  return {
    send: (message) => client.send(message),
    requests,
    toolUpdates: client.toolUpdates,
    finish: () => client.finish(),
    close: () => client.close(),
    async run(message) {
      reference = (await requests()).length;
      await promptAndSettle(
        (command) => client.send(command),
        () => settlements,
        { type: 'prompt', message },
      );
      await waitForRpcIdle(client);
      const recorded = await requests();
      return recorded.slice(reference);
    },
    async turn(message) {
      const recorded = await this.run(message);
      const last = recorded.at(-1);
      if (!last) throw new Error(`No model request was produced for ${message}`);
      return last;
    },
    async messages() {
      return (await client.send({ type: 'get_messages' })).messages;
    },
    async callTool(message) {
      await client.send({ type: 'new_session' });
      const before = (await this.messages()).length;
      await this.run(message);
      return (await this.messages()).slice(before);
    },
    everyRequest: () => everyRequest(log),
  };
}

export function piLauncher({ cli, root, progressFixture }) {
  return async function startPi(directory, log, extraArgs, extra = {}, agentDirectory = directory) {
    const extraEnv = typeof extra === 'string' ? {} : extra;
    const agentHome = typeof extra === 'string' ? extra : agentDirectory;
    const child = spawn(process.execPath, [cli, '--mode', 'rpc', ...extraArgs, '-e', root], {
      cwd: directory,
      env: { ...process.env, ...extraEnv, HOME: agentHome, PI_CODING_AGENT_DIR: agentHome, PSTACK_JOURNEY_LOG: log, PSTACK_PROGRESS_FIXTURE: progressFixture },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const answers = { input: 'journey-test/recorder', dialogs: 0 };
    return {
      answers,
      ui: uiBridge(child, answers),
      stderr: () => stderr,
      ...clientFor(child, log),
    };
  };
}
