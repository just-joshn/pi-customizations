import { randomUUID } from 'node:crypto';

import { inspectListener, inspectPane, readPane, sameProcess, unchanged } from './resource-workflows-run-runtime-inspect.mjs';

const states = new WeakMap();
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function canonicalRunCommands(identity) {
  if (identity.kind === 'server')
    return Object.freeze({
      launch: `${quote(process.execPath)} server.mjs > server.log 2>&1 & echo $!; sleep 0.5`,
      interact: `/usr/bin/curl -q --noproxy '*' --fail --silent --show-error 'http://127.0.0.1:${identity.port}/greet?name=Ada'; sleep 0.5`,
      cleanup: 'kill "$(cat server.pid)"',
    });
  const tmux = `tmux -f /dev/null -S ${quote(identity.socket)}`;
  return Object.freeze({
    launch: `${tmux} new-session -d -s f016-run -x 120 -y 40 '/usr/bin/python3 -I terminal.py'; sleep 0.5`,
    interact: `${tmux} send-keys -t f016-run:0.0 s Enter; sleep 0.5`,
    inspect: `${tmux} capture-pane -p -t f016-run:0.0; sleep 0.5`,
    cleanup: `${tmux} send-keys -t f016-run:0.0 q; sleep 0.5; ${tmux} kill-server 2>/dev/null || true`,
  });
}

function canonicalCalls(records, commands) {
  return records.flatMap((record, messageIndex) => {
    if (record.type !== 'message_end' || record.message?.role !== 'assistant') return [];
    return (record.message.content ?? []).flatMap((call) => {
      if (call.type !== 'toolCall' || call.name !== 'bash') return [];
      const action = Object.keys(commands).find((key) => call.arguments?.command === commands[key]);
      if (!action) return [];
      const start = records.findIndex((item, index) => index > messageIndex && item.type === 'tool_execution_start' && item.toolCallId === call.id && item.toolName === call.name && equal(item.args, call.arguments));
      if (start < 0) return [];
      const end = records.findIndex((item, index) => index > start && item.type === 'tool_execution_end' && item.toolCallId === call.id && item.toolName === call.name);
      return [{ id: call.id, action, start, end, success: end >= 0 && records[end].isError === false, result: end >= 0 ? records[end].result : null }];
    });
  });
}

const snapshot = (state) => structuredClone(state.session.records);
const literal = (call) => (call?.result?.content?.length === 1 && call.result.content[0].type === 'text' ? call.result.content[0].text : null);
const silent = (call) => call?.success && literal(call) === '(no output)' && call.result?.structuredContent?.exit_code === 0 && call.result.structuredContent.output === '';
const settings = (host) => host.text.split(/\r?\n/).includes('Settings enabled');
const ready = (host) => host.text.includes('Ready. Press s for settings, q to quit.') && !settings(host);
const bornAt = (host) => Number(host.birth.split(':')[0]) * 1000 + Number(host.birth.split(':')[1]) / 1000;
const sameLease = (left, right) => sameProcess(left, right) && left.command === right.command && left.cwd === right.cwd && left.sha256 === right.sha256 && left.paneId === right.paneId && equal(left.server, right.server);

async function inspect(state) {
  const captured = structuredClone(state.ownership.captured);
  if (state.identity.kind === 'tui') return inspectPane(state.identity, captured, state.deadline);
  for (const candidate of captured.filter((item) => item.pid !== state.session.pid && item.pid !== item.group)) {
    if (state.lease && !sameProcess(candidate, state.lease.host)) continue;
    const host = await inspectListener(state.identity, candidate, state.deadline);
    if (host) return host;
  }
  return null;
}

async function bind(observer, launch) {
  const state = observer.read();
  const baseline = state.baseline ?? (state.identity.kind === 'tui' ? await readPane(state.identity, state.deadline) : null);
  if (state.identity.kind === 'tui' && (!baseline || !ready(baseline))) return;
  if (baseline && !state.baseline) observer.update({ baseline });
  const host = await inspect(observer.read());
  if (!host || observer.read().phase !== 'observing' || bornAt(host) < state.openedAt || (host.server && bornAt(host.server) < state.openedAt)) return;
  if (baseline && (host.pid !== baseline.pid || host.paneId !== baseline.paneId || host.server.pid !== baseline.serverPid || bornAt(host) > baseline.sampledAt || bornAt(host.server) > baseline.sampledAt)) return;
  observer.update({ lease: { id: randomUUID(), launchId: launch.id, host, sampledAt: host.sampledAt }, samples: [host] });
}

async function tick(observer) {
  observer.update({ records: snapshot(observer.read()) });
  const state = observer.read();
  if (!unchanged(state.identity)) {
    observer.update({ integrity: 'changed' });
    throw new Error('Application source or package changed during observation.');
  }
  const calls = canonicalCalls(state.records, state.commands);
  const launch = calls.find((call) => call.id === state.lease?.launchId) ?? calls.find((call) => call.action === 'launch');
  if (!launch) return;
  if (!state.lease) return bind(observer, launch);
  const host = await inspect(state);
  if (host && sameLease(state.lease.host, host) && observer.read().phase === 'observing') observer.update({ samples: [...observer.read().samples, host] });
}

async function observe(observer) {
  while (observer.read().phase === 'observing' && Date.now() < observer.read().deadline) {
    try {
      await tick(observer);
    } catch (error) {
      const state = observer.read();
      observer.update({ integrity: error.code === 'ENOENT' || error.cause === 'source-changed' ? 'changed' : state.integrity, gaps: [...new Set([...state.gaps, `Runtime observation gap. ${error.message}`])] });
    }
    if (observer.read().phase === 'observing') await delay(20);
  }
  const state = observer.read();
  if (state.phase === 'observing') observer.update({ gaps: [...state.gaps, 'Runtime observer reached its 120000ms deadline.'] });
}

function common(state, callId) {
  return {
    provenance: 'protected-runtime',
    attemptId: state.identity.attemptId,
    applicationId: state.identity.applicationId,
    callId,
    leaseId: state.lease.id,
    launchCallId: state.lease.launchId,
    host: structuredClone(state.lease.host),
    liveSampledAt: state.lease.sampledAt,
  };
}

function uninterrupted(state, start, end, permitted) {
  return state.records
    .slice(start, end + 1)
    .filter((record) => record.type === 'tool_execution_start')
    .every((record) => permitted.includes(record.toolCallId));
}

function serverFacts(state, calls, launch) {
  if (literal(launch) !== `${state.lease.host.pid}\n`) return [];
  const request = calls.find((call) => call.action === 'interact' && call.success && call.start > launch.end && literal(call) === 'Hello Ada\n');
  if (!request || !uninterrupted(state, launch.start, request.end, [launch.id, request.id])) return [];
  const host = state.samples.find((sample) => sample.response?.status === 200 && sample.response.body === 'Hello Ada\n');
  if (!host) return [];
  const fields = { ...common(state, request.id), pid: host.pid, port: state.identity.port, sampledAt: host.sampledAt, hostObservation: host };
  return [
    { ...fields, type: 'listener', address: '127.0.0.1', ready: true },
    {
      ...fields,
      type: 'http-response',
      url: '/greet?name=Ada',
      ...host.response,
      modelStdout: literal(request),
      corroboration:
        'Independent host HTTP response from the verified live application lease, joined to the separate successful canonical model curl and its literal SDK response. This is not a capture of model traffic or an active-tool timing theorem.',
    },
  ];
}

function terminalFacts(state, calls, launch) {
  if (!silent(launch) || !state.baseline || !ready(state.baseline)) return [];
  const input = calls.find((call) => call.action === 'interact' && silent(call) && call.start > launch.end);
  if (!input) return [];
  const capture = calls.find((call) => call.action === 'inspect' && call.success && call.start > input.end);
  if (!capture || !uninterrupted(state, launch.start, capture.end, [launch.id, input.id, capture.id])) return [];
  const host = state.samples.find((sample) => settings(sample) && literal(capture) === sample.text && sample.sampledAt > state.baseline.sampledAt);
  if (!host) return [];
  const fields = { ...common(state, input.id), socket: state.identity.socket, paneId: host.paneId, hostBefore: state.baseline, hostAfter: host, sampledAt: host.sampledAt };
  return [
    { ...fields, type: 'terminal-input', key: 's', keys: ['s', 'Enter'], sequence: input.start, contract: 'Literal s Enter is required by this bounded command contract, not by the raw terminal application.' },
    {
      ...fields,
      type: 'pane',
      callId: capture.id,
      text: host.text,
      sequence: capture.start,
      corroboration: 'Independent same-lease ready and settings panes with only the canonical model input between them, joined to the successful literal SDK capture. Host receipt time is not tool execution time.',
    },
  ];
}

export function runtimeEvidence(runtime, identity, records) {
  const state = states.get(runtime)?.();
  if (!state || !equal(state.identity, identity)) return { observations: [], gaps: ['No matching observer-authorized runtime.'] };
  if (state.phase !== 'sealed') return { observations: [], gaps: ['Runtime must finish and seal before evidence collection.'] };
  if (state.integrity !== 'unchanged' || !unchanged(identity) || !equal(records, state.records)) return { observations: [], gaps: ['Source or RPC records differ from sealed runtime.'] };
  const calls = canonicalCalls(state.records, state.commands);
  const launch = calls.find((call) => call.id === state.lease?.launchId && call.success);
  const observations = launch ? (identity.kind === 'server' ? serverFacts(state, calls, launch) : terminalFacts(state, calls, launch)) : [];
  return structuredClone({
    observations,
    gaps: [
      'Hash checks prove observed application path bytes, not whole-lifetime loaded code immutability. Source can change between samples. The existing sandbox is unchanged.',
      'Host application observations corroborate the canonical model workflow. They do not establish exact model network-traffic or tool-active intervals.',
      ...state.gaps,
      ...(observations.length ? [] : [`No complete canonical live application interaction was observed. Lease ${state.lease ? 'bound' : 'missing'}. Host samples ${state.samples.length}.`]),
    ],
  });
}

export function openRunRuntime({ identity, session, ownership }) {
  if (!['server', 'tui'].includes(identity.kind)) throw new Error('Runtime supports only server and tui recipes.');
  let state = {
    identity: structuredClone(identity),
    session,
    ownership,
    commands: canonicalRunCommands(identity),
    phase: 'observing',
    integrity: 'unchanged',
    openedAt: Date.now(),
    deadline: Date.now() + 120000,
    records: [],
    lease: null,
    baseline: null,
    samples: [],
    gaps: [],
  };
  const observer = {
    read: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
  };
  const observing = observe(observer);
  let finishing;
  const finish = () => {
    if (finishing) return finishing;
    observer.update({ phase: 'stopping' });
    finishing = observing.then(() => observer.update({ records: snapshot(state), phase: 'sealed' }));
    return finishing;
  };
  const runtime = Object.freeze({ finish, close: finish });
  states.set(runtime, observer.read);
  return runtime;
}
