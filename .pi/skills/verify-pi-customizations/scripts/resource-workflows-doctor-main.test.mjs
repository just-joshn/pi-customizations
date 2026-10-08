import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const base = resolve('.pi/skills/verify-pi-customizations');

test('public scenario does not send approval for four keywords without independent Root review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'doctor-main-'));
  const out = join(root, 'evidence');
  const scratch = join(root, 'scratch');
  const prompts = [];
  const stop = new Error('Doctor complete; other scenarios are outside this test');
  const key = `doctorMain${Date.now()}`;
  globalThis[key] = {
    makeLocalSession({ root: owned, out: artifacts }) {
      if (!owned.endsWith('/setup')) throw stop;
      const cwd = join(owned, 'workspace');
      const agentDir = join(owned, 'agent');
      for (const path of [cwd, agentDir, artifacts]) mkdirSync(path, { recursive: true });
      writeFileSync(join(agentDir, 'settings.json'), '{}');
      return { cwd, agentDir, env: {}, profile: '/nonexistent', session: {
        records: [], dialogs: [],
        async prompt(text) {
          prompts.push(text);
          this.records.push({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Component Clean up everything Let me pick No, keep everything' }] } });
        },
        async close() {},
      } };
    },
  };
  try {
    const stub = `export const makeLocalSession=globalThis[${JSON.stringify(key)}].makeLocalSession; export const checkInteraction=()=>false; export async function attemptPrompt(session,text){await session.prompt(text);return null}`;
    const stubUrl = `data:text/javascript,${encodeURIComponent(stub)}`;
    const original = readFileSync(join(base, 'scenarios/resource-workflows-local.mjs'), 'utf8');
    const source = original.replace(/from '(\.\.\/[^']+)'/g, (_, path) => `from '${path.endsWith('/resource-workflows-local.mjs') ? stubUrl : pathToFileURL(resolve(base, 'scenarios', path)).href}'`);
    const copy = join(root, 'scenario.mjs');
    writeFileSync(copy, source);
    const { default: drive } = await import(pathToFileURL(copy));
    await assert.rejects(drive({ repoRoot: resolve('.'), scratchDir: scratch, artifactDir: out, receipts: { write() {} } }), (error) => error === stop);
    const result = JSON.parse(readFileSync(join(out, 'setup/attempt.json'), 'utf8'));
    assert.equal(prompts.length, 1, 'No approval turn may be sent without a complete independent Root review');
    assert.equal(result.verdict, 'failed');
    assert.equal(result.reportReady, false);
  } finally {
    delete globalThis[key];
    rmSync(root, { recursive: true, force: true });
  }
});
