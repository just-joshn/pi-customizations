// Per-run setup for the x-subscription drives: scratch files, the scratch CA, the peers, and the
// env every Pi process gets. setup() returns the ctx each drive receives; checkEgress() is the
// invariant the CLI applies after every passing drive.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { cleanEnv, keys, onStop, openLogin, pane, runPi, startRpc, startTui, stopTui, type, waitForPane } from '../../_shared/verify-harness.mjs';
import { EXTENSION, SKILL_DIR } from './fixtures.mjs';
import { PEER_HOSTS, startPeers } from './peers.mjs';

export const SCRIPT_NAME = 'control-x-subscription-oauth';
export const PREFIX = 'verify-xsub-oauth-';
export const SCRUBBED_ENV = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'PI_CODING_AGENT_DIR',
  'PI_OFFLINE',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'XAI_API_KEY',
  'CURSOR_API_KEY',
  'VERIFY_X_CURSOR_H2',
  'VERIFY_X_EGRESS_LOG',
  'VERIFY_X_RUN_ROOT',
];
const PI_BASE_ARGS = ['--no-session', '-ne', '-ns', '-np', '-nc', '-e', EXTENSION];
export const STUBS = join(SKILL_DIR, 'bin/stubs');
const NET_GUARD = join(SKILL_DIR, 'bin/net-guard.mjs');

// A scratch CA and one leaf for the peer hosts. Pi trusts the CA through NODE_EXTRA_CA_CERTS only.
function mintCerts(dir) {
  const at = (name) => join(dir, name);
  const ssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  ssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    at('ca.key'),
    '-out',
    at('ca.pem'),
    '-days',
    '2',
    '-subj',
    '/CN=verify-x-subscription-ca',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  );
  ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', at('leaf.key'), '-out', at('leaf.csr'), '-subj', '/CN=verify-x-subscription-peer');
  execFileSync('sh', ['-c', `printf '%s\\n' 'subjectAltName=${PEER_HOSTS.map((host) => `DNS:${host}`).join(',')}' 'extendedKeyUsage=serverAuth' 'basicConstraints=CA:FALSE' > '${at('leaf.ext')}'`]);
  ssl('x509', '-req', '-in', at('leaf.csr'), '-CA', at('ca.pem'), '-CAkey', at('ca.key'), '-CAcreateserial', '-out', at('leaf.pem'), '-days', '2', '-extfile', at('leaf.ext'));
}

const readLines = async (file) => (existsSync(file) ? (await readFile(file, 'utf8')).split('\n').filter(Boolean) : []);

export async function setup({ run, evidence }) {
  const files = {
    keychain: join(run.root, 'keychain'),
    certs: join(run.root, 'certs'),
    openLog: join(run.root, 'open.log'),
    securityLog: join(run.root, 'security.log'),
    agentLog: join(run.root, 'cursor-agent.log'),
    egressLog: join(run.root, 'egress.log'),
    sessionAfterLogin: join(run.root, 'keychain-after-login'),
    auth: join(run.agentDir, 'auth.json'),
  };
  await Promise.all([mkdir(files.keychain), mkdir(files.certs)]);
  mintCerts(files.certs);
  const peers = await startPeers({ certDir: files.certs });
  onStop(run, peers.close);

  // Every Pi process, and every child it starts, gets this env. The stubs read VERIFY_X_RUN_ROOT.
  const env = (extra = {}) =>
    cleanEnv(SCRUBBED_ENV, {
      PATH: `${STUBS}:${process.env.PATH}`,
      PI_CODING_AGENT_DIR: run.agentDir,
      HTTP_PROXY: peers.proxyUrl,
      HTTPS_PROXY: peers.proxyUrl,
      NO_PROXY: '127.0.0.1,localhost',
      NODE_EXTRA_CA_CERTS: join(files.certs, 'ca.pem'),
      NODE_OPTIONS: `--import=${pathToFileURL(NET_GUARD).href}`,
      VERIFY_X_RUN_ROOT: run.root,
      VERIFY_X_EGRESS_LOG: files.egressLog,
      VERIFY_X_CURSOR_H2: peers.cursorUrl,
      ...extra,
    });

  return {
    run,
    evidence,
    peers,
    files,
    env,
    step: evidence.step,
    pi: (args, extra) => runPi(run, { env: env(extra), args: [...PI_BASE_ARGS, ...args] }),
    rpc: (args, extra) => startRpc(run, { env: env(extra), args: [...PI_BASE_ARGS, '--offline', '--mode', 'rpc', ...args] }),
    tui: {
      start: ({ offline = true } = {}) => startTui(run, { env: env(), args: [...(offline ? ['--offline'] : []), ...PI_BASE_ARGS], unset: SCRUBBED_ENV }),
      stop: () => stopTui(run),
      pane: () => pane(run),
      keys: (...names) => keys(run, ...names),
      type: (value) => type(run, value),
      waitFor: (needle, timeoutMs) => waitForPane(run, needle, timeoutMs),
      openLogin: (label) => openLogin(run, label),
    },
    auth: {
      write: (entries) => writeFile(files.auth, JSON.stringify(entries, null, 2), { mode: 0o600 }),
      read: async () => (existsSync(files.auth) ? JSON.parse((await readFile(files.auth, 'utf8')) || '{}') : {}),
      raw: () => readFile(files.auth, 'utf8'),
      mode: () => (statSync(files.auth).mode & 0o777).toString(8),
      clear: () => rm(files.auth, { force: true }),
    },
    // Replaces the stub keychain (keychain/<service> files) and clears the stub logs.
    async keychain(items) {
      await rm(files.keychain, { recursive: true, force: true });
      await mkdir(files.keychain);
      for (const [service, value] of Object.entries(items)) await writeFile(join(files.keychain, service), `${value}\n`);
      await Promise.all([files.securityLog, files.agentLog].map((file) => writeFile(file, '')));
    },
    securityCalls: () => readLines(files.securityLog),
    agentCalls: async () => (await readLines(files.agentLog)).map((line) => JSON.parse(line)),
    opened: () => readLines(files.openLog),
    guardLog: async () => (await readLines(files.egressLog)).map((line) => JSON.parse(line)),
  };
}

// An HTTP request as evidence: the identity headers and the body. evidence.json scrubs tokens.
export const describe = (request) => ({
  method: request.method,
  url: `https://${request.host}${request.path}${request.query}`,
  headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) => /^authorization$|^x-|^connect-|^content-type$|^accept$/i.test(name))),
  body: request.body.length > 2000 ? `${request.body.slice(0, 2000)}…` : request.body,
});

// After every passing drive: no refused tunnel, and the guard log holds exactly the egress the
// drive declares (`kind target` → count), nothing else.
export async function checkEgress(ctx, allowed = {}) {
  const refusedTunnels = ctx.peers.refused();
  const guard = await ctx.guardLog();
  const counts = {};
  for (const entry of guard) counts[`${entry.kind} ${entry.target}`] = (counts[`${entry.kind} ${entry.target}`] ?? 0) + 1;
  await ctx.evidence.json('egress.json', { refusedTunnels, guard, allowed });
  assert.deepEqual(refusedTunnels, [], 'a tunnel to a host the peers do not serve');
  assert.deepEqual(counts, allowed, 'network egress outside what this drive declares');
}
