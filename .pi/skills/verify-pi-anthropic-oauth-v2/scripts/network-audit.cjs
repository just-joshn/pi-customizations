#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { Socket } = require('node:net');
const tls = require('node:tls');

const record = (kind) => appendFileSync(process.env.VERIFY_NETWORK_LOG, `${JSON.stringify({ kind, pid: process.pid, at: new Date().toISOString() })}\n`);
record('observer-loaded');
const fetch = globalThis.fetch;
globalThis.fetch = function (...args) {
  record('fetch');
  return Reflect.apply(fetch, this, args);
};
const connect = Socket.prototype.connect;
Socket.prototype.connect = function (...args) {
  record('socket-connect');
  return Reflect.apply(connect, this, args);
};
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  record('tls-connect');
  return Reflect.apply(tlsConnect, this, args);
};
