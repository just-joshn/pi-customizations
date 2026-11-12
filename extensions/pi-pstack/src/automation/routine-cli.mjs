#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRoutine, startRoutineSource } from './routine.ts';
import { defaultCredentialFile, readCredential, SAME_UID_LIMIT } from './credentials.ts';
import { createExclusive, json, readJson } from './store.ts';

const { values } = parseArgs({ options: { project: { type: 'string' }, name: { type: 'string' }, 'prompt-file': { type: 'string' }, model: { type: 'string' }, serve: { type: 'boolean' }, readonly: { type: 'boolean' }, port: { type: 'string', default: '47913' } } });
if (!values.project || !values.name || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(values.name)) throw new Error('usage: routine-setup.mjs --project <root> --name <slug> --prompt-file <file> [--serve] [--port <port>] [--model <provider/id>] [--readonly]');
const projectRoot = realpathSync(resolve(values.project));
const dir = join(projectRoot, '.pi/pstack/automation', values.name);
const configFile = join(dir, 'config.json');
if (values['prompt-file']) {
  const prompt = readFileSync(values['prompt-file'], 'utf8');
  if (!prompt.trim()) throw new Error('routine prompt must not be empty');
  const config = { kind: 'routine', name: values.name, prompt, projectRoot, ...(values.model ? { model: values.model } : {}), ...(values.readonly ? { workspace: 'readonly' } : {}) };
  if (!createExclusive(configFile, json(config)) && JSON.stringify(readJson(configFile)) !== JSON.stringify(config)) throw new Error('routine already exists with different configuration');
}
const config = readJson(configFile);
if (!config) throw new Error('create the routine with --prompt-file first');
const credentialFile = defaultCredentialFile(values.name);
mkdirSync(dirname(credentialFile), { recursive: true, mode: 0o700 });
try { writeFileSync(credentialFile, json({ key: randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
chmodSync(credentialFile, 0o600);
if (!readCredential(credentialFile, 'key').ok) throw new Error('invalid routine credential file');
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
console.log(JSON.stringify({ configFile, credentialFile, sameUidLimit: SAME_UID_LIMIT }));
if (values.serve) {
  const routine = createRoutine(config);
  const source = await startRoutineSource(routine, { credentialFile, port });
  console.log(JSON.stringify({ url: source.url }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await source.stop(); process.exit(0); });
} else {
  console.log(JSON.stringify({ start: `node ${fileURLToPath(import.meta.url)} --project ${projectRoot} --name ${values.name} --serve --port ${port}` }));
}
