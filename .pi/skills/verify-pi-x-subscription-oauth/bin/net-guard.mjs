// Verification scaffolding, loaded into every Pi process the harness starts through
// NODE_OPTIONS=--import. It sits at the network boundary and never touches extension code.
// Every refusal is recorded in VERIFY_X_EGRESS_LOG.
//
// - Sockets: net.Socket#connect refuses any TCP host that is not loopback. This is the wall: every
//   HTTP, TLS, and HTTP/2 client in Node connects through it, whatever resolver it used. The proxy
//   and the peers listen on 127.0.0.1, so allowed traffic never trips it.
// - DNS: dns.lookup (and its promise form) refuses every name except localhost. Every resolve*,
//   reverse, and lookupService call that would query a server is refused, on the module, the
//   promises API, and both Resolver classes.
// - UDP: dgram send/connect to anything but loopback is refused.
// - http2.connect to api2.cursor.sh (Cursor's native ask, which ignores HTTP(S)_PROXY) goes to
//   VERIFY_X_CURSOR_H2 with TLS servername api2.cursor.sh, so the scratch CA still has to validate
//   the peer. VERIFY_X_CURSOR_H2=refuse (or unset) sends it to a closed loopback port, which is how
//   the fallback drive makes the native connection fail.
// - Worker threads: Node does not run --import preloads inside a Worker, so a worker would escape
//   every patch above. The guard refuses to create one. No drive needs a worker today; if Pi
//   starts using one, the drive fails loudly instead of running unguarded.
// syncBuiltinESMExports() at the end makes named ESM imports (`import { lookup } from 'node:dns'`)
// see the patched functions too.

import dgram from 'node:dgram';
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
import http2 from 'node:http2';
import { syncBuiltinESMExports } from 'node:module';
import net, { isIP } from 'node:net';
import workerThreads from 'node:worker_threads';

const egressLog = process.env.VERIFY_X_EGRESS_LOG;
// One line per refusal or redirect: kind (dns, tcp, udp, h2, worker), the API that was called, and
// the target. The harness compares `kind target` pairs against what each drive declares.
const record = (kind, api, target) => {
  if (egressLog) appendFileSync(egressLog, `${JSON.stringify({ kind, api, target, pid: process.pid })}\n`);
};

const isLocalName = (host) => host === 'localhost' || host === undefined || host === '';
const isLoopback = (host) => isLocalName(host) || (isIP(host) === 4 && host.startsWith('127.')) || host === '::1' || host === '::ffff:127.0.0.1';
const refused = (hostname, syscall) => Object.assign(new Error(`${syscall} ENOTFOUND ${hostname} (refused by verify net-guard)`), { code: 'ENOTFOUND', hostname, syscall });

const lookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...rest) {
  if (isLocalName(hostname) || isIP(hostname)) return lookup.call(this, hostname, ...rest);
  record('dns', 'lookup', hostname);
  const done = rest.findLast((arg) => typeof arg === 'function');
  process.nextTick(done, refused(hostname, 'getaddrinfo'));
  return {};
};

// resolve*, reverse, and lookupService query DNS servers (c-ares, UDP) or getnameinfo directly, not
// through a socket the guard sees, and even `localhost` goes to the configured server. They are
// refused outright on the module, on the promises API, and on both Resolver classes; lookupService
// is allowed only for a loopback address. Callback forms call back with the error.
const QUERIES = /^(resolve|reverse|lookupService$)/;
function guardQueries(target, promises) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (!QUERIES.test(name) || typeof target[name] !== 'function') continue;
    const original = target[name];
    target[name] = function guardedQuery(subject, ...rest) {
      if (name === 'lookupService' && isLoopback(subject)) return original.call(this, subject, ...rest);
      record('dns', name, String(subject));
      const error = refused(subject, name);
      if (promises) return Promise.reject(error);
      const done = rest.findLast((arg) => typeof arg === 'function');
      if (done) process.nextTick(done, error);
      return {};
    };
  }
}
guardQueries(dns, false);
guardQueries(dns.Resolver.prototype, false);
guardQueries(dns.promises.Resolver.prototype, true);

const promiseLookup = dns.promises.lookup;
dns.promises.lookup = function guardedPromiseLookup(hostname, ...rest) {
  if (isLocalName(hostname) || isIP(hostname)) return promiseLookup.call(this, hostname, ...rest);
  record('dns', 'lookup', hostname);
  return Promise.reject(refused(hostname, 'getaddrinfo'));
};
guardQueries(dns.promises, true);

// UDP: a datagram to anything but loopback is dropped with an error. `send` takes the address as
// its only string argument; without one, Node sends to the connected peer or to localhost.
const udpRefusal = (address, port) => Object.assign(new Error(`send ECONNREFUSED ${address}:${port} (refused by verify net-guard)`), { code: 'ECONNREFUSED', address, port });
const udpSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function guardedSend(msg, ...rest) {
  const address = rest.find((arg) => typeof arg === 'string');
  if (address === undefined || isLoopback(address)) return udpSend.call(this, msg, ...rest);
  const port = rest.filter((arg) => typeof arg === 'number').at(-1);
  record('udp', 'send', `${address}:${port}`);
  const done = rest.findLast((arg) => typeof arg === 'function');
  if (done) process.nextTick(done, udpRefusal(address, port));
  else process.nextTick(() => this.emit('error', udpRefusal(address, port)));
};
const udpConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function guardedUdpConnect(port, address, ...rest) {
  if (typeof address !== 'string' || isLoopback(address)) return udpConnect.call(this, port, address, ...rest);
  record('udp', 'connect', `${address}:${port}`);
  throw udpRefusal(address, port);
};

const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  // net.connect() passes its already-normalized [options, callback] array as the only argument.
  const [options] = Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args);
  if (options.path != null || isLoopback(options.host)) return socketConnect.apply(this, args);
  record('tcp', 'connect', `${options.host}:${options.port}`);
  process.nextTick(() => this.destroy(Object.assign(new Error(`connect ECONNREFUSED ${options.host}:${options.port} (refused by verify net-guard)`), { code: 'ECONNREFUSED', address: options.host, port: options.port })));
  return this;
};

const connect = http2.connect;
http2.connect = function guardedHttp2(authority, ...rest) {
  const url = new URL(String(authority));
  if (url.hostname !== 'api2.cursor.sh') return connect.call(this, authority, ...rest);
  record('h2', 'connect', url.host);
  const [options, listener] = typeof rest[0] === 'function' ? [{}, rest[0]] : rest;
  const peer = process.env.VERIFY_X_CURSOR_H2;
  const target = !peer || peer === 'refuse' ? 'https://127.0.0.1:1' : peer;
  return connect.call(this, target, { ...options, servername: 'api2.cursor.sh' }, listener);
};

workerThreads.Worker = class GuardedWorker {
  constructor(filename) {
    record('worker', 'Worker', String(filename).slice(0, 120));
    throw new Error('Worker threads are refused by the verify net-guard: a worker would run without the network guard.');
  }
};

syncBuiltinESMExports();
