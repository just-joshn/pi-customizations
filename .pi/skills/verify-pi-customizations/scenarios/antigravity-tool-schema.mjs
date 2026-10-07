import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fakeServer, json, sse, stream } from '../../../../extensions/pi-antigravity-oauth/test/fake-server.ts';
import { createRpcSession } from '../lib/rpc.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const rawDir = join(root, 'artifacts/user-perspective/f012-schema');
mkdirSync(rawDir, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'antigravity-schema-'));
const rejected = [];
const baseline = process.argv.includes('--baseline');
const variant = baseline ? 'baseline' : 'fixed';
function checkSchema(schema) {
  if (Array.isArray(schema)) return schema.flatMap(checkSchema);
  if (!schema || typeof schema !== 'object') return [];
  return Object.entries(schema).flatMap(([key, value]) => {
    if (key === 'const' || key === 'uniqueItems') return [key];
    if (key === 'properties') return Object.values(value).flatMap(checkSchema);
    return checkSchema(value);
  });
}
const server = await fakeServer((request, response) => {
  const body = JSON.parse(request.body);
  const problems = (body.request?.tools ?? []).flatMap((group) => group.functionDeclarations.flatMap((tool) => checkSchema(tool.parameters)));
  if (problems.length > 0) {
    rejected.push(...problems);
    json(response, 400, { error: { message: `Unsupported schema keywords: ${problems.join(', ')}` } });
    return;
  }
  stream(response, sse([{ response: { candidates: [{ content: { parts: [{ text: 'schema accepted' }] }, finishReason: 'STOP' }] } }]));
});
let session;
try {
  const agentDir = join(scratch, 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ 'google-antigravity': { type: 'oauth', access: 'ya29.fixture', refresh: 'fixture', expires: Date.UTC(2100, 0, 1), projectId: 'fixture' } }), { mode: 0o600 });
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'google-antigravity': { baseUrl: server.url } } }));
  const fixture = join(scratch, 'tools.js');
  writeFileSync(
    fixture,
    `export default function(pi) { pi.registerTool({ name: 'compatibility_probe', label: 'probe', description: 'Probe tool schema compatibility', parameters: { type: 'object', properties: { environment: { anyOf: [{ type: 'string', const: 'local' }, { type: 'string', const: 'cloud' }] }, agent_ids: { type: 'array', items: { type: 'string' }, uniqueItems: true } }, required: ['environment', 'agent_ids'] }, execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }); }`,
  );
  let packagePath = join(root, 'extensions/pi-antigravity-oauth');
  if (baseline) {
    packagePath = join(scratch, 'provider');
    mkdirSync(packagePath);
    cpSync(join(root, 'extensions/pi-antigravity-oauth/src'), join(packagePath, 'src'), { recursive: true });
    cpSync(join(root, 'extensions/pi-antigravity-oauth/package.json'), join(packagePath, 'package.json'));
    symlinkSync(join(root, 'extensions/pi-antigravity-oauth/node_modules'), join(packagePath, 'node_modules'));
    const source = execFileSync('git', ['show', '169cbe6:extensions/pi-antigravity-oauth/src/pi-ai/google-shared.ts'], { cwd: root });
    writeFileSync(join(packagePath, 'src/pi-ai/google-shared.ts'), source);
  }
  session = createRpcSession({ packagePath, extraExtensions: [fixture], agentDir, cwd: scratch, capturePath: join(rawDir, `${variant}-real-pi-schema.jsonl`) });
  await session.send({ type: 'set_model', provider: 'google-antigravity', modelId: 'gemini-3.1-pro' });
  await session.prompt('Check schema compatibility');
  writeFileSync(join(rawDir, `${variant}-real-pi-request.json`), JSON.stringify({ requests: server.requests, rejected, messages: await session.messages() }, null, 2));
  assert.ok(server.requests.length > 0, 'real Pi must reach the local provider endpoint');
  assert.deepEqual(rejected, [], 'Cloud Code rejects const and uniqueItems in OpenAPI schemas');
  const request = JSON.parse(server.requests[0].body);
  const declaration = request.request.tools.flatMap((group) => group.functionDeclarations).find((tool) => tool.name === 'compatibility_probe');
  assert.deepEqual(declaration.parameters.properties.environment.anyOf, [
    { type: 'STRING', enum: ['local'] },
    { type: 'STRING', enum: ['cloud'] },
  ]);
  assert.equal(declaration.parameters.properties.agent_ids.uniqueItems, undefined);
  console.log(JSON.stringify({ requests: server.requests.length, rejected, declaration }));
} finally {
  await session?.close();
  server.close();
  rmSync(scratch, { recursive: true, force: true });
}
