import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const options = new URL(import.meta.url).searchParams;
const phase = options.get('phase');
const gated = options.has('gate');
const read = fs.readSync;
const write = fs.writeSync;

function checkpoint(name) {
  write(1, `lock-test:${name}\n`);
  if (read(0, Buffer.alloc(1), 0, 1, null) !== 1) throw new Error('Lock test controller disconnected');
}

const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  if (sql === 'BEGIN IMMEDIATE') {
    if (gated) checkpoint('ready');
    if (phase === 'opened') checkpoint('opened');
  }
  const result = Reflect.apply(exec, this, [sql]);
  if (sql === 'BEGIN IMMEDIATE' && phase === 'acquired') checkpoint('acquired');
  return result;
};

// Also stop the original mkdir writer so the regression fails against the unfixed CLI.
const mkdir = fs.mkdirSync;
fs.mkdirSync = function (path, ...args) {
  const lock = String(path).endsWith('/todo.lock');
  if (lock && gated) checkpoint('ready');
  const result = Reflect.apply(mkdir, this, [path, ...args]);
  if (lock) checkpoint(phase);
  return result;
};
syncBuiltinESMExports();
