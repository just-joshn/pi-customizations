import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { finish, harness, json, lines, packageDir, sleep, USER_MESSAGE_BG } from './gate-harness.mjs';

const checks = [];
const h = await harness('g6', (body, text) => {
  if (text === 'G6 plain') return 'G6 plain reply';
  if (text === 'G6 thinking')
    return [
      { type: 'thinking', thinking: 'G6 synthetic reasoning', signature: 'g6-synthetic-signature' },
      { type: 'text', text: 'G6 thinking reply' },
    ];
  const results = body.messages.at(-1)?.content;
  if (Array.isArray(results) && results.some((block) => block.type === 'tool_result')) {
    if (results.some((block) => block.tool_use_id === 'g6-bash')) return [{ type: 'tool_use', id: 'g6-edit', name: 'edit', input: { path: 'fixture.txt', oldText: 'before', newText: 'after' } }];
    return 'G6 tools complete';
  }
  return [{ type: 'tool_use', id: 'g6-bash', name: 'bash', input: { command: 'printf "g6 bash output\\n"' } }];
});
const observed = {};
const normalization = [
  'JSON object keys id, parentId, sessionId, responseId, toolCallId, tool_use_id are mapped by first occurrence, preserving equality and references.',
  'JSON object keys timestamp, createdAt, updatedAt, lastUpdated are replaced with <timestamp>.',
  'JSON object key durationMs is replaced with <duration>: wall-clock timing varies between identical runs (two stock-vs-package runs differed on different entries, in both directions; see results/g6-timing-evidence/).',
  'No paths, text, system prompts, tools, cache_control, usage, costs, or other fields are normalized.',
];
function normalize(value, ids = new Map()) {
  if (Array.isArray(value)) return value.map((item) => normalize(item, ids));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (['id', 'parentId', 'sessionId', 'responseId', 'toolCallId', 'tool_use_id'].includes(key) && typeof item === 'string') {
        if (!ids.has(item)) ids.set(item, `<id-${ids.size}>`);
        return [key, ids.get(item)];
      }
      if (['timestamp', 'createdAt', 'updatedAt', 'lastUpdated'].includes(key)) return [key, '<timestamp>'];
      if (key === 'durationMs') return [key, '<duration>'];
      return [key, normalize(item, ids)];
    }),
  );
}
try {
  for (const variant of ['stock', 'package']) {
    const config = h.config(variant, variant === 'stock' ? 'dark' : 'claude-default-dark');
    if (variant === 'package') {
      const install = await h.cli(config, ['install', packageDir], 'install');
      checks.push({ name: 'local package installed', verdict: install.code === 0 ? 'PASS' : 'FAIL', evidence: [join(h.out, 'install.txt')] });
      if (install.code !== 0) throw new Error('Local package installation failed');
    }
    writeFileSync(join(h.work, 'fixture.txt'), 'before\n');
    const start = h.requests.length;
    const tui = h.tui(config, [], variant);
    await tui.ready();
    for (const [prompt, reply] of [
      ['G6 plain', 'G6 plain reply'],
      ['G6 tools', 'G6 tools complete'],
      ['G6 thinking', 'G6 thinking reply'],
    ]) {
      await tui.send(prompt);
      await tui.wait((text) => text.includes(reply), reply);
      const capture = tui.capture(`${variant}-${prompt.split(' ')[1]}`);
      if (prompt === 'G6 plain') {
        const customBackground = USER_MESSAGE_BG.test(readFileSync(capture, 'utf8'));
        checks.push({ name: `${variant} renders selected ${variant === 'stock' ? 'dark' : 'claude-default-dark'} theme`, verdict: customBackground === (variant === 'package') ? 'PASS' : 'FAIL', evidence: [capture] });
      }
    }
    await sleep(300);
    tui.stop();
    const sessionFiles = readdirSync(join(config, 'sessions'), { recursive: true }).filter((file) => file.endsWith('.jsonl'));
    if (sessionFiles.length !== 1) throw new Error(`${variant}: expected one session, found ${sessionFiles.length}`);
    const session = lines(join(config, 'sessions', sessionFiles[0]));
    const requests = h.requests.slice(start);
    json(join(h.out, `${variant}-requests.raw.json`), requests);
    json(join(h.out, `${variant}-session.raw.json`), session);
    writeFileSync(join(h.out, `${variant}-session.jsonl`), readFileSync(join(config, 'sessions', sessionFiles[0])));
    observed[variant] = { requests: normalize(requests), session: normalize(session) };
    json(join(h.out, `${variant}-normalized.json`), observed[variant]);
    const messages = session.filter((entry) => entry.type === 'message').map((entry) => entry.message);
    const toolResults = messages.filter((message) => message.role === 'toolResult');
    const complete =
      requests.length === 5 &&
      toolResults.length === 2 &&
      toolResults.every((result) => !result.isError) &&
      messages.some((message) => message.content?.some?.((block) => block.type === 'thinking')) &&
      readFileSync(join(h.work, 'fixture.txt'), 'utf8') === 'after\n';
    checks.push({
      name: `${variant} conversation includes plain reply, bash/edit round-trips and thinking`,
      verdict: complete ? 'PASS' : 'FAIL',
      evidence: [join(h.out, `${variant}-session.jsonl`), join(h.out, `${variant}-requests.raw.json`)],
    });
  }
  const differences = [];
  function compare(stock, candidate, path = '$') {
    if (isDeepStrictEqual(stock, candidate)) return;
    if (stock && candidate && typeof stock === 'object' && typeof candidate === 'object') {
      for (const key of new Set([...Object.keys(stock), ...Object.keys(candidate)])) compare(stock[key], candidate[key], `${path}.${key}`);
    } else differences.push({ path, stock, package: candidate });
  }
  compare(observed.stock, observed.package);
  json(join(h.out, 'differences.json'), differences);
  for (const key of ['requests', 'session'])
    checks.push({
      name: `${key} identical after allowed normalization`,
      verdict: isDeepStrictEqual(observed.stock[key], observed.package[key]) ? 'PASS' : 'FAIL',
      evidence: [...['stock', 'package'].map((variant) => join(h.out, `${variant}-normalized.json`)), join(h.out, 'differences.json')],
    });
  checks.push({
    name: 'no added model-visible tools',
    verdict: isDeepStrictEqual(
      observed.stock.requests.map((body) => body.tools),
      observed.package.requests.map((body) => body.tools),
    )
      ? 'PASS'
      : 'FAIL',
    evidence: ['stock', 'package'].map((variant) => join(h.out, `${variant}-requests.raw.json`)),
  });
  const messageEntries = (variant) => observed[variant].session.filter((entry) => entry.type === 'message');
  checks.push({ name: 'no extra message entries', verdict: messageEntries('stock').length === messageEntries('package').length ? 'PASS' : 'FAIL', evidence: ['stock', 'package'].map((variant) => join(h.out, `${variant}-session.jsonl`)) });
} catch (error) {
  checks.push({ name: 'complete behavioral observation', verdict: 'INCONCLUSIVE', evidence: [String(error.stack ?? error), h.out] });
} finally {
  const network = await h.close();
  checks.push({
    name: 'zero non-loopback connections or attempted egress',
    verdict: network.nonLoopbackConnections.length + network.intercepted.length + network.refusedEgress.length === 0 ? 'PASS' : 'FAIL',
    evidence: [join(h.out, 'network.json')],
  });
  finish('g6', checks, { normalization });
}
