#!/usr/bin/env node
/**
 * Proves the skin does not touch what the model sees.
 *
 * Runs real `pi` twice in JSON mode against a scripted offline provider, once
 * with the extension loaded and once without, and compares:
 *   - the first system message (content, sections, and the tool list Pi records)
 *   - the assistant reply for the same prompt
 *
 * A difference in either is a behavior change, not a presentation change.
 *
 *   node scripts/check-prompt-parity.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_MAIN = join(PKG_ROOT, 'src', 'index.ts');
const PROMPT = 'say hello';

const PROVIDER_SOURCE = `import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.registerProvider('tui-skin-parity', {
    name: 'Reference UI Parity',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'parity-not-a-real-key',
    api: 'tui-skin-parity',
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [{ type: 'text', text: 'PARITY_REPLY' }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 0 };
      stream.push({ type: 'start', partial: message });
      stream.push({ type: 'text_start', contentIndex: 0, partial: message });
      stream.push({ type: 'text_delta', contentIndex: 0, delta: 'PARITY_REPLY', partial: message });
      stream.push({ type: 'text_end', contentIndex: 0, content: 'PARITY_REPLY', partial: message });
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end();
      return stream;
    },
    models: [{ id: 'parity', name: 'Reference UI Parity', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
  });
}
`;

function runPi(args, home, workspace) {
  const output = execFileSync('pi', args, {
    encoding: 'utf8',
    timeout: 90_000,
    cwd: workspace,
    env: { ...process.env, HOME: home, PI_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const records = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  const agentEnd = records.find((record) => record.type === 'agent_end');
  const turnEnd = records.find((record) => record.type === 'turn_end');
  if (agentEnd === undefined) throw new Error('no agent_end record in pi output');
  const system = agentEnd.messages[0];
  return {
    system: { content: system.content, sections: system.sections, toolsAdded: system.toolsAdded },
    reply: turnEnd === undefined ? undefined : turnEnd.message.content,
  };
}

function main() {
  const root = mkdtempSync(join(tmpdir(), 'pi-tui-skin-parity-'));
  const home = join(root, 'home');
  const workspace = join(root, 'ws');
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(home, '.pi', 'agent', 'settings.json'), `${JSON.stringify({ quietStartup: true }, null, 2)}\n`);
  const provider = join(root, 'provider.ts');
  writeFileSync(provider, PROVIDER_SOURCE);

  try {
    const base = ['--extension', provider, '--model', 'tui-skin-parity/parity', '--mode', 'json', '--no-session', '-a', '-nc', PROMPT];
    const without = runPi(base, home, workspace);
    const withSkin = runPi([...base.slice(0, 2), '--extension', EXT_MAIN, ...base.slice(2)], home, workspace);

    const sameSystem = JSON.stringify(without.system) === JSON.stringify(withSkin.system);
    const sameReply = JSON.stringify(without.reply) === JSON.stringify(withSkin.reply);
    if (!sameSystem || !sameReply) {
      process.stderr.write(`system prompt identical: ${sameSystem}\nreply identical: ${sameReply}\n`);
      return 1;
    }
    const tools = without.system.toolsAdded.map((tool) => tool.name);
    process.stdout.write(`parity: system prompt, ${tools.length} tool definitions, and reply identical (${tools.join(', ')})\n`);
    return 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`parity check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
