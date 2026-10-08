import { chmodSync, existsSync, lstatSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createGuiLease } from './resource-workflows-gui-lease.mjs';
import { inspectGuiSource, requireGuiBinding } from './resource-workflows-gui-source.mjs';

function serveClient(client, lease) {
  let bytes = Buffer.alloc(0);
  let finished = false;
  const reply = value => {
    if (finished) return;
    finished = true;
    client.end(`${JSON.stringify(value)}\n`, () => client.destroy());
  };
  client.setTimeout(2000, () => reply({ error: 'GUI request timeout' }));
  client.on('error', () => {});
  client.on('data', chunk => {
    if (finished) return;
    if (bytes.length + chunk.length > 1024) return reply({ error: 'GUI request cap' });
    bytes = Buffer.concat([bytes, chunk]);
  });
  client.on('end', async () => {
    if (finished) return;
    let request;
    try { request = JSON.parse(bytes.toString('utf8')); }
    catch { return reply({ error: 'invalid GUI JSON' }); }
    try { reply({ observation: await lease.dispatch(request) }); }
    catch (error) { reply({ error: error.message }); }
  });
}

function installClient(path, socket, capability) {
  const source = `import { connect } from 'node:net';
const actions = ['launch','read','input','click','capture','close'];
if (process.argv.length !== 3 || !actions.includes(process.argv[2])) { process.stderr.write('one finite GUI action required\\n'); process.exit(2); }
const client = connect(${JSON.stringify(socket)});
let size = 0;
client.setTimeout(5000, () => client.destroy(new Error('GUI client deadline')));
client.on('connect', () => client.end(JSON.stringify({ capability: ${JSON.stringify(capability)}, action: process.argv[2] })));
client.on('data', chunk => { size += chunk.length; if (size > 16384) client.destroy(new Error('GUI reply cap')); else process.stdout.write(chunk); });
client.on('error', () => { process.stderr.write('GUI capability unavailable\\n'); process.exitCode = 1; });
`;
  writeFileSync(path, source, { mode: 0o500, flag: 'wx' });
}

export async function openGuiBridge({ kind, root, out, cwd }) {
  for (const path of [root, out]) {
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('GUI owned directory required');
  }
  root = realpathSync(root);
  out = realpathSync(out);
  const socket = join(root, 'gui.sock');
  if (existsSync(socket) || (() => { try { lstatSync(socket); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } })()) throw new Error('GUI socket already exists');
  const lease = createGuiLease({ kind, cwd });
  let clients = [];
  const server = createServer({ allowHalfOpen: true }, client => {
    clients = [...clients, client];
    client.once('close', () => { clients = clients.filter(value => value !== client); });
    serveClient(client, lease);
  });
  server.maxConnections = 8;
  await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(socket, resolveReady); });
  chmodSync(socket, 0o600);
  const cli = join(out, 'gui-client.mjs');
  try { installClient(cli, socket, lease.capability); }
  catch (error) { await new Promise(done => server.close(done)); throw error; }
  let closed = null;
  const close = () => closed ??= (async () => {
    const serverClosed = new Promise(done => server.close(done));
    for (const client of clients) client.destroy();
    const cleanup = await lease.close();
    await serverClosed;
    if (existsSync(socket)) unlinkSync(socket);
    return cleanup;
  })();
  const releaseRoot = async ({ audit, openBackend } = {}) => {
    const source = await inspectGuiSource();
    requireGuiBinding(kind, lease.application, source);
    await lease.release({ audit: (request, signal) => audit(Object.freeze({ ...request, source }), signal), openBackend });
  };
  return Object.freeze({ cli, socket, capability: lease.capability, application: lease.application, snapshot: lease.snapshot, close, releaseRoot });
}
