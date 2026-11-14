import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RWA_BASELINE = '39d86229dd9966a441821d85fed11bb6d01bac57';
export const RWA_PATCHED = '035b8d947f86fbbe666efa1e7fa8d8ca358af393';
export const RWA_FIX = 'https://github.com/just-joshn/realworld-app/pull/5';
export interface RwaServer {
  commit: string;
  origin: string;
  apiOrigin: string;
  started: number;
  ready: number;
  managerPid: number;
}
export interface RwaCapture {
  session: string;
  note: string;
  start: number;
  at: number;
  origin: string;
  state: string;
  stem: string;
}
interface Request {
  at: number;
  method: string;
  path: string;
  session: string;
  body: string;
  status: number;
}
interface Transaction {
  id: string;
  description: string;
  amount: number;
}
const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const unzip = (file: string, entry: string) => execFileSync('unzip', ['-p', file, entry], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

export function checkLiveCaptures(out: string, server: RwaServer, commit: string, captures = read<RwaCapture[]>(join(out, 'captures.json'))): void {
  assert.equal(server.commit, commit, 'server must run the required pinned build');
  assert.equal(captures.length, 2, 'two live captures required');
  assert.equal(new Set(captures.map((capture) => capture.session)).size, 2, 'two distinct browser sessions required');
  assert.equal(new Set(captures.map((capture) => sha(join(out, `${capture.stem}.png`)))).size, 2, 'two distinct screenshot bytes required');
  const requests = read<Request[]>(join(out, 'requests.json'));
  const database = read<{ transactions: Transaction[] }>(join(out, 'app/data/database.json'));
  const seed = read<{ transactions: Transaction[] }>(join(out, 'app/data/database-seed.json'));
  assert.deepEqual(
    database.transactions.filter((row) => seed.transactions.some((old) => old.id === row.id)),
    seed.transactions,
    'seed transactions must not be injected or rewritten',
  );
  assert.equal(database.transactions.length, seed.transactions.length + 2, 'only two UI transactions may be added');
  const amount = commit === RWA_BASELINE ? 1200 : 1234;
  let previous = server.ready;
  for (const capture of captures) {
    assert.equal(capture.origin, server.origin, 'capture must target the launched app port');
    assert(capture.start >= previous && capture.at > capture.start, 'captures must be ordered live sessions after startup');
    previous = capture.at;
    const expected = `Paid $${(amount / 100).toFixed(2)} for ${capture.note}`;
    assert.equal(capture.state, expected, 'capture must show the discriminating cents state');
    assert(readFileSync(join(out, `${capture.stem}.aria.yml`), 'utf8').includes(expected), 'DOM capture must contain the observed confirmation');
    const trace = unzip(join(out, `${capture.stem}.zip`), 'trace.trace');
    const network = unzip(join(out, `${capture.stem}.zip`), 'trace.network');
    const events = trace
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; method?: string; params?: Record<string, unknown> });
    const actions = events.filter((event) => event.type === 'before');
    assert(!actions.some((event) => /evaluate|route|addInitScript|setStorage|setContent/i.test(event.method ?? '')), 'state injection is not UI interaction');
    assert(
      actions.some((event) => event.method === 'fill' && event.params?.['value'] === '12.34'),
      'trace must show the real amount form filled',
    );
    assert(
      actions.some((event) => event.method === 'click' && String(event.params?.['selector']).includes('transaction-create-submit-payment')),
      'trace must show the Pay click',
    );
    assert(trace.includes(expected), 'browser trace DOM must independently show the cents symptom');
    assert(network.includes(server.origin) && network.includes(server.apiOrigin) && network.includes(capture.session), 'trace network must bind the browser session to this app and API');
    const sessionRequests = requests.filter((request) => request.session === capture.session);
    for (const request of sessionRequests.filter((request) => request.path === '/graphql')) {
      const body = JSON.parse(request.body) as { operationName: string; query: string };
      assert(body.operationName === 'ListBankAccount' && body.query.trim().startsWith('query '), 'GraphQL may only read bank accounts');
    }
    const mutations = sessionRequests.filter((request) => request.path !== '/graphql' && !['GET', 'OPTIONS', 'HEAD'].includes(request.method));
    assert.deepEqual(
      mutations.map((request) => [request.method, request.path, request.status]),
      [
        ['POST', '/login', 200],
        ['POST', '/transactions', 200],
      ],
      'only login and UI payment mutations allowed',
    );
    const payment = mutations[1];
    assert(payment !== undefined && payment.at >= capture.start && payment.at <= capture.at, 'server payment timestamp must belong to the UI session');
    const resources = network
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { snapshot: { startedDateTime: string; request: { method: string; url: string; postData?: { _file: string } } } });
    const resource = resources.find((entry) => entry.snapshot.request.method === 'POST' && entry.snapshot.request.url === `${server.apiOrigin}/transactions`)?.snapshot;
    assert(resource?.request.postData !== undefined, 'trace must contain the real payment request body');
    assert.equal(unzip(join(out, `${capture.stem}.zip`), resource.request.postData._file), payment.body, 'trace payment body must match the independent API gateway log');
    assert(Math.abs(Date.parse(resource.startedDateTime) - payment.at) < 1000, 'browser and API payment timestamps must agree within one second');
    const payload = JSON.parse(payment.body) as { amount: number; description: string };
    assert.equal(Number(payload.amount), 12.34, 'server must receive cents entered through the UI');
    assert.equal(payload.description, capture.note, 'server must receive the session-specific UI note');
    assert.equal(database.transactions.find((row) => row.description === capture.note)?.amount, amount, 'real server must persist the discriminating cents value');
  }
}

export function auditLiveWorker(session: string, allowedCommands: string[]): string[] {
  type Part = { type: string; name?: string; id?: string; arguments?: { path?: string; command?: string }; text?: string };
  type Message = { role: string; content: Part[]; toolCallId?: string; isError?: boolean };
  const messages = session
    .trim()
    .split('\n')
    .flatMap((line) => {
      const entry = JSON.parse(line) as { type: string; message?: Message };
      return entry.type === 'message' && entry.message !== undefined ? [entry.message] : [];
    });
  const calls = messages.filter((message) => message.role === 'assistant').flatMap((message) => message.content.filter((part) => part.type === 'toolCall'));
  const searches: string[] = [];
  for (const call of calls) {
    const result = messages.find((message) => message.role === 'toolResult' && message.toolCallId === call.id);
    assert(result !== undefined && !result.isError, `worker tool ${call.name} must actually succeed`);
    const output = result.content.map((part) => part.text ?? '').join('\n');
    if (call.name === 'read') {
      assert(output.includes(RWA_FIX), 'thread and tracker search must actually return the existing fix reference');
      searches.push(call.arguments?.path ?? '');
    } else {
      assert.equal(call.name, 'bash', 'worker must not inject state through other tools');
      const command = call.arguments?.command ?? '';
      assert(allowedCommands.includes(command), 'worker must not inject state through unapproved shell commands');
      if (command.includes(' log --all ')) {
        assert(output.includes(RWA_PATCHED), 'repository search must actually find the existing fix commit');
        searches.push('git log');
      }
    }
  }
  for (const command of allowedCommands)
    assert(
      calls.some((call) => call.arguments?.command === command),
      'required browser or record command was not executed',
    );
  return searches;
}

export function checkExistingFix(input: { searches: string[]; fix: string; before: string; after: string; patched: RwaServer }): void {
  assert.equal(input.fix, RWA_FIX, 'report must name the mirrored existing fix');
  for (const source of ['thread.json', 'tracker.json', 'git log'])
    assert(
      input.searches.some((command) => command.includes(source)),
      `missing observable search of ${source}`,
    );
  assert.equal(input.before, input.after, 'verification must not author over an existing fix');
  assert.equal(input.patched.commit, RWA_PATCHED, 'verification must run the patched build');
}
